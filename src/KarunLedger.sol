// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KarunAscBase} from "./KarunAscBase.sol";
import {INativeQueryVerifier} from "./interfaces/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";

/// @title KarunLedger
/// @notice Karun'un Creditcoin uzerindeki HAKEM defteri (Attestcoin Smart Contract).
///
///         Creditcoin bir odeme agi DEGILDIR; teminati dogrular, tek harcama
///         limitini tutar, cifte harcamayi engeller ve kesintiyi kanitlar.
///         Odeme, kullanicinin sectigi HEDEF zincirdeki KarunSpender havuzundan
///         cikar. Kullaniciya sarmalanmis token verilmez.
///
///         Dongu:
///         1. Kullanici kaynak zincirde KarunEscrow'a kilitler.
///         2. Kilit Attestcoin readability ile burada kanitlanir -> LTV oranli limit.
///         3. requestPayment(): limit dusulur, hedef zincire odeme talimati cikar
///            (PaymentAuthorized). Spender aliciya oder.
///         4. Odeme (Paid) ve kesinti (Deducted) olaylari yine Attestcoin ile
///            burada kanitlanir; talep kapanir, borc mahsuplasir.
contract KarunLedger is KarunAscBase {
    bytes32 public constant LOCKED_SIG = keccak256("Locked(address,uint256,uint256)");
    bytes32 public constant DEDUCTED_SIG = keccak256("Deducted(address,uint256,bytes32,uint256)");
    bytes32 public constant PAID_SIG = keccak256("Paid(bytes32,address,uint256)");

    struct ZincirAyari {
        address escrow;   // o zincirdeki KarunEscrow (teminat) — sifir olabilir
        address spender;  // o zincirdeki KarunSpender (odeme)  — sifir olabilir
        uint16 ltvBps;    // teminata taninan limit orani (stabil: 8000)
        bool teminatAcik; // o zincirde teminat kabul ediliyor mu
        bool odemeAcik;   // o zincirde odeme yapilabiliyor mu
    }

    /// @notice Attestcoin kanit paketi (stack derinligini dusurmek icin tek yapida).
    struct Kanit {
        uint64 chainKey;
        uint64 blockHeight;
        bytes encodedTransaction;
        bytes32 merkleRoot;
        INativeQueryVerifier.MerkleProofEntry[] siblings;
        bytes32 lowerEndpointDigest;
        bytes32[] continuityRoots;
    }

    struct Talep {
        address user;
        uint64 kaynakZincir; // kesintinin yapilacagi zincir
        uint64 hedefZincir;  // odemenin yapildigi zincir
        address alici;
        uint256 tutar;       // aliciya odenen
        uint256 toplam;      // tutar + komisyon (escrow'dan kesilecek)
        bool odendi;         // hedef zincirde Paid kanitlandi
        bool kapandi;        // kaynak zincirde Deducted kanitlandi
    }

    address public owner;
    uint16 public feeBps;
    uint256 public talepSayaci;
    uint256 public accruedFees;

    mapping(uint64 => ZincirAyari) public zincirler;
    mapping(address => mapping(uint64 => uint256)) public collateral;
    mapping(address => uint256) public outstanding;
    mapping(address => mapping(uint64 => uint256)) private _zincirBorcu;
    mapping(bytes32 => Talep) public talepler;
    uint64[] public zincirAnahtarlari;

    event ZincirTanimlandi(uint64 indexed chainKey, address escrow, address spender, uint16 ltvBps);
    event CollateralSynced(address indexed user, uint64 indexed chainKey, uint256 totalLocked, bytes32 queryId);
    /// @notice Hedef zincirdeki Spender'a odeme talimati.
    event PaymentAuthorized(
        bytes32 indexed claimId,
        address indexed user,
        uint64 indexed hedefZincir,
        address alici,
        uint256 tutar,
        uint256 komisyon,
        uint64 kaynakZincir
    );
    event PaymentProven(bytes32 indexed claimId, uint64 indexed hedefZincir, uint256 tutar, bytes32 queryId);
    event ClaimSettled(bytes32 indexed claimId, address indexed user, uint256 toplam, bytes32 queryId);

    modifier onlyOwner() {
        require(msg.sender == owner, "Karun: owner degil");
        _;
    }

    constructor(uint16 feeBps_, address verifierOverride) KarunAscBase(verifierOverride) {
        owner = msg.sender;
        feeBps = feeBps_;
    }

    // ─────────── yapilandirma ───────────

    function zincirTanimla(
        uint64 chainKey,
        address escrow,
        address spender,
        uint16 ltvBps,
        bool teminatAcik,
        bool odemeAcik
    ) external onlyOwner {
        require(ltvBps > 0 && ltvBps <= 10_000, "Karun: ltv");
        if (zincirler[chainKey].escrow == address(0) && zincirler[chainKey].spender == address(0)) {
            zincirAnahtarlari.push(chainKey);
        }
        zincirler[chainKey] = ZincirAyari({
            escrow: escrow,
            spender: spender,
            ltvBps: ltvBps,
            teminatAcik: teminatAcik,
            odemeAcik: odemeAcik
        });
        emit ZincirTanimlandi(chainKey, escrow, spender, ltvBps);
    }

    function zinciriAyarla(uint64 chainKey, bool teminatAcik, bool odemeAcik) external onlyOwner {
        zincirler[chainKey].teminatAcik = teminatAcik;
        zincirler[chainKey].odemeAcik = odemeAcik;
    }

    function setFeeBps(uint16 feeBps_) external onlyOwner {
        require(feeBps_ <= 1_000, "Karun: komisyon");
        feeBps = feeBps_;
    }

    // ─────────── goruntuleme ───────────

    function creditLimit(address user) public view returns (uint256 limit) {
        uint256 n = zincirAnahtarlari.length;
        for (uint256 i; i < n; ++i) {
            uint64 ck = zincirAnahtarlari[i];
            ZincirAyari storage z = zincirler[ck];
            if (z.teminatAcik) limit += (collateral[user][ck] * z.ltvBps) / 10_000;
        }
    }

    function available(address user) public view returns (uint256) {
        uint256 limit = creditLimit(user);
        uint256 kullanilan = outstanding[user];
        return limit > kullanilan ? limit - kullanilan : 0;
    }

    function zincirBorcu(address user, uint64 chainKey) public view returns (uint256) {
        return _zincirBorcu[user][chainKey];
    }

    function zincirSayisi() external view returns (uint256) {
        return zincirAnahtarlari.length;
    }

    // ─────────── Attestcoin: kilit kaniti ───────────

    function submitLockProof(Kanit calldata k) external {
        ZincirAyari storage z = zincirler[k.chainKey];
        require(z.teminatAcik && z.escrow != address(0), "Karun: teminat zinciri kapali");

        bytes32 queryId = _verifyQuery(
            k.chainKey, k.blockHeight, k.encodedTransaction, k.merkleRoot, k.siblings, k.lowerEndpointDigest, k.continuityRoots
        );

        EvmV1Decoder.LogEntry[] memory logs = _extractLogs(k.encodedTransaction, LOCKED_SIG, z.escrow);
        require(logs.length > 0, "Karun: Locked olayi yok");
        _isleLockedLoglari(logs, k.chainKey, queryId);
    }

    function _isleLockedLoglari(EvmV1Decoder.LogEntry[] memory logs, uint64 chainKey, bytes32 queryId) internal {
        for (uint256 i; i < logs.length; ++i) {
            require(logs[i].topics.length == 2, "Karun: Locked bicimi");
            address user = address(uint160(uint256(logs[i].topics[1])));
            (, uint256 totalLocked) = abi.decode(logs[i].data, (uint256, uint256));
            if (totalLocked > collateral[user][chainKey]) collateral[user][chainKey] = totalLocked;
            emit CollateralSynced(user, chainKey, collateral[user][chainKey], queryId);
        }
    }

    // ─────────── odeme talebi ───────────

    /// @notice Limitten odeme talebi. Para HEDEF zincirdeki Spender havuzundan
    ///         aliciya gider; karsiligi KAYNAK zincirdeki escrow'dan kesilir.
    /// @param hedefZincir odemenin yapilacagi zincir (Creditcoin olmak zorunda degil)
    /// @param kaynakZincir kesintinin yapilacagi zincir (teminatin bulundugu yer)
    function requestPayment(address alici, uint256 tutar, uint64 hedefZincir, uint64 kaynakZincir)
        external
        returns (bytes32 claimId)
    {
        require(alici != address(0), "Karun: alici");
        require(tutar > 0, "Karun: sifir");

        ZincirAyari storage hedef = zincirler[hedefZincir];
        require(hedef.odemeAcik && hedef.spender != address(0), "Karun: odeme zinciri kapali");
        ZincirAyari storage kaynak = zincirler[kaynakZincir];
        require(kaynak.teminatAcik && kaynak.escrow != address(0), "Karun: teminat zinciri kapali");

        uint256 komisyon = (tutar * feeBps) / 10_000;
        uint256 toplam = tutar + komisyon;
        require(toplam <= available(msg.sender), "Karun: limit yetersiz");
        require(
            _zincirBorcu[msg.sender][kaynakZincir] + toplam <= collateral[msg.sender][kaynakZincir],
            "Karun: zincir teminati yetersiz"
        );

        outstanding[msg.sender] += toplam;
        _zincirBorcu[msg.sender][kaynakZincir] += toplam;
        accruedFees += komisyon;

        claimId = keccak256(abi.encodePacked(address(this), ++talepSayaci, msg.sender, hedefZincir, kaynakZincir, toplam));
        talepler[claimId] = Talep({
            user: msg.sender,
            kaynakZincir: kaynakZincir,
            hedefZincir: hedefZincir,
            alici: alici,
            tutar: tutar,
            toplam: toplam,
            odendi: false,
            kapandi: false
        });

        emit PaymentAuthorized(claimId, msg.sender, hedefZincir, alici, tutar, komisyon, kaynakZincir);
    }

    // ─────────── Attestcoin: odeme kaniti ───────────

    /// @notice Hedef zincirdeki Paid olayini dogrular: alici gercekten aldi.
    function submitPaymentProof(Kanit calldata k) external {
        ZincirAyari storage z = zincirler[k.chainKey];
        require(z.spender != address(0), "Karun: odeme zinciri tanimsiz");

        bytes32 queryId = _verifyQuery(
            k.chainKey, k.blockHeight, k.encodedTransaction, k.merkleRoot, k.siblings, k.lowerEndpointDigest, k.continuityRoots
        );

        EvmV1Decoder.LogEntry[] memory logs = _extractLogs(k.encodedTransaction, PAID_SIG, z.spender);
        require(logs.length > 0, "Karun: Paid olayi yok");
        _islePaidLoglari(logs, k.chainKey, queryId);
    }

    function _islePaidLoglari(EvmV1Decoder.LogEntry[] memory logs, uint64 chainKey, bytes32 queryId) internal {
        for (uint256 i; i < logs.length; ++i) {
            require(logs[i].topics.length == 3, "Karun: Paid bicimi");
            bytes32 claimId = logs[i].topics[1];
            address alici = address(uint160(uint256(logs[i].topics[2])));
            uint256 tutar = abi.decode(logs[i].data, (uint256));

            Talep storage t = talepler[claimId];
            require(t.user != address(0), "Karun: talep yok");
            require(t.hedefZincir == chainKey, "Karun: zincir uyusmuyor");
            require(t.alici == alici && t.tutar == tutar, "Karun: odeme uyusmuyor");
            require(!t.odendi, "Karun: odeme zaten kanitli");

            t.odendi = true;
            emit PaymentProven(claimId, chainKey, tutar, queryId);
        }
    }

    // ─────────── Attestcoin: kesinti kaniti ───────────

    function submitDeductionProof(Kanit calldata k) external {
        ZincirAyari storage z = zincirler[k.chainKey];
        require(z.escrow != address(0), "Karun: teminat zinciri tanimsiz");

        bytes32 queryId = _verifyQuery(
            k.chainKey, k.blockHeight, k.encodedTransaction, k.merkleRoot, k.siblings, k.lowerEndpointDigest, k.continuityRoots
        );

        EvmV1Decoder.LogEntry[] memory logs = _extractLogs(k.encodedTransaction, DEDUCTED_SIG, z.escrow);
        require(logs.length > 0, "Karun: Deducted olayi yok");
        _isleDeductedLoglari(logs, k.chainKey, queryId);
    }

    function _isleDeductedLoglari(EvmV1Decoder.LogEntry[] memory logs, uint64 chainKey, bytes32 queryId) internal {
        for (uint256 i; i < logs.length; ++i) {
            require(logs[i].topics.length == 3, "Karun: Deducted bicimi");
            address user = address(uint160(uint256(logs[i].topics[1])));
            bytes32 claimId = logs[i].topics[2];
            (uint256 tutar, uint256 kalanKilit) = abi.decode(logs[i].data, (uint256, uint256));

            Talep storage t = talepler[claimId];
            require(t.user == user && t.kaynakZincir == chainKey, "Karun: talep uyusmuyor");
            require(!t.kapandi, "Karun: talep kapali");
            require(t.toplam == tutar, "Karun: tutar uyusmuyor");

            t.kapandi = true;
            outstanding[user] -= tutar;
            _zincirBorcu[user][chainKey] -= tutar;
            if (kalanKilit < collateral[user][chainKey]) collateral[user][chainKey] = kalanKilit;

            emit ClaimSettled(claimId, user, tutar, queryId);
        }
    }

    // ─────────── ic yardimcilar ───────────

    function _extractLogs(bytes memory encodedTransaction, bytes32 signature, address emitter)
        internal
        pure
        returns (EvmV1Decoder.LogEntry[] memory out)
    {
        uint8 txType = EvmV1Decoder.getTransactionType(encodedTransaction);
        require(EvmV1Decoder.isValidTransactionType(txType), "Karun: islem tipi");

        EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
        require(receipt.receiptStatus == 1, "Karun: islem basarisiz");

        EvmV1Decoder.LogEntry[] memory bySig = EvmV1Decoder.getLogsByEventSignature(receipt, signature);
        uint256 n;
        for (uint256 i; i < bySig.length; ++i) if (bySig[i].address_ == emitter) ++n;
        out = new EvmV1Decoder.LogEntry[](n);
        uint256 k;
        for (uint256 i; i < bySig.length; ++i) if (bySig[i].address_ == emitter) out[k++] = bySig[i];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Karun: adres");
        owner = newOwner;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {KarunAscBase} from "./KarunAscBase.sol";
import {INativeQueryVerifier} from "./interfaces/INativeQueryVerifier.sol";
import {EvmV1Decoder} from "@gluwa/usc-contracts/contracts/write-ability/common/EvmV1Decoder.sol";

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title KarunLedger
/// @notice Karun'un Creditcoin uzerindeki merkezi defteri (Attestcoin Smart Contract).
///
///         Akis:
///         1. Kullanici kaynak zincirde (or. Sepolia) KarunEscrow'a stablecoin kilitler.
///         2. Kilit islemi Attestcoin Protocol readability ile burada kanitlanir
///            (submitLockProof) ve kullaniciya LTV oranli tek harcama limiti acilir.
///         3. Kullanici spend() ile limitinden harcar; para protokol likidite
///            havuzundan ANINDA cikar, kaynak zincirdeki escrow'a kesinti talebi
///            (claim) olusturulur.
///         4. Escrow'daki kesinti (Deducted olayi) yine Attestcoin readability ile
///            burada kanitlanir (submitDeductionProof) ve talep kapatilir:
///            borc birikmez, her harcama karsiligiyla mahsuplasir.
contract KarunLedger is KarunAscBase {
    // keccak256("Locked(address,uint256,uint256)")
    bytes32 public constant LOCKED_SIG = keccak256("Locked(address,uint256,uint256)");
    // keccak256("Deducted(address,uint256,bytes32,uint256)")
    bytes32 public constant DEDUCTED_SIG = keccak256("Deducted(address,uint256,bytes32,uint256)");

    struct EscrowConfig {
        address escrow;   // kaynak zincirdeki KarunEscrow adresi
        uint16 ltvBps;    // teminata taninan limit orani (stabil icin 8000 = %80)
        bool active;
    }

    struct Claim {
        address user;
        uint64 chainKey;
        uint256 amount;   // escrow'dan kesilecek tutar (harcama + komisyon)
        bool settled;
    }

    address public owner;
    IERC20 public immutable poolToken; // Creditcoin uzerindeki harcama varligi (mUSDC)
    uint16 public feeBps;              // harcama komisyonu (30 = %0,30)
    uint256 public claimCount;

    mapping(uint64 => EscrowConfig) public escrows;              // chainKey => config
    mapping(address => mapping(uint64 => uint256)) public collateral; // kullanici => chainKey => senkron kilit
    mapping(address => uint256) public outstanding;              // henuz mahsuplasmamis harcama + komisyon
    mapping(bytes32 => Claim) public claims;
    uint256 public accruedFees;
    uint64[] public chainKeys;

    event EscrowRegistered(uint64 indexed chainKey, address escrow, uint16 ltvBps);
    event CollateralSynced(address indexed user, uint64 indexed chainKey, uint256 totalLocked, bytes32 queryId);
    event SpendExecuted(address indexed user, address indexed recipient, uint256 amount, uint256 fee, bytes32 indexed claimId);
    event DeductionQueued(bytes32 indexed claimId, address indexed user, uint64 indexed chainKey, uint256 amount);
    event ClaimSettled(bytes32 indexed claimId, address indexed user, uint256 amount, bytes32 queryId);
    event PoolFunded(address indexed from, uint256 amount);
    event PoolDefunded(address indexed to, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Karun: owner degil");
        _;
    }

    constructor(IERC20 poolToken_, uint16 feeBps_, address verifierOverride) KarunAscBase(verifierOverride) {
        owner = msg.sender;
        poolToken = poolToken_;
        feeBps = feeBps_;
    }

    // ─────────────────────── yapilandirma ───────────────────────

    function registerEscrow(uint64 chainKey, address escrow, uint16 ltvBps) external onlyOwner {
        require(escrow != address(0), "Karun: adres");
        require(ltvBps > 0 && ltvBps <= 10_000, "Karun: ltv");
        if (escrows[chainKey].escrow == address(0)) {
            chainKeys.push(chainKey);
        }
        escrows[chainKey] = EscrowConfig({escrow: escrow, ltvBps: ltvBps, active: true});
        emit EscrowRegistered(chainKey, escrow, ltvBps);
    }

    function setEscrowActive(uint64 chainKey, bool active) external onlyOwner {
        escrows[chainKey].active = active;
    }

    function setFeeBps(uint16 feeBps_) external onlyOwner {
        require(feeBps_ <= 1_000, "Karun: komisyon");
        feeBps = feeBps_;
    }

    function fundPool(uint256 amount) external {
        require(poolToken.transferFrom(msg.sender, address(this), amount), "Karun: transfer");
        emit PoolFunded(msg.sender, amount);
    }

    function defundPool(address to, uint256 amount) external onlyOwner {
        require(poolToken.transfer(to, amount), "Karun: transfer");
        emit PoolDefunded(to, amount);
    }

    // ─────────────────────── goruntuleme ───────────────────────

    /// @notice Kullanicinin LTV agirlikli toplam limiti.
    function creditLimit(address user) public view returns (uint256 limit) {
        uint256 n = chainKeys.length;
        for (uint256 i; i < n; ++i) {
            uint64 ck = chainKeys[i];
            EscrowConfig storage cfg = escrows[ck];
            if (cfg.active) {
                limit += (collateral[user][ck] * cfg.ltvBps) / 10_000;
            }
        }
    }

    /// @notice Kullanicinin su an harcayabilecegi tutar.
    function available(address user) public view returns (uint256) {
        uint256 limit = creditLimit(user);
        uint256 used = outstanding[user];
        return limit > used ? limit - used : 0;
    }

    function chainKeyCount() external view returns (uint256) {
        return chainKeys.length;
    }

    // ─────────────────────── Attestcoin: kilit kaniti ───────────────────────

    /// @notice Kaynak zincirdeki Locked olayini Attestcoin readability ile dogrular
    ///         ve kullanicinin teminatini kumulatif degere senkronlar.
    function submitLockProof(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external {
        EscrowConfig storage cfg = escrows[chainKey];
        require(cfg.active, "Karun: zincir kayitli degil");

        bytes32 queryId = _verifyQuery(
            chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots
        );

        EvmV1Decoder.LogEntry[] memory logs = _extractLogs(encodedTransaction, LOCKED_SIG, cfg.escrow);
        require(logs.length > 0, "Karun: Locked olayi yok");

        for (uint256 i; i < logs.length; ++i) {
            EvmV1Decoder.LogEntry memory log = logs[i];
            require(log.topics.length == 2, "Karun: Locked bicimi");
            address user = address(uint160(uint256(log.topics[1])));
            (, uint256 totalLocked) = abi.decode(log.data, (uint256, uint256));
            // Kumulatif senkron: olay toplam kilidi tasir, eski kanitlar limiti sisiremez.
            if (totalLocked > collateral[user][chainKey]) {
                collateral[user][chainKey] = totalLocked;
            }
            emit CollateralSynced(user, chainKey, collateral[user][chainKey], queryId);
        }
    }

    // ─────────────────────── harcama ───────────────────────

    /// @notice Limitten harcama: alici parayi Creditcoin'deki havuzdan ANINDA alir,
    ///         karsilik kaynak zincirdeki escrow'dan kesilmek uzere talebe baglanir.
    /// @param chainKey kesintinin yapilacagi kaynak zincir
    function spend(address recipient, uint256 amount, uint64 chainKey) external returns (bytes32 claimId) {
        require(recipient != address(0), "Karun: alici");
        require(amount > 0, "Karun: sifir");
        EscrowConfig storage cfg = escrows[chainKey];
        require(cfg.active, "Karun: zincir kayitli degil");

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 total = amount + fee;
        require(total <= available(msg.sender), "Karun: limit yetersiz");
        // kesinti, o zincirdeki teminattan karsilanabilmeli
        require(
            outstandingAgainst(msg.sender, chainKey) + total <= collateral[msg.sender][chainKey],
            "Karun: zincir teminati yetersiz"
        );

        outstanding[msg.sender] += total;
        _outstandingByChain[msg.sender][chainKey] += total;
        accruedFees += fee;

        claimId = keccak256(abi.encodePacked(address(this), ++claimCount, msg.sender, chainKey, total));
        claims[claimId] = Claim({user: msg.sender, chainKey: chainKey, amount: total, settled: false});

        require(poolToken.transfer(recipient, amount), "Karun: havuz transfer");

        emit SpendExecuted(msg.sender, recipient, amount, fee, claimId);
        emit DeductionQueued(claimId, msg.sender, chainKey, total);
    }

    mapping(address => mapping(uint64 => uint256)) private _outstandingByChain;

    function outstandingAgainst(address user, uint64 chainKey) public view returns (uint256) {
        return _outstandingByChain[user][chainKey];
    }

    // ─────────────────────── Attestcoin: kesinti kaniti ───────────────────────

    /// @notice Kaynak zincirdeki Deducted olayini Attestcoin readability ile dogrular
    ///         ve talebi kapatir: teminat duser, borc mahsuplasir.
    function submitDeductionProof(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) external {
        EscrowConfig storage cfg = escrows[chainKey];
        require(cfg.escrow != address(0), "Karun: zincir kayitli degil");

        bytes32 queryId = _verifyQuery(
            chainKey, blockHeight, encodedTransaction, merkleRoot, siblings, lowerEndpointDigest, continuityRoots
        );

        EvmV1Decoder.LogEntry[] memory logs = _extractLogs(encodedTransaction, DEDUCTED_SIG, cfg.escrow);
        require(logs.length > 0, "Karun: Deducted olayi yok");

        for (uint256 i; i < logs.length; ++i) {
            EvmV1Decoder.LogEntry memory log = logs[i];
            require(log.topics.length == 3, "Karun: Deducted bicimi");
            address user = address(uint160(uint256(log.topics[1])));
            bytes32 claimId = log.topics[2];
            (uint256 amount, uint256 remainingLocked) = abi.decode(log.data, (uint256, uint256));

            Claim storage claim = claims[claimId];
            require(claim.user == user && claim.chainKey == chainKey, "Karun: talep uyusmuyor");
            require(!claim.settled, "Karun: talep kapali");
            require(claim.amount == amount, "Karun: tutar uyusmuyor");

            claim.settled = true;
            outstanding[user] -= amount;
            _outstandingByChain[user][chainKey] -= amount;
            // teminati escrow'un bildirdigi kalan degere senkronla
            if (remainingLocked < collateral[user][chainKey]) {
                collateral[user][chainKey] = remainingLocked;
            }

            emit ClaimSettled(claimId, user, amount, queryId);
        }
    }

    // ─────────────────────── ic yardimcilar ───────────────────────

    /// @dev Dogrulanmis islem baytlarindan, verilen imza ve kaynak adresle eslesen
    ///      olaylari cikarir. Islem BASARILI olmali (receipt status == 1); precompile
    ///      bunu kontrol etmez, burada zorunlu kilinir.
    function _extractLogs(bytes calldata encodedTransaction, bytes32 signature, address emitter)
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
        for (uint256 i; i < bySig.length; ++i) {
            if (bySig[i].address_ == emitter) ++n;
        }
        out = new EvmV1Decoder.LogEntry[](n);
        uint256 k;
        for (uint256 i; i < bySig.length; ++i) {
            if (bySig[i].address_ == emitter) out[k++] = bySig[i];
        }
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Karun: adres");
        owner = newOwner;
    }
}

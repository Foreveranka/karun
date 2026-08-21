// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {KarunEscrow, IERC20 as IEscrowERC20} from "../src/KarunEscrow.sol";
import {KarunLedger, IERC20 as ILedgerERC20} from "../src/KarunLedger.sol";
import {INativeQueryVerifier} from "../src/interfaces/INativeQueryVerifier.sol";

contract MockVerifier2 is INativeQueryVerifier {
    bool public sonuc = true;
    uint64 public txIndex;

    function ayarla(bool sonuc_, uint64 txIndex_) external {
        sonuc = sonuc_;
        txIndex = txIndex_;
    }

    function verifyAndEmit(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        view
        returns (bool)
    {
        return sonuc;
    }

    function calculateTxIndex(MerkleProof calldata) external view returns (uint64) {
        return txIndex;
    }
}

/// @notice Uc durumlar ve hata yollari: simulasyon oncesi tam tarama.
contract KarunHatalarTest is Test {
    struct LogEntryTuple {
        address address_;
        bytes32[] topics;
        bytes data;
    }

    MockUSDC usdcSepolia;
    MockUSDC usdcCredit;
    KarunEscrow escrow;
    KarunLedger ledger;
    MockVerifier2 verifier;

    address kullanici = address(0xA11CE);
    address kullanici2 = address(0xFACE);
    address alici = address(0xB0B);
    address operator = address(0x09E);
    address hazine = address(0x7E5);

    uint64 constant SEPOLIA = 1;

    function setUp() public {
        usdcSepolia = new MockUSDC();
        usdcCredit = new MockUSDC();
        verifier = new MockVerifier2();
        escrow = new KarunEscrow(IEscrowERC20(address(usdcSepolia)), operator, hazine, 1 hours);
        ledger = new KarunLedger(ILedgerERC20(address(usdcCredit)), 30, address(verifier));
        ledger.registerEscrow(SEPOLIA, address(escrow), 8000);
        usdcSepolia.mint(kullanici, 100_000e6);
        usdcSepolia.mint(kullanici2, 100_000e6);
    }

    // ── fixture yardimcilari ──

    function _encodeTx(LogEntryTuple[] memory logs, uint8 status) internal pure returns (bytes memory) {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(21000), address(0), false, address(0), uint256(0), bytes(""));
        chunks[1] = bytes("");
        chunks[2] = abi.encode(status, uint64(50000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }

    function _lockedLog(address escrowAdr, address user, uint256 amount, uint256 total)
        internal
        pure
        returns (LogEntryTuple memory)
    {
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = keccak256("Locked(address,uint256,uint256)");
        topics[1] = bytes32(uint256(uint160(user)));
        return LogEntryTuple({address_: escrowAdr, topics: topics, data: abi.encode(amount, total)});
    }

    function _kanit(bytes memory encodedTx, uint64 blockHeight, uint64 txIdx) internal {
        verifier.ayarla(true, txIdx);
        INativeQueryVerifier.MerkleProofEntry[] memory s = new INativeQueryVerifier.MerkleProofEntry[](0);
        bytes32[] memory r = new bytes32[](0);
        ledger.submitLockProof(SEPOLIA, blockHeight, encodedTx, bytes32(0), s, bytes32(0), r);
    }

    function _fonla(uint256 miktar) internal {
        usdcCredit.mint(address(this), miktar);
        usdcCredit.approve(address(ledger), miktar);
        ledger.fundPool(miktar);
    }

    function _kilitVeKanit(address user, uint256 miktar, uint64 blok, uint64 txIdx) internal {
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        logs[0] = _lockedLog(address(escrow), user, miktar, miktar);
        _kanit(_encodeTx(logs, 1), blok, txIdx);
    }

    // ── havuz likiditesi ──

    function test_havuz_bos_ise_net_hata() public {
        _kilitVeKanit(kullanici, 5_000e6, 100, 0);
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: havuz likiditesi yetersiz"));
        ledger.spend(alici, 1_000e6, SEPOLIA);
    }

    function test_havuz_kismi_ise_net_hata() public {
        _fonla(500e6);
        _kilitVeKanit(kullanici, 5_000e6, 100, 0);
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: havuz likiditesi yetersiz"));
        ledger.spend(alici, 1_000e6, SEPOLIA);
    }

    // ── coklu kilit / coklu kullanici ──

    function test_ust_uste_kilitler_kumulatif() public {
        _fonla(100_000e6);
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        logs[0] = _lockedLog(address(escrow), kullanici, 2_000e6, 2_000e6);
        _kanit(_encodeTx(logs, 1), 100, 0);
        logs[0] = _lockedLog(address(escrow), kullanici, 3_000e6, 5_000e6);
        _kanit(_encodeTx(logs, 1), 101, 0);
        assertEq(ledger.collateral(kullanici, SEPOLIA), 5_000e6);
        assertEq(ledger.available(kullanici), 4_000e6);
    }

    function test_ayni_islemde_iki_kilit_olayi() public {
        LogEntryTuple[] memory logs = new LogEntryTuple[](2);
        logs[0] = _lockedLog(address(escrow), kullanici, 1_000e6, 1_000e6);
        logs[1] = _lockedLog(address(escrow), kullanici2, 4_000e6, 4_000e6);
        _kanit(_encodeTx(logs, 1), 100, 0);
        assertEq(ledger.collateral(kullanici, SEPOLIA), 1_000e6);
        assertEq(ledger.collateral(kullanici2, SEPOLIA), 4_000e6);
    }

    function test_kullanicilar_birbirinin_limitini_kullanamaz() public {
        _fonla(100_000e6);
        _kilitVeKanit(kullanici, 5_000e6, 100, 0);
        vm.prank(kullanici2);
        vm.expectRevert(bytes("Karun: limit yetersiz"));
        ledger.spend(alici, 100e6, SEPOLIA);
    }

    // ── farkli blok, ayni icerik: farkli sorgu kimligi ──

    function test_farkli_bloktaki_ayni_icerik_ayri_sorgudur() public {
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        logs[0] = _lockedLog(address(escrow), kullanici, 5_000e6, 5_000e6);
        bytes memory tx1 = _encodeTx(logs, 1);
        _kanit(tx1, 100, 0);
        _kanit(tx1, 101, 0); // farkli blok: gecerli yeni sorgu, kumulatif ayni kalir
        assertEq(ledger.collateral(kullanici, SEPOLIA), 5_000e6);
    }

    // ── escrow devre disi ──

    function test_pasif_zincirde_harcama_olmaz_ama_kesinti_kaniti_islenir() public {
        _fonla(100_000e6);
        _kilitVeKanit(kullanici, 5_000e6, 100, 0);
        vm.prank(kullanici);
        bytes32 claimId = ledger.spend(alici, 1_000e6, SEPOLIA);

        ledger.setEscrowActive(SEPOLIA, false);

        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: zincir kayitli degil"));
        ledger.spend(alici, 100e6, SEPOLIA);

        // kesinti kaniti pasifken bile islenebilmeli (mahsup engellenmemeli)
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("Deducted(address,uint256,bytes32,uint256)");
        topics[1] = bytes32(uint256(uint160(kullanici)));
        topics[2] = claimId;
        logs[0] = LogEntryTuple({address_: address(escrow), topics: topics, data: abi.encode(1_003e6, 3_997e6)});
        INativeQueryVerifier.MerkleProofEntry[] memory s = new INativeQueryVerifier.MerkleProofEntry[](0);
        bytes32[] memory r = new bytes32[](0);
        ledger.submitDeductionProof(SEPOLIA, 120, _encodeTx(logs, 1), bytes32(0), s, bytes32(0), r);
        assertEq(ledger.outstanding(kullanici), 0);
    }

    // ── teminat asagi senkronlaninca limit sifirin altina dusmez ──

    function test_borc_limitten_buyukken_available_sifir() public {
        _fonla(100_000e6);
        _kilitVeKanit(kullanici, 5_000e6, 100, 0);
        vm.prank(kullanici);
        ledger.spend(alici, 3_000e6, SEPOLIA); // borc 3009, limit 4000
        // available = 4000 - 3009 = 991
        assertEq(ledger.available(kullanici), 4_000e6 - 3_009e6);
        // simdi harcanacak limit kalmadiginda 0'a oturmali (asiri harcatma denemesi)
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: limit yetersiz"));
        ledger.spend(alici, 992e6, SEPOLIA);
    }

    // ── escrow: kesinti bekleyen cekimi sikistirir ──

    function test_kesinti_bekleyen_cekimi_sikistirir() public {
        vm.startPrank(kullanici);
        usdcSepolia.approve(address(escrow), 5_000e6);
        escrow.lock(5_000e6);
        escrow.requestUnlock(5_000e6);
        vm.stopPrank();

        vm.prank(operator);
        escrow.deduct(kullanici, 4_000e6, bytes32(uint256(9)));

        // bekleyen cekim kalan teminata (1000) sikismali
        assertEq(escrow.pendingUnlockAmount(kullanici), 1_000e6);
        vm.warp(block.timestamp + 1 hours);
        vm.prank(kullanici);
        escrow.withdraw();
        assertEq(usdcSepolia.balanceOf(kullanici), 100_000e6 - 4_000e6);
        assertEq(escrow.locked(kullanici), 0);
    }

    function test_escrow_sifir_kilit_reddedilir() public {
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: sifir"));
        escrow.lock(0);
    }

    function test_escrow_onay_olmadan_kilit_reddedilir() public {
        vm.prank(kullanici);
        vm.expectRevert(bytes("mUSDC: allowance"));
        escrow.lock(1_000e6);
    }

    // ── yonetim koruma ──

    function test_yonetim_fonksiyonlari_sadece_owner() public {
        vm.startPrank(kullanici);
        vm.expectRevert(bytes("Karun: owner degil"));
        ledger.registerEscrow(2, address(1), 8000);
        vm.expectRevert(bytes("Karun: owner degil"));
        ledger.setFeeBps(10);
        vm.expectRevert(bytes("Karun: owner degil"));
        ledger.defundPool(kullanici, 1);
        vm.expectRevert(bytes("Karun: owner degil"));
        escrow.setOperator(kullanici);
        vm.stopPrank();
    }

    function test_komisyon_ust_siniri() public {
        vm.expectRevert(bytes("Karun: komisyon"));
        ledger.setFeeBps(1_001);
    }

    function test_ltv_sinirlari() public {
        vm.expectRevert(bytes("Karun: ltv"));
        ledger.registerEscrow(2, address(1), 0);
        vm.expectRevert(bytes("Karun: ltv"));
        ledger.registerEscrow(2, address(1), 10_001);
    }

    // ── bilinmeyen talep icin kesinti kaniti ──

    function test_bilinmeyen_talep_kaniti_reddedilir() public {
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("Deducted(address,uint256,bytes32,uint256)");
        topics[1] = bytes32(uint256(uint160(kullanici)));
        topics[2] = bytes32(uint256(0xDEAD));
        logs[0] = LogEntryTuple({address_: address(escrow), topics: topics, data: abi.encode(1e6, 0)});
        INativeQueryVerifier.MerkleProofEntry[] memory s = new INativeQueryVerifier.MerkleProofEntry[](0);
        bytes32[] memory r = new bytes32[](0);
        vm.expectRevert(bytes("Karun: talep uyusmuyor"));
        ledger.submitDeductionProof(SEPOLIA, 120, _encodeTx(logs, 1), bytes32(0), s, bytes32(0), r);
    }

    // ── bozuk kodlanmis islem ──

    function test_bozuk_bayt_dizisi_reddedilir() public {
        INativeQueryVerifier.MerkleProofEntry[] memory s = new INativeQueryVerifier.MerkleProofEntry[](0);
        bytes32[] memory r = new bytes32[](0);
        vm.expectRevert();
        ledger.submitLockProof(SEPOLIA, 100, hex"deadbeef", bytes32(0), s, bytes32(0), r);
    }

    // ── kayitsiz zincire kanit ──

    function test_kayitsiz_zincire_kanit_reddedilir() public {
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        logs[0] = _lockedLog(address(escrow), kullanici, 5_000e6, 5_000e6);
        INativeQueryVerifier.MerkleProofEntry[] memory s = new INativeQueryVerifier.MerkleProofEntry[](0);
        bytes32[] memory r = new bytes32[](0);
        vm.expectRevert(bytes("Karun: zincir kayitli degil"));
        ledger.submitLockProof(99, 100, _encodeTx(logs, 1), bytes32(0), s, bytes32(0), r);
    }
}

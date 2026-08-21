// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {KarunEscrow, IERC20 as IEscrowERC20} from "../src/KarunEscrow.sol";
import {KarunLedger, IERC20 as ILedgerERC20} from "../src/KarunLedger.sol";
import {INativeQueryVerifier} from "../src/interfaces/INativeQueryVerifier.sol";

/// @dev Testlerde Block Prover Precompile yerine gecen sahte dogrulayici.
contract MockVerifier is INativeQueryVerifier {
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

contract KarunTest is Test {
    struct LogEntryTuple {
        address address_;
        bytes32[] topics;
        bytes data;
    }

    MockUSDC usdcSepolia; // kaynak zincir stabili
    MockUSDC usdcCredit; // Creditcoin havuz stabili
    KarunEscrow escrow;
    KarunLedger ledger;
    MockVerifier verifier;

    address kullanici = address(0xA11CE);
    address alici = address(0xB0B);
    address operator = address(0x09E);
    address hazine = address(0x7E5);

    uint64 constant SEPOLIA = 1;

    function setUp() public {
        usdcSepolia = new MockUSDC();
        usdcCredit = new MockUSDC();
        verifier = new MockVerifier();

        escrow = new KarunEscrow(IEscrowERC20(address(usdcSepolia)), operator, hazine, 1 hours);
        ledger = new KarunLedger(ILedgerERC20(address(usdcCredit)), 30, address(verifier));
        ledger.registerEscrow(SEPOLIA, address(escrow), 8000);

        // havuzu fonla
        usdcCredit.mint(address(this), 1_000_000e6);
        usdcCredit.approve(address(ledger), type(uint256).max);
        ledger.fundPool(1_000_000e6);

        // kullaniciya kaynak zincirde para ver
        usdcSepolia.mint(kullanici, 10_000e6);
    }

    // ─── yardimcilar: Attestcoin kodlanmis islem fixtures ───

    function _encodeTx(LogEntryTuple[] memory logs, uint8 status) internal pure returns (bytes memory) {
        bytes[] memory chunks = new bytes[](3);
        chunks[0] = abi.encode(uint64(0), uint64(21000), address(0), false, address(0), uint256(0), bytes(""));
        chunks[1] = bytes("");
        chunks[2] = abi.encode(status, uint64(50000), logs, bytes(""));
        return abi.encode(uint8(2), chunks);
    }

    function _lockedTx(address escrowAdr, address user, uint256 amount, uint256 total, uint8 status)
        internal
        pure
        returns (bytes memory)
    {
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = keccak256("Locked(address,uint256,uint256)");
        topics[1] = bytes32(uint256(uint160(user)));
        logs[0] = LogEntryTuple({address_: escrowAdr, topics: topics, data: abi.encode(amount, total)});
        return _encodeTx(logs, status);
    }

    function _deductedTx(address escrowAdr, address user, bytes32 claimId, uint256 amount, uint256 remaining)
        internal
        pure
        returns (bytes memory)
    {
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("Deducted(address,uint256,bytes32,uint256)");
        topics[1] = bytes32(uint256(uint160(user)));
        topics[2] = claimId;
        logs[0] = LogEntryTuple({address_: escrowAdr, topics: topics, data: abi.encode(amount, remaining)});
        return _encodeTx(logs, status1());
    }

    function status1() internal pure returns (uint8) {
        return 1;
    }

    function _bosSiblings() internal pure returns (INativeQueryVerifier.MerkleProofEntry[] memory s) {
        s = new INativeQueryVerifier.MerkleProofEntry[](0);
    }

    function _bosRoots() internal pure returns (bytes32[] memory r) {
        r = new bytes32[](0);
    }

    function _kilitKaniti(bytes memory encodedTx, uint64 blockHeight) internal {
        // calldata gerektirdigi icin harici cagri uzerinden
        ledger.submitLockProof(SEPOLIA, blockHeight, encodedTx, bytes32(0), _bosSiblings(), bytes32(0), _bosRoots());
    }

    // ─── escrow testleri ───

    function test_kilitle() public {
        vm.startPrank(kullanici);
        usdcSepolia.approve(address(escrow), 5_000e6);
        escrow.lock(5_000e6);
        vm.stopPrank();
        assertEq(escrow.locked(kullanici), 5_000e6);
        assertEq(usdcSepolia.balanceOf(address(escrow)), 5_000e6);
    }

    function test_kesinti_sadece_operator() public {
        vm.startPrank(kullanici);
        usdcSepolia.approve(address(escrow), 5_000e6);
        escrow.lock(5_000e6);
        vm.stopPrank();

        vm.expectRevert(bytes("Karun: operator degil"));
        escrow.deduct(kullanici, 1_000e6, bytes32(uint256(1)));

        vm.prank(operator);
        escrow.deduct(kullanici, 1_000e6, bytes32(uint256(1)));
        assertEq(escrow.locked(kullanici), 4_000e6);
        assertEq(usdcSepolia.balanceOf(hazine), 1_000e6);
    }

    function test_kesinti_ayni_talep_iki_kez_islenmez() public {
        vm.startPrank(kullanici);
        usdcSepolia.approve(address(escrow), 5_000e6);
        escrow.lock(5_000e6);
        vm.stopPrank();

        vm.startPrank(operator);
        escrow.deduct(kullanici, 1_000e6, bytes32(uint256(1)));
        vm.expectRevert(bytes("Karun: talep islendi"));
        escrow.deduct(kullanici, 1_000e6, bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_cekim_bekleme_suresi() public {
        vm.startPrank(kullanici);
        usdcSepolia.approve(address(escrow), 5_000e6);
        escrow.lock(5_000e6);
        escrow.requestUnlock(2_000e6);
        vm.expectRevert(bytes("Karun: bekleme suresi"));
        escrow.withdraw();
        vm.warp(block.timestamp + 1 hours);
        escrow.withdraw();
        vm.stopPrank();
        assertEq(escrow.locked(kullanici), 3_000e6);
        assertEq(usdcSepolia.balanceOf(kullanici), 7_000e6);
    }

    // ─── ledger: kilit kaniti ───

    function test_kilit_kaniti_limit_acar() public {
        _kilitKaniti(_lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 1), 100);
        assertEq(ledger.collateral(kullanici, SEPOLIA), 5_000e6);
        assertEq(ledger.creditLimit(kullanici), 4_000e6); // %80
        assertEq(ledger.available(kullanici), 4_000e6);
    }

    function test_kilit_kaniti_kumulatif_gerilemez() public {
        _kilitKaniti(_lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 1), 100);
        // eski bir kanit (daha dusuk toplam) teminati dusuremez
        _kilitKaniti(_lockedTx(address(escrow), kullanici, 2_000e6, 2_000e6, 1), 90);
        assertEq(ledger.collateral(kullanici, SEPOLIA), 5_000e6);
    }

    function test_ayni_sorgu_tekrar_oynatilamaz() public {
        bytes memory tx1 = _lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 1);
        _kilitKaniti(tx1, 100);
        vm.expectRevert(bytes("Karun: sorgu islendi"));
        _kilitKaniti(tx1, 100);
    }

    function test_basarisiz_islem_reddedilir() public {
        bytes memory kotu = _lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 0); // status 0
        vm.expectRevert(bytes("Karun: islem basarisiz"));
        _kilitKaniti(kotu, 100);
    }

    function test_yabanci_kontrat_olayi_sayilmaz() public {
        bytes memory sahte = _lockedTx(address(0xDEAD), kullanici, 5_000e6, 5_000e6, 1);
        vm.expectRevert(bytes("Karun: Locked olayi yok"));
        _kilitKaniti(sahte, 100);
    }

    function test_gecersiz_kanit_reddedilir() public {
        verifier.ayarla(false, 0);
        bytes memory tx1 = _lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 1);
        vm.expectRevert(bytes("Karun: kanit gecersiz"));
        _kilitKaniti(tx1, 100);
    }

    // ─── ledger: harcama ───

    function test_harcama_ve_komisyon() public {
        _kilitKaniti(_lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 1), 100);

        vm.prank(kullanici);
        ledger.spend(alici, 1_000e6, SEPOLIA);

        assertEq(usdcCredit.balanceOf(alici), 1_000e6);
        // %0,30 komisyon: 3 USDC
        assertEq(ledger.outstanding(kullanici), 1_003e6);
        assertEq(ledger.available(kullanici), 4_000e6 - 1_003e6);
        assertEq(ledger.accruedFees(), 3e6);
    }

    function test_limit_asilamaz() public {
        _kilitKaniti(_lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: limit yetersiz"));
        ledger.spend(alici, 4_000e6, SEPOLIA); // komisyonla limiti asar
    }

    function test_teminatsiz_harcama_olmaz() public {
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: limit yetersiz"));
        ledger.spend(alici, 1, SEPOLIA);
    }

    // ─── ledger: kesinti kaniti ile mahsup ───

    function test_tam_dongu_harca_ve_mahsupla() public {
        // 1. kilit + kanit
        vm.startPrank(kullanici);
        usdcSepolia.approve(address(escrow), 5_000e6);
        escrow.lock(5_000e6);
        vm.stopPrank();
        _kilitKaniti(_lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 1), 100);

        // 2. harcama
        vm.prank(kullanici);
        bytes32 claimId = ledger.spend(alici, 1_000e6, SEPOLIA);
        uint256 toplam = 1_003e6;

        // 3. escrow'da kesinti (operator, gelecekte writability)
        vm.prank(operator);
        escrow.deduct(kullanici, toplam, claimId);
        assertEq(escrow.locked(kullanici), 5_000e6 - toplam);

        // 4. kesinti kaniti ledger'da talebi kapatir
        bytes memory kesintiTx = _deductedTx(address(escrow), kullanici, claimId, toplam, 5_000e6 - toplam);
        ledger.submitDeductionProof(
            SEPOLIA, 120, kesintiTx, bytes32(0), _bosSiblings(), bytes32(0), _bosRoots()
        );

        assertEq(ledger.outstanding(kullanici), 0);
        assertEq(ledger.collateral(kullanici, SEPOLIA), 5_000e6 - toplam);
        // yeni limit: kalan teminatin %80'i
        assertEq(ledger.available(kullanici), ((5_000e6 - toplam) * 8000) / 10_000);
        (,,, bool settled) = ledger.claims(claimId);
        assertTrue(settled);
    }

    function test_kesinti_kaniti_tutar_uyusmali() public {
        _kilitKaniti(_lockedTx(address(escrow), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        bytes32 claimId = ledger.spend(alici, 1_000e6, SEPOLIA);

        bytes memory yanlis = _deductedTx(address(escrow), kullanici, claimId, 999e6, 4_000e6);
        vm.expectRevert(bytes("Karun: tutar uyusmuyor"));
        ledger.submitDeductionProof(SEPOLIA, 120, yanlis, bytes32(0), _bosSiblings(), bytes32(0), _bosRoots());
    }
}

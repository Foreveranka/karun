// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {KarunEscrow, IERC20 as IEscrowERC20} from "../src/KarunEscrow.sol";
import {KarunSpender, IERC20 as ISpenderERC20} from "../src/KarunSpender.sol";
import {KarunLedger} from "../src/KarunLedger.sol";
import {INativeQueryVerifier} from "../src/interfaces/INativeQueryVerifier.sol";

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

/// @notice Coklu zincir mimarisi: Creditcoin hakem, odeme hedef zincirde.
contract KarunTest is Test {
    struct LogEntryTuple {
        address address_;
        bytes32[] topics;
        bytes data;
    }

    // A zinciri: teminat (Sepolia benzeri) — hem escrow hem spender var
    MockUSDC usdcA;
    KarunEscrow escrowA;
    KarunSpender spenderA;
    // B zinciri: yalnizca odeme ucu (Base benzeri)
    MockUSDC usdcB;
    KarunSpender spenderB;

    KarunLedger ledger; // Creditcoin: hakem
    MockVerifier verifier;

    address kullanici = address(0xA11CE);
    address alici = address(0xB0B);
    address operator = address(0x09E);
    address hazine = address(0x7E5);

    uint64 constant A = 1; // teminat + odeme
    uint64 constant B = 2; // yalnizca odeme

    uint64 sorguSayaci;

    function setUp() public {
        verifier = new MockVerifier();

        usdcA = new MockUSDC();
        escrowA = new KarunEscrow(IEscrowERC20(address(usdcA)), operator, hazine, 1 hours);
        spenderA = new KarunSpender(ISpenderERC20(address(usdcA)), operator);

        usdcB = new MockUSDC();
        spenderB = new KarunSpender(ISpenderERC20(address(usdcB)), operator);

        ledger = new KarunLedger(30, address(verifier));
        ledger.zincirTanimla(A, address(escrowA), address(spenderA), 8000, true, true);
        ledger.zincirTanimla(B, address(0), address(spenderB), 8000, false, true);

        // havuzlari fonla
        usdcA.mint(address(this), 100_000e6);
        usdcA.approve(address(spenderA), type(uint256).max);
        spenderA.fund(50_000e6);
        usdcB.mint(address(this), 100_000e6);
        usdcB.approve(address(spenderB), type(uint256).max);
        spenderB.fund(50_000e6);

        usdcA.mint(kullanici, 10_000e6);
    }

    // ── fixture ──

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

    function _paidTx(address spenderAdr, bytes32 claimId, address recipient, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        LogEntryTuple[] memory logs = new LogEntryTuple[](1);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = keccak256("Paid(bytes32,address,uint256)");
        topics[1] = claimId;
        topics[2] = bytes32(uint256(uint160(recipient)));
        logs[0] = LogEntryTuple({address_: spenderAdr, topics: topics, data: abi.encode(amount)});
        return _encodeTx(logs, 1);
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
        return _encodeTx(logs, 1);
    }

    function _bosSiblings() internal pure returns (INativeQueryVerifier.MerkleProofEntry[] memory s) {
        s = new INativeQueryVerifier.MerkleProofEntry[](0);
    }

    function _bosRoots() internal pure returns (bytes32[] memory r) {
        r = new bytes32[](0);
    }

    function _kanitPaketi(uint64 chainKey, bytes memory encodedTx, uint64 blok)
        internal pure returns (KarunLedger.Kanit memory)
    {
        return KarunLedger.Kanit({
            chainKey: chainKey,
            blockHeight: blok,
            encodedTransaction: encodedTx,
            merkleRoot: bytes32(0),
            siblings: new INativeQueryVerifier.MerkleProofEntry[](0),
            lowerEndpointDigest: bytes32(0),
            continuityRoots: new bytes32[](0)
        });
    }

    function _kilitKaniti(bytes memory encodedTx, uint64 blok) internal {
        verifier.ayarla(true, ++sorguSayaci);
        ledger.submitLockProof(_kanitPaketi(A, encodedTx, blok));
    }

    function _odemeKaniti(uint64 chainKey, bytes memory encodedTx, uint64 blok) internal {
        verifier.ayarla(true, ++sorguSayaci);
        ledger.submitPaymentProof(_kanitPaketi(chainKey, encodedTx, blok));
    }

    function _kesintiKaniti(bytes memory encodedTx, uint64 blok) internal {
        verifier.ayarla(true, ++sorguSayaci);
        ledger.submitDeductionProof(_kanitPaketi(A, encodedTx, blok));
    }

    // ── escrow ──

    function test_kilitle() public {
        vm.startPrank(kullanici);
        usdcA.approve(address(escrowA), 5_000e6);
        escrowA.lock(5_000e6);
        vm.stopPrank();
        assertEq(escrowA.locked(kullanici), 5_000e6);
    }

    function test_kesinti_sadece_operator() public {
        vm.startPrank(kullanici);
        usdcA.approve(address(escrowA), 5_000e6);
        escrowA.lock(5_000e6);
        vm.stopPrank();
        vm.expectRevert(bytes("Karun: operator degil"));
        escrowA.deduct(kullanici, 1_000e6, bytes32(uint256(1)));
        vm.prank(operator);
        escrowA.deduct(kullanici, 1_000e6, bytes32(uint256(1)));
        assertEq(escrowA.locked(kullanici), 4_000e6);
    }

    function test_cekim_bekleme_suresi() public {
        vm.startPrank(kullanici);
        usdcA.approve(address(escrowA), 5_000e6);
        escrowA.lock(5_000e6);
        escrowA.requestUnlock(2_000e6);
        vm.expectRevert(bytes("Karun: bekleme suresi"));
        escrowA.withdraw();
        vm.warp(block.timestamp + 1 hours);
        escrowA.withdraw();
        vm.stopPrank();
        assertEq(escrowA.locked(kullanici), 3_000e6);
    }

    // ── spender ──

    function test_spender_sadece_operator_oder() public {
        vm.expectRevert(bytes("Karun: operator degil"));
        spenderB.payout(bytes32(uint256(1)), alici, 100e6);
        vm.prank(operator);
        spenderB.payout(bytes32(uint256(1)), alici, 100e6);
        assertEq(usdcB.balanceOf(alici), 100e6);
    }

    function test_spender_ayni_odeme_iki_kez_yapilmaz() public {
        vm.startPrank(operator);
        spenderB.payout(bytes32(uint256(1)), alici, 100e6);
        vm.expectRevert(bytes("Karun: odeme islendi"));
        spenderB.payout(bytes32(uint256(1)), alici, 100e6);
        vm.stopPrank();
    }

    function test_spender_likidite_yetersizse_hata() public {
        vm.prank(operator);
        vm.expectRevert(bytes("Karun: havuz likiditesi yetersiz"));
        spenderB.payout(bytes32(uint256(1)), alici, 999_999e6);
    }

    // ── ledger: limit ──

    function test_kilit_kaniti_limit_acar() public {
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        assertEq(ledger.collateral(kullanici, A), 5_000e6);
        assertEq(ledger.available(kullanici), 4_000e6);
    }

    function test_ayni_sorgu_tekrar_oynatilamaz() public {
        bytes memory tx1 = _lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1);
        verifier.ayarla(true, 7);
        ledger.submitLockProof(_kanitPaketi(A, tx1, 100));
        vm.expectRevert(bytes("Karun: sorgu islendi"));
        ledger.submitLockProof(_kanitPaketi(A, tx1, 100));
    }

    function test_basarisiz_islem_reddedilir() public {
        verifier.ayarla(true, ++sorguSayaci);
        vm.expectRevert(bytes("Karun: islem basarisiz"));
        ledger.submitLockProof(_kanitPaketi(A, _lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 0), 100));
    }

    function test_yabanci_kontrat_olayi_sayilmaz() public {
        verifier.ayarla(true, ++sorguSayaci);
        vm.expectRevert(bytes("Karun: Locked olayi yok"));
        ledger.submitLockProof(_kanitPaketi(A, _lockedTx(address(0xDEAD), kullanici, 5_000e6, 5_000e6, 1), 100));
    }

    function test_gecersiz_kanit_reddedilir() public {
        verifier.ayarla(false, 1);
        vm.expectRevert(bytes("Karun: kanit gecersiz"));
        ledger.submitLockProof(_kanitPaketi(A, _lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100));
    }

    // ── ledger: odeme talebi ──

    function test_baska_zincirde_odeme_talebi() public {
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        // A zincirinde teminat, B zincirinde odeme: mimarinin ozu
        bytes32 claimId = ledger.requestPayment(alici, 1_000e6, B, A);
        (address user, uint64 kaynak, uint64 hedef,, uint256 tutar, uint256 toplam, bool odendi, bool kapandi) =
            ledger.talepler(claimId);
        assertEq(user, kullanici);
        assertEq(kaynak, A);
        assertEq(hedef, B);
        assertEq(tutar, 1_000e6);
        assertEq(toplam, 1_003e6);
        assertFalse(odendi);
        assertFalse(kapandi);
        assertEq(ledger.outstanding(kullanici), 1_003e6);
    }

    function test_odeme_kapali_zincire_talep_reddedilir() public {
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: odeme zinciri kapali"));
        ledger.requestPayment(alici, 100e6, 99, A);
    }

    function test_teminatsiz_zincirden_kesinti_istenemez() public {
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: teminat zinciri kapali"));
        ledger.requestPayment(alici, 100e6, B, B); // B'de teminat yok
    }

    function test_limit_asilamaz() public {
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: limit yetersiz"));
        ledger.requestPayment(alici, 4_000e6, B, A);
    }

    function test_teminatsiz_kullanici_odeyemez() public {
        vm.prank(kullanici);
        vm.expectRevert(bytes("Karun: limit yetersiz"));
        ledger.requestPayment(alici, 1e6, B, A);
    }

    // ── TAM DONGU: A'da kilitle, B'de ode, A'dan kes ──

    function test_tam_dongu_capraz_zincir() public {
        // 1. A zincirinde kilit + kanit
        vm.startPrank(kullanici);
        usdcA.approve(address(escrowA), 5_000e6);
        escrowA.lock(5_000e6);
        vm.stopPrank();
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        assertEq(ledger.available(kullanici), 4_000e6);

        // 2. B zincirinde odeme talebi (kullanicinin B'de hic parasi yok!)
        vm.prank(kullanici);
        bytes32 claimId = ledger.requestPayment(alici, 1_000e6, B, A);

        // 3. B zincirindeki Spender aliciya oder (worker/Inbox)
        vm.prank(operator);
        spenderB.payout(claimId, alici, 1_000e6);
        assertEq(usdcB.balanceOf(alici), 1_000e6);

        // 4. odeme Attestcoin ile kanitlanir
        _odemeKaniti(B, _paidTx(address(spenderB), claimId, alici, 1_000e6), 110);
        (,,,,,, bool odendi,) = ledger.talepler(claimId);
        assertTrue(odendi);

        // 5. A zincirindeki escrow'dan otomatik kesinti
        vm.prank(operator);
        escrowA.deduct(kullanici, 1_003e6, claimId);
        assertEq(escrowA.locked(kullanici), 5_000e6 - 1_003e6);

        // 6. kesinti kanitlanir, talep kapanir
        _kesintiKaniti(_deductedTx(address(escrowA), kullanici, claimId, 1_003e6, 3_997e6), 120);
        assertEq(ledger.outstanding(kullanici), 0);
        assertEq(ledger.collateral(kullanici, A), 3_997e6);
        (,,,,,,, bool kapandi) = ledger.talepler(claimId);
        assertTrue(kapandi);
        assertEq(ledger.available(kullanici), (3_997e6 * 8000) / 10_000);
    }

    function test_odeme_kaniti_tutar_uyusmali() public {
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        bytes32 claimId = ledger.requestPayment(alici, 1_000e6, B, A);
        verifier.ayarla(true, ++sorguSayaci);
        vm.expectRevert(bytes("Karun: odeme uyusmuyor"));
        ledger.submitPaymentProof(_kanitPaketi(B, _paidTx(address(spenderB), claimId, alici, 999e6), 110));
    }

    function test_odeme_kaniti_yanlis_zincirde_reddedilir() public {
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        bytes32 claimId = ledger.requestPayment(alici, 1_000e6, B, A);
        // odeme B icin yetkilendirildi ama A'da kanitlanmaya calisiliyor
        verifier.ayarla(true, ++sorguSayaci);
        vm.expectRevert(bytes("Karun: zincir uyusmuyor"));
        ledger.submitPaymentProof(_kanitPaketi(A, _paidTx(address(spenderA), claimId, alici, 1_000e6), 110));
    }

    function test_kesinti_kaniti_tutar_uyusmali() public {
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        bytes32 claimId = ledger.requestPayment(alici, 1_000e6, B, A);
        verifier.ayarla(true, ++sorguSayaci);
        vm.expectRevert(bytes("Karun: tutar uyusmuyor"));
        ledger.submitDeductionProof(_kanitPaketi(A, _deductedTx(address(escrowA), kullanici, claimId, 999e6, 4_000e6), 120));
    }

    function test_ayni_zincirde_odeme_de_calisir() public {
        // teminat A'da, odeme de A'da (klasik durum)
        _kilitKaniti(_lockedTx(address(escrowA), kullanici, 5_000e6, 5_000e6, 1), 100);
        vm.prank(kullanici);
        bytes32 claimId = ledger.requestPayment(alici, 500e6, A, A);
        vm.prank(operator);
        spenderA.payout(claimId, alici, 500e6);
        assertEq(usdcA.balanceOf(alici), 500e6);
        _odemeKaniti(A, _paidTx(address(spenderA), claimId, alici, 500e6), 110);
        (,,,,,, bool odendi,) = ledger.talepler(claimId);
        assertTrue(odendi);
    }
}

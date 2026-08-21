// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title KarunEscrow
/// @notice Kaynak zincirdeki (or. Sepolia) teminat kasasi. Kullanici stablecoin kilitler,
///         Creditcoin'deki KarunLedger bu kilitleri Attestcoin Protocol readability ile
///         dogrulayip tek bir harcama limiti acar. Harcama gerceklesince karsiligi
///         buradan kesilir (deduct) ve kesinti yine Attestcoin ile Creditcoin'de kanitlanir.
/// @dev Kesintiyi bugun operator tetikler; Attestcoin Writability testnete cikinca
///      operator yerine Inbox mesaji gececek (bkz. README: yol haritasi).
contract KarunEscrow {
    IERC20 public immutable token;
    address public owner;
    address public operator; // kesinti tetikleyici (gelecekte: Attestcoin Inbox)
    address public treasury; // kesilen fonlarin gittigi protokol kasasi
    uint256 public unlockDelay; // cekim talebi bekleme suresi (kesintilerin islenmesi icin)

    mapping(address => uint256) public locked;
    mapping(address => uint256) public pendingUnlockAmount;
    mapping(address => uint256) public pendingUnlockTime;
    mapping(bytes32 => bool) public processedClaims;

    /// @param user kilitleyen kullanici
    /// @param amount bu islemde kilitlenen miktar
    /// @param totalLocked kullanicinin bu islemden sonraki toplam kilidi (ledger senkronu icin kumulatif)
    event Locked(address indexed user, uint256 amount, uint256 totalLocked);
    event Deducted(address indexed user, uint256 amount, bytes32 indexed claimId, uint256 remainingLocked);
    event UnlockRequested(address indexed user, uint256 amount, uint256 availableAt);
    event Unlocked(address indexed user, uint256 amount, uint256 remainingLocked);

    modifier onlyOwner() {
        require(msg.sender == owner, "Karun: owner degil");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "Karun: operator degil");
        _;
    }

    constructor(IERC20 token_, address operator_, address treasury_, uint256 unlockDelay_) {
        token = token_;
        owner = msg.sender;
        operator = operator_;
        treasury = treasury_;
        unlockDelay = unlockDelay_;
    }

    /// @notice Teminat kilitle. Locked olayi Attestcoin ile Creditcoin'de kanitlanir.
    function lock(uint256 amount) external {
        require(amount > 0, "Karun: sifir");
        require(token.transferFrom(msg.sender, address(this), amount), "Karun: transfer");
        locked[msg.sender] += amount;
        emit Locked(msg.sender, amount, locked[msg.sender]);
    }

    /// @notice Harcama karsiliginin otomatik kesilmesi. claimId, Creditcoin'deki
    ///         KarunLedger'in olusturdugu talep kimligidir; kesinti olayi ledger'da
    ///         Attestcoin readability ile dogrulanarak talep kapatilir.
    function deduct(address user, uint256 amount, bytes32 claimId) external onlyOperator {
        require(!processedClaims[claimId], "Karun: talep islendi");
        require(locked[user] >= amount, "Karun: teminat yetersiz");
        processedClaims[claimId] = true;
        locked[user] -= amount;
        // bekleyen cekim varsa kesinti onceliklidir; cekimi kalan teminata sikistir
        if (pendingUnlockAmount[user] > locked[user]) {
            pendingUnlockAmount[user] = locked[user];
        }
        require(token.transfer(treasury, amount), "Karun: transfer");
        emit Deducted(user, amount, claimId, locked[user]);
    }

    /// @notice Cekim talebi. Bekleme suresi, yoldaki harcamalarin kesintisinin
    ///         islenebilmesi icindir (limit guncellemesi Creditcoin'de yapilir).
    function requestUnlock(uint256 amount) external {
        require(amount > 0 && amount <= locked[msg.sender], "Karun: miktar");
        pendingUnlockAmount[msg.sender] = amount;
        pendingUnlockTime[msg.sender] = block.timestamp + unlockDelay;
        emit UnlockRequested(msg.sender, amount, pendingUnlockTime[msg.sender]);
    }

    function withdraw() external {
        uint256 amount = pendingUnlockAmount[msg.sender];
        require(amount > 0, "Karun: talep yok");
        require(block.timestamp >= pendingUnlockTime[msg.sender], "Karun: bekleme suresi");
        pendingUnlockAmount[msg.sender] = 0;
        pendingUnlockTime[msg.sender] = 0;
        locked[msg.sender] -= amount;
        require(token.transfer(msg.sender, amount), "Karun: transfer");
        emit Unlocked(msg.sender, amount, locked[msg.sender]);
    }

    // ── yonetim ──
    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
    }

    function setTreasury(address treasury_) external onlyOwner {
        treasury = treasury_;
    }

    function setUnlockDelay(uint256 delay_) external onlyOwner {
        unlockDelay = delay_;
    }
}

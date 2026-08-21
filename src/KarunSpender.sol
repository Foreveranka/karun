// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address owner) external view returns (uint256);
}

/// @title KarunSpender
/// @notice Hedef zincirdeki odeme ucu. Karun'un o zincirdeki likidite havuzunu
///         tutar ve Creditcoin'deki KarunLedger onay verdiginde aliciya ODER.
///
///         Onemli: Creditcoin bir ODEME agi degil, HAKEM'dir. Kullanici hangi
///         zincirde odeme istiyorsa, o zincirdeki Spender havuzundan cikar.
///         Kullaniciya sarmalanmis token verilmez; sadece limit tanimlanir.
///
/// @dev Bugun odeme talimatini operator tasir (Attestcoin Writability testnette
///      henuz yok). Writability yayinlaninca `operator` yerine Inbox mesaji gecer;
///      payoutId ve tekrar korumasi ayni kalir.
contract KarunSpender {
    IERC20 public immutable token;
    address public owner;
    address public operator; // odeme tasiyicisi (gelecekte: Attestcoin Inbox)

    mapping(bytes32 => bool) public processedPayouts;
    uint256 public totalPaid;

    event PoolFunded(address indexed from, uint256 amount);
    event PoolDefunded(address indexed to, uint256 amount);
    /// @param payoutId Creditcoin'deki talep kimligi (claimId) ile ayni
    event Paid(bytes32 indexed payoutId, address indexed recipient, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Karun: owner degil");
        _;
    }

    modifier onlyOperator() {
        require(msg.sender == operator, "Karun: operator degil");
        _;
    }

    constructor(IERC20 token_, address operator_) {
        token = token_;
        owner = msg.sender;
        operator = operator_;
    }

    /// @notice Ledger onayli odemeyi aliciya gonderir.
    function payout(bytes32 payoutId, address recipient, uint256 amount) external onlyOperator {
        require(!processedPayouts[payoutId], "Karun: odeme islendi");
        require(recipient != address(0), "Karun: alici");
        require(token.balanceOf(address(this)) >= amount, "Karun: havuz likiditesi yetersiz");
        processedPayouts[payoutId] = true;
        totalPaid += amount;
        require(token.transfer(recipient, amount), "Karun: transfer");
        emit Paid(payoutId, recipient, amount);
    }

    function fund(uint256 amount) external {
        require(token.transferFrom(msg.sender, address(this), amount), "Karun: transfer");
        emit PoolFunded(msg.sender, amount);
    }

    function defund(address to, uint256 amount) external onlyOwner {
        require(token.transfer(to, amount), "Karun: transfer");
        emit PoolDefunded(to, amount);
    }

    function liquidity() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    function setOperator(address operator_) external onlyOwner {
        operator = operator_;
    }
}

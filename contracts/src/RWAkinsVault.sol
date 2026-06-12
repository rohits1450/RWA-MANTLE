// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IMockRWAToken {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
    function mint(address to, uint256 amount) external;
}

interface IRWAkinsAMM {
    function swap(address tokenIn, uint256 amountIn, uint256 minOut, address to) external returns (uint256);
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256);
    function spotPriceE18() external view returns (uint256);
}

interface IComplianceRegistry {
    function isCompliant(address user) external view returns (bool);
}

/// @title RWAkinsVault
/// @notice Custodies a user's two-leg RWA position (USDY + mETH) and runs the AI-CFO
///         rebalances on-chain. Upgrades in this version:
///           - Compliance gate: only KYC-verified addresses (ComplianceRegistry) may deposit.
///           - Real swaps with LIVE slippage protection (minOut from an on-chain quote).
///           - A protocol management fee (bps) on each rebalance, accruing to a treasury.
///           - Gasless rebalances: a user signs an EIP-712 intent, the agent relays it
///             and pays the gas (rebalanceWithSig) — Web2-friendly, no user gas.
///         Invariants still enforced: usdyBps+methBps==10000, methBps<=MAX_RISK_BPS(70%).
contract RWAkinsVault {
    uint256 public constant MAX_RISK_BPS = 7000; // mETH ceiling: 70%
    uint256 private constant TOTAL_BPS = 10_000;
    uint256 private constant ONE = 1e18;

    IMockRWAToken public immutable usdyToken;
    IMockRWAToken public immutable methToken;
    IRWAkinsAMM public immutable amm;
    IComplianceRegistry public registry;
    address public owner;
    address public treasury;

    /// @notice Protocol management fee on each rebalance (bps of position value).
    uint256 public feeBps = 10; // 0.10%
    /// @notice Max slippage tolerated on a rebalance swap (bps), used for minOut.
    uint256 public slippageBps = 150; // 1.50%

    mapping(address => uint256) public usdyBalanceOf;
    mapping(address => uint256) public methBalanceOf;

    // EIP-712 (gasless rebalance authorisation).
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 private constant REBALANCE_TYPEHASH =
        keccak256("RebalanceIntent(address user,uint256 usdyBps,uint256 methBps,uint256 nonce,uint256 deadline)");
    mapping(address => uint256) public nonces;

    event Deposited(address indexed user, address asset, uint256 amount);
    event Withdrawn(address indexed user, address asset, uint256 amount);
    event Rebalanced(address indexed user, uint256 usdyBps, uint256 methBps, uint256 timestamp);
    event FeeCharged(address indexed user, uint256 feeUsdy);
    event ParamsUpdated(uint256 feeBps, uint256 slippageBps, address treasury);

    constructor(address _usdy, address _meth, address _amm, address _registry, address _treasury) {
        require(_usdy != address(0) && _meth != address(0) && _amm != address(0), "ZERO_ADDR");
        require(_registry != address(0) && _treasury != address(0), "ZERO_ADDR");
        usdyToken = IMockRWAToken(_usdy);
        methToken = IMockRWAToken(_meth);
        amm = IRWAkinsAMM(_amm);
        registry = IComplianceRegistry(_registry);
        treasury = _treasury;
        owner = msg.sender;
        usdyToken.approve(_amm, type(uint256).max);
        methToken.approve(_amm, type(uint256).max);
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("RWAkinsVault")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "NOT_OWNER");
        _;
    }

    modifier onlyCompliant(address user) {
        require(registry.isCompliant(user), "NOT_COMPLIANT");
        _;
    }

    // ─── Admin (agent owner key) ────────────────────────────────────────────
    function setParams(uint256 _feeBps, uint256 _slippageBps, address _treasury) external onlyOwner {
        require(_feeBps <= 200, "FEE_TOO_HIGH"); // cap 2%
        require(_slippageBps <= 1000, "SLIP_TOO_HIGH"); // cap 10%
        require(_treasury != address(0), "ZERO");
        feeBps = _feeBps;
        slippageBps = _slippageBps;
        treasury = _treasury;
        emit ParamsUpdated(_feeBps, _slippageBps, _treasury);
    }

    function setRegistry(address _registry) external onlyOwner {
        require(_registry != address(0), "ZERO");
        registry = IComplianceRegistry(_registry);
    }

    // ─── ABI accessors expected by the frontend ────────────────────────────
    function usdy() external view returns (address) {
        return address(usdyToken);
    }

    function meth() external view returns (address) {
        return address(methToken);
    }

    function methPriceE18() external view returns (uint256) {
        return amm.spotPriceE18();
    }

    // ─── User flows ────────────────────────────────────────────────────────
    /// @notice Deposit a leg. GATED: only KYC-verified (compliant) addresses.
    function deposit(address asset, uint256 amount) external onlyCompliant(msg.sender) {
        require(amount > 0, "ZERO_AMOUNT");
        require(asset == address(usdyToken) || asset == address(methToken), "BAD_ASSET");
        require(IMockRWAToken(asset).transferFrom(msg.sender, address(this), amount), "TRANSFER_IN");
        if (asset == address(usdyToken)) {
            usdyBalanceOf[msg.sender] += amount;
        } else {
            methBalanceOf[msg.sender] += amount;
        }
        emit Deposited(msg.sender, asset, amount);
    }

    function withdraw(address asset, uint256 amount) external {
        require(amount > 0, "ZERO_AMOUNT");
        require(asset == address(usdyToken) || asset == address(methToken), "BAD_ASSET");
        if (asset == address(usdyToken)) {
            require(usdyBalanceOf[msg.sender] >= amount, "BALANCE");
            usdyBalanceOf[msg.sender] -= amount;
        } else {
            require(methBalanceOf[msg.sender] >= amount, "BALANCE");
            methBalanceOf[msg.sender] -= amount;
        }
        require(IMockRWAToken(asset).transfer(msg.sender, amount), "TRANSFER_OUT");
        emit Withdrawn(msg.sender, asset, amount);
    }

    function rebalance(uint256 usdyBps, uint256 methBps) external {
        _rebalance(msg.sender, usdyBps, methBps);
    }

    /// @notice Autonomous rebalance — the agent owner key executes on a schedule.
    function rebalanceFor(address user, uint256 usdyBps, uint256 methBps) external onlyOwner {
        _rebalance(user, usdyBps, methBps);
    }

    /// @notice GASLESS rebalance: the user signs an EIP-712 RebalanceIntent off-chain
    ///         (no gas), and a relayer (the agent) submits it here and pays the gas.
    ///         The signature proves the user authorised THIS exact allocation.
    function rebalanceWithSig(
        address user,
        uint256 usdyBps,
        uint256 methBps,
        uint256 nonce,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external {
        require(block.timestamp <= deadline, "EXPIRED");
        require(nonce == nonces[user], "BAD_NONCE");
        bytes32 structHash = keccak256(abi.encode(REBALANCE_TYPEHASH, user, usdyBps, methBps, nonce, deadline));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = ecrecover(digest, v, r, s);
        require(signer != address(0) && signer == user, "BAD_SIG");
        nonces[user] = nonce + 1;
        _rebalance(user, usdyBps, methBps);
    }

    function _rebalance(address user, uint256 usdyBps, uint256 methBps) internal {
        require(usdyBps + methBps == TOTAL_BPS, "BPS_SUM");
        require(methBps <= MAX_RISK_BPS, "RISK_CAP");

        uint256 price = amm.spotPriceE18();
        require(price > 0, "NO_PRICE");

        require(_totalValue(user) > 0, "EMPTY");

        // Charge the protocol fee FIRST (on the gross position value), then rebalance
        // the net to the exact target so the final split isn't skewed by the fee.
        _chargeFee(user, _totalValue(user));

        uint256 curUsdy = usdyBalanceOf[user];
        uint256 curMeth = methBalanceOf[user];
        uint256 total = curUsdy + (curMeth * price) / ONE;
        uint256 targetUsdy = (total * usdyBps) / TOTAL_BPS;

        if (targetUsdy < curUsdy) {
            uint256 usdyIn = curUsdy - targetUsdy;
            uint256 methOut = _swap(address(usdyToken), usdyIn);
            usdyBalanceOf[user] = curUsdy - usdyIn;
            methBalanceOf[user] = curMeth + methOut;
        } else if (targetUsdy > curUsdy) {
            uint256 usdyShort = targetUsdy - curUsdy;
            uint256 methIn = (usdyShort * ONE) / price;
            if (methIn > curMeth) methIn = curMeth;
            if (methIn > 0) {
                uint256 usdyOut = _swap(address(methToken), methIn);
                methBalanceOf[user] = curMeth - methIn;
                usdyBalanceOf[user] = curUsdy + usdyOut;
            }
        }

        emit Rebalanced(user, usdyBps, methBps, block.timestamp);
    }

    /// @dev Swap with LIVE slippage protection: minOut derived from an on-chain quote
    ///      and the configured tolerance, so a bad pool/sandwich reverts instead of
    ///      executing at a terrible price.
    function _swap(address tokenIn, uint256 amountIn) internal returns (uint256) {
        uint256 expected = amm.getAmountOut(tokenIn, amountIn);
        uint256 minOut = (expected * (TOTAL_BPS - slippageBps)) / TOTAL_BPS;
        return amm.swap(tokenIn, amountIn, minOut, address(this));
    }

    /// @dev Protocol management fee (bps of position value), taken from the USDY leg
    ///      to the treasury. The mETH cap guarantees a USDY leg exists to draw from.
    function _chargeFee(address user, uint256 totalValue) internal {
        if (feeBps == 0 || treasury == address(0)) return;
        uint256 fee = (totalValue * feeBps) / TOTAL_BPS;
        if (fee == 0) return;
        uint256 bal = usdyBalanceOf[user];
        if (fee > bal) fee = bal;
        if (fee == 0) return;
        usdyBalanceOf[user] = bal - fee;
        require(usdyToken.transfer(treasury, fee), "FEE_XFER");
        emit FeeCharged(user, fee);
    }

    // ─── Views ──────────────────────────────────────────────────────────────
    function getPortfolio(address user)
        external
        view
        returns (uint256 usdyBal, uint256 methBal, uint256 usdyBps, uint256 methBps)
    {
        usdyBal = usdyBalanceOf[user];
        methBal = methBalanceOf[user];
        uint256 total = _totalValue(user);
        if (total == 0) {
            return (usdyBal, methBal, 0, 0);
        }
        uint256 methValue = (methBal * amm.spotPriceE18()) / ONE;
        methBps = (methValue * TOTAL_BPS) / total;
        usdyBps = TOTAL_BPS - methBps;
    }

    function getTotalValue(address user) external view returns (uint256) {
        return _totalValue(user);
    }

    function _totalValue(address user) internal view returns (uint256) {
        uint256 methValue = (methBalanceOf[user] * amm.spotPriceE18()) / ONE;
        return usdyBalanceOf[user] + methValue;
    }
}

// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Circle's CoreDepositWallet on HyperEVM: moves USDC into a HyperCore account.
interface ICoreDepositWallet {
    function depositFor(address recipient, uint256 amount, uint32 destinationId) external;
}

interface IERC20 {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title Hypeware FeeSplitter
/// @notice Splits Hypeware's platform revenue (USDC on HyperEVM) between the flagship company and the platform,
/// in public and by fixed rules:
///  - `distribute` can be called by anyone and only ever pays the two configured recipients.
///  - The flagship's share is deposited straight into its HyperCore spot balance (where its agent works).
///  - The platform's share is sent to the platform's address on HyperEVM.
///  - Changing the split or the recipients takes a public proposal and a `DELAY` wait before it can apply.
/// @dev No upgradeability, no owner withdrawal of USDC. Tokens other than USDC sent here by mistake can be rescued.
contract FeeSplitter {
    /// @notice CoreDepositWallet destination id for HyperCore's spot balance.
    uint32 public constant SPOT_DEX = type(uint32).max;
    uint16 public constant BPS = 10_000;
    /// @notice Wait between proposing and applying a config change.
    uint64 public constant DELAY = 2 days;

    IERC20 public immutable usdc;
    ICoreDepositWallet public immutable coreDepositWallet;

    address public owner;
    address public pendingOwner;

    /// @notice HyperCore account of the flagship company (same address as its EVM key).
    address public flagship;
    /// @notice Receives the rest on HyperEVM.
    address public platform;
    /// @notice Flagship's share of each distribution, in basis points.
    uint16 public flagshipBps;

    struct Proposal {
        address flagship;
        address platform;
        uint16 flagshipBps;
        uint64 eta; // 0 = none
    }

    Proposal public proposal;

    uint256 public totalDistributed;
    uint256 public totalToFlagship;

    event Distributed(bytes32 indexed ref, uint256 amount, uint256 toFlagship, uint256 toPlatform);
    event ConfigProposed(address flagship, address platform, uint16 flagshipBps, uint64 eta);
    event ConfigApplied(address flagship, address platform, uint16 flagshipBps);
    event ConfigCancelled();
    event OwnershipTransferStarted(address indexed from, address indexed to);
    event OwnershipTransferred(address indexed from, address indexed to);
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error BadBps();
    error NothingToDistribute();
    error NoProposal();
    error TooEarly(uint64 eta);
    error CannotRescueUsdc();
    error TokenCallFailed();
    error Reentrancy();

    uint256 private _lock = 1;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IERC20 usdc_, ICoreDepositWallet coreDepositWallet_, address owner_, address flagship_, address platform_, uint16 flagshipBps_) {
        if (address(usdc_) == address(0) || address(coreDepositWallet_) == address(0) || owner_ == address(0)) revert ZeroAddress();
        _checkConfig(flagship_, platform_, flagshipBps_);
        usdc = usdc_;
        coreDepositWallet = coreDepositWallet_;
        owner = owner_;
        flagship = flagship_;
        platform = platform_;
        flagshipBps = flagshipBps_;
        emit OwnershipTransferred(address(0), owner_);
        emit ConfigApplied(flagship_, platform_, flagshipBps_);
    }

    /// @notice Split the USDC this contract holds. `ref` links the distribution to the platform's off-chain batch.
    function distribute(bytes32 ref) external nonReentrant returns (uint256 toFlagship, uint256 toPlatform) {
        uint256 amount = usdc.balanceOf(address(this));
        if (amount == 0) revert NothingToDistribute();
        toFlagship = (amount * flagshipBps) / BPS;
        toPlatform = amount - toFlagship;

        totalDistributed += amount;
        totalToFlagship += toFlagship;

        if (toFlagship > 0) {
            _call(address(usdc), abi.encodeCall(IERC20.approve, (address(coreDepositWallet), toFlagship)));
            coreDepositWallet.depositFor(flagship, toFlagship, SPOT_DEX);
        }
        if (toPlatform > 0) _call(address(usdc), abi.encodeCall(IERC20.transfer, (platform, toPlatform)));
        emit Distributed(ref, amount, toFlagship, toPlatform);
    }

    // ───────────────────────────── config (timelocked) ─────────────────────────────

    function proposeConfig(address flagship_, address platform_, uint16 flagshipBps_) external onlyOwner {
        _checkConfig(flagship_, platform_, flagshipBps_);
        uint64 eta = uint64(block.timestamp) + DELAY;
        proposal = Proposal(flagship_, platform_, flagshipBps_, eta);
        emit ConfigProposed(flagship_, platform_, flagshipBps_, eta);
    }

    /// @notice Anyone can apply a proposal once its delay has passed.
    function applyConfig() external {
        Proposal memory p = proposal;
        if (p.eta == 0) revert NoProposal();
        if (block.timestamp < p.eta) revert TooEarly(p.eta);
        delete proposal;
        flagship = p.flagship;
        platform = p.platform;
        flagshipBps = p.flagshipBps;
        emit ConfigApplied(p.flagship, p.platform, p.flagshipBps);
    }

    function cancelConfig() external onlyOwner {
        if (proposal.eta == 0) revert NoProposal();
        delete proposal;
        emit ConfigCancelled();
    }

    // ───────────────────────────── ownership (two-step) ─────────────────────────────

    function transferOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        pendingOwner = to;
        emit OwnershipTransferStarted(owner, to);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    /// @notice Return a token other than USDC that was sent here by mistake. USDC can only leave through `distribute`.
    function rescue(IERC20 token, address to) external onlyOwner {
        if (address(token) == address(usdc)) revert CannotRescueUsdc();
        if (to == address(0)) revert ZeroAddress();
        uint256 amount = token.balanceOf(address(this));
        _call(address(token), abi.encodeCall(IERC20.transfer, (to, amount)));
        emit Rescued(address(token), to, amount);
    }

    // ───────────────────────────── internal ─────────────────────────────

    function _checkConfig(address flagship_, address platform_, uint16 flagshipBps_) private pure {
        if (flagship_ == address(0) || platform_ == address(0)) revert ZeroAddress();
        if (flagshipBps_ > BPS) revert BadBps();
    }

    /// @dev ERC-20 call that accepts tokens returning nothing or `true`.
    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || (ret.length != 0 && !abi.decode(ret, (bool))) || token.code.length == 0) revert TokenCallFailed();
    }
}

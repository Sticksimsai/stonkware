// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FeeSplitter, IERC20, ICoreDepositWallet} from "../src/FeeSplitter.sol";

/// Minimal Foundry cheatcodes (no forge-std dependency).
interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert(bytes calldata) external;
    function expectRevert(bytes4) external;
    function assume(bool) external;
}

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public returnFalse;

    function mint(address to, uint256 amt) external { balanceOf[to] += amt; }
    function setReturnFalse(bool v) external { returnFalse = v; }

    function transfer(address to, uint256 amt) external returns (bool) {
        if (returnFalse) return false;
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }
    function approve(address s, uint256 amt) external returns (bool) { allowance[msg.sender][s] = amt; return true; }
    function transferFrom(address f, address t, uint256 amt) external returns (bool) {
        allowance[f][msg.sender] -= amt;
        balanceOf[f] -= amt;
        balanceOf[t] += amt;
        return true;
    }
}

/// Behaves like Circle's CoreDepositWallet: pulls USDC with transferFrom and credits `recipient` on HyperCore.
contract MockCoreDepositWallet {
    MockUSDC public immutable usdc;
    mapping(address => uint256) public creditedOnCore;
    uint32 public lastDex;
    bool public reenter;
    FeeSplitter public target;

    constructor(MockUSDC u) { usdc = u; }
    function setReenter(FeeSplitter t) external { reenter = true; target = t; }

    function depositFor(address recipient, uint256 amount, uint32 dex) external {
        usdc.transferFrom(msg.sender, address(this), amount);
        creditedOnCore[recipient] += amount;
        lastDex = dex;
        if (reenter) target.distribute(bytes32("again"));
    }
}

contract OtherToken {
    mapping(address => uint256) public balanceOf;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function transfer(address to, uint256 a) external returns (bool) { balanceOf[msg.sender] -= a; balanceOf[to] += a; return true; }
}

contract FeeSplitterTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockUSDC usdc;
    MockCoreDepositWallet cdw;
    FeeSplitter s;
    address constant OWNER = address(0xA11CE);
    address constant FLAGSHIP = address(0xF1A6);
    address constant PLATFORM = address(0x9147);
    address constant STRANGER = address(0xBAD);

    function setUp() public {
        usdc = new MockUSDC();
        cdw = new MockCoreDepositWallet(usdc);
        s = new FeeSplitter(IERC20(address(usdc)), ICoreDepositWallet(address(cdw)), OWNER, FLAGSHIP, PLATFORM, 5_000);
    }

    function _eq(uint256 a, uint256 b, string memory what) internal pure { require(a == b, what); }

    // ── distribute ──

    function test_splitsAndCreditsFlagshipOnHyperCoreSpot() public {
        usdc.mint(address(s), 1_000e6);
        vm.prank(STRANGER); // anyone can trigger it
        (uint256 f, uint256 p) = s.distribute(bytes32("batch-1"));
        _eq(f, 500e6, "flagship share");
        _eq(p, 500e6, "platform share");
        _eq(cdw.creditedOnCore(FLAGSHIP), 500e6, "flagship credited on core");
        _eq(cdw.lastDex(), type(uint32).max, "spot dex");
        _eq(usdc.balanceOf(PLATFORM), 500e6, "platform paid on evm");
        _eq(usdc.balanceOf(address(s)), 0, "nothing left");
        _eq(s.totalDistributed(), 1_000e6, "total");
        _eq(s.totalToFlagship(), 500e6, "total to flagship");
    }

    function testFuzz_splitAlwaysAddsUp(uint256 amount, uint16 bps) public {
        vm.assume(amount > 0 && amount < 1e30 && bps <= 10_000);
        FeeSplitter x = new FeeSplitter(IERC20(address(usdc)), ICoreDepositWallet(address(cdw)), OWNER, FLAGSHIP, PLATFORM, bps);
        usdc.mint(address(x), amount);
        uint256 coreBefore = cdw.creditedOnCore(FLAGSHIP);
        uint256 platBefore = usdc.balanceOf(PLATFORM);
        (uint256 f, uint256 p) = x.distribute(0);
        _eq(f + p, amount, "adds up");
        _eq(f, (amount * bps) / 10_000, "flagship rounds down");
        _eq(cdw.creditedOnCore(FLAGSHIP) - coreBefore, f, "core credit");
        _eq(usdc.balanceOf(PLATFORM) - platBefore, p, "platform credit");
        _eq(usdc.balanceOf(address(x)), 0, "drained");
    }

    function test_zeroAndFullShares() public {
        FeeSplitter none = new FeeSplitter(IERC20(address(usdc)), ICoreDepositWallet(address(cdw)), OWNER, FLAGSHIP, PLATFORM, 0);
        usdc.mint(address(none), 7);
        none.distribute(0);
        _eq(usdc.balanceOf(PLATFORM), 7, "all to platform");
        FeeSplitter all = new FeeSplitter(IERC20(address(usdc)), ICoreDepositWallet(address(cdw)), OWNER, FLAGSHIP, PLATFORM, 10_000);
        usdc.mint(address(all), 9);
        all.distribute(0);
        _eq(cdw.creditedOnCore(FLAGSHIP), 9, "all to flagship");
    }

    function test_revertsWhenEmpty() public {
        vm.expectRevert(FeeSplitter.NothingToDistribute.selector);
        s.distribute(0);
    }

    function test_revertsWhenTokenReturnsFalse() public {
        usdc.mint(address(s), 100);
        usdc.setReturnFalse(true);
        vm.expectRevert(FeeSplitter.TokenCallFailed.selector);
        s.distribute(0);
    }

    function test_blocksReentrancy() public {
        usdc.mint(address(s), 100);
        cdw.setReenter(s);
        vm.expectRevert(FeeSplitter.Reentrancy.selector);
        s.distribute(0);
    }

    // ── config timelock ──

    function test_configChangeWaitsForDelay() public {
        vm.prank(OWNER);
        s.proposeConfig(address(0xF2), address(0x93), 7_000);
        vm.expectRevert(abi.encodeWithSelector(FeeSplitter.TooEarly.selector, uint64(block.timestamp + 2 days)));
        s.applyConfig();
        vm.warp(block.timestamp + 2 days);
        vm.prank(STRANGER); // anyone can apply once it's due
        s.applyConfig();
        _eq(uint256(uint160(s.flagship())), 0xF2, "flagship updated");
        _eq(uint256(uint160(s.platform())), 0x93, "platform updated");
        _eq(s.flagshipBps(), 7_000, "bps updated");
        vm.expectRevert(FeeSplitter.NoProposal.selector);
        s.applyConfig();
    }

    function test_onlyOwnerProposesAndCancels() public {
        vm.prank(STRANGER);
        vm.expectRevert(FeeSplitter.NotOwner.selector);
        s.proposeConfig(FLAGSHIP, PLATFORM, 1);
        vm.prank(OWNER);
        s.proposeConfig(FLAGSHIP, PLATFORM, 1);
        vm.prank(STRANGER);
        vm.expectRevert(FeeSplitter.NotOwner.selector);
        s.cancelConfig();
        vm.prank(OWNER);
        s.cancelConfig();
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(FeeSplitter.NoProposal.selector);
        s.applyConfig();
    }

    function test_rejectsBadConfig() public {
        vm.prank(OWNER);
        vm.expectRevert(FeeSplitter.BadBps.selector);
        s.proposeConfig(FLAGSHIP, PLATFORM, 10_001);
        vm.prank(OWNER);
        vm.expectRevert(FeeSplitter.ZeroAddress.selector);
        s.proposeConfig(address(0), PLATFORM, 1);
        vm.expectRevert(FeeSplitter.ZeroAddress.selector);
        new FeeSplitter(IERC20(address(usdc)), ICoreDepositWallet(address(cdw)), OWNER, FLAGSHIP, address(0), 1);
        vm.expectRevert(FeeSplitter.ZeroAddress.selector);
        new FeeSplitter(IERC20(address(0)), ICoreDepositWallet(address(cdw)), OWNER, FLAGSHIP, PLATFORM, 1);
    }

    // ── ownership & rescue ──

    function test_twoStepOwnership() public {
        vm.prank(OWNER);
        s.transferOwnership(STRANGER);
        _eq(uint256(uint160(s.owner())), uint160(OWNER), "not yet");
        vm.prank(address(0x1234));
        vm.expectRevert(FeeSplitter.NotPendingOwner.selector);
        s.acceptOwnership();
        vm.prank(STRANGER);
        s.acceptOwnership();
        _eq(uint256(uint160(s.owner())), uint160(STRANGER), "transferred");
    }

    function test_ownerCannotTakeUsdc() public {
        usdc.mint(address(s), 100);
        vm.prank(OWNER);
        vm.expectRevert(FeeSplitter.CannotRescueUsdc.selector);
        s.rescue(IERC20(address(usdc)), OWNER);
    }

    function test_rescueOtherTokens() public {
        OtherToken t = new OtherToken();
        t.mint(address(s), 42);
        vm.prank(STRANGER);
        vm.expectRevert(FeeSplitter.NotOwner.selector);
        s.rescue(IERC20(address(t)), STRANGER);
        vm.prank(OWNER);
        s.rescue(IERC20(address(t)), OWNER);
        _eq(t.balanceOf(OWNER), 42, "rescued");
    }
}

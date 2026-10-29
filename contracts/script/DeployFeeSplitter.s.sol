// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FeeSplitter, IERC20, ICoreDepositWallet} from "../src/FeeSplitter.sol";

interface Vm {
    function envAddress(string calldata) external view returns (address);
    function envOr(string calldata, address) external view returns (address);
    function envOr(string calldata, uint256) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

interface ICdwToken {
    function token() external view returns (address);
}

/// Deploy:
///   OWNER=0x… FLAGSHIP=0x<flagship hlAddress> PLATFORM=0x… FLAGSHIP_BPS=5000 \
///   forge script script/DeployFeeSplitter.s.sol --rpc-url hyperevm_testnet --broadcast --private-key $DEPLOYER_KEY
/// USDC and the CoreDepositWallet default to Circle's addresses for HyperEVM mainnet (999) and testnet (998).
contract DeployFeeSplitter {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (FeeSplitter s) {
        (address usdc, address cdw) = _defaults(block.chainid);
        usdc = vm.envOr("USDC", usdc);
        cdw = vm.envOr("CORE_DEPOSIT_WALLET", cdw);
        require(usdc != address(0) && cdw != address(0), "set USDC and CORE_DEPOSIT_WALLET for this chain");
        // never wire the splitter to a deposit wallet for a different token
        require(ICdwToken(cdw).token() == usdc, "CoreDepositWallet.token() is not USDC");

        address owner = vm.envAddress("OWNER");
        address flagship = vm.envAddress("FLAGSHIP");
        address platform = vm.envAddress("PLATFORM");
        uint256 bps = vm.envOr("FLAGSHIP_BPS", uint256(5_000));
        require(bps <= 10_000, "FLAGSHIP_BPS > 10000");

        vm.startBroadcast();
        s = new FeeSplitter(IERC20(usdc), ICoreDepositWallet(cdw), owner, flagship, platform, uint16(bps));
        vm.stopBroadcast();
    }

    function _defaults(uint256 chainId) private pure returns (address usdc, address cdw) {
        if (chainId == 999) return (0xb88339CB7199b77E23DB6E890353E22632Ba630f, 0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24);
        if (chainId == 998) return (0x2B3370eE501B4a559b57D449569354196457D8Ab, 0x0B80659a4076E9E93C7DbE0f10675A16a3e5C206);
        return (address(0), address(0));
    }
}

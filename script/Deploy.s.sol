// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {PeerRegistry} from "../contracts/PeerRegistry.sol";
import {InferenceEscrow} from "../contracts/InferenceEscrow.sol";

interface DeployVm {
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// @notice Run with forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast.
/// The private signer must be provided through MONAD_TESTNET_PRIVATE_KEY; never put it in source.
contract Deploy {
    DeployVm private constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    error MonadTestnetOnly();

    function run() external returns (PeerRegistry registry, InferenceEscrow escrow) {
        if (block.chainid != 10143) revert MonadTestnetOnly();
        uint256 privateKey = vm.envUint("MONAD_TESTNET_PRIVATE_KEY");
        vm.startBroadcast(privateKey);
        registry = new PeerRegistry();
        escrow = new InferenceEscrow(registry);
        vm.stopBroadcast();
    }
}

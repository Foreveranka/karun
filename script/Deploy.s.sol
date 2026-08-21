// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {KarunEscrow, IERC20 as IEscrowERC20} from "../src/KarunEscrow.sol";
import {KarunSpender, IERC20 as ISpenderERC20} from "../src/KarunSpender.sol";
import {KarunLedger} from "../src/KarunLedger.sol";

/// Kaynak/hedef zincir dagitimi (Sepolia): mUSDC + Escrow (teminat) + Spender (odeme)
/// forge script script/Deploy.s.sol:DeploySepolia --rpc-url sepolia --broadcast
contract DeploySepolia is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address dagitici = vm.addr(pk);

        vm.startBroadcast(pk);
        MockUSDC usdc = new MockUSDC();
        KarunEscrow escrow = new KarunEscrow(IEscrowERC20(address(usdc)), dagitici, dagitici, 2 minutes);
        KarunSpender spender = new KarunSpender(ISpenderERC20(address(usdc)), dagitici);

        // demo likiditesi: 50.000 mUSDC
        usdc.mint(dagitici, 150_000e6);
        usdc.approve(address(spender), type(uint256).max);
        spender.fund(50_000e6);
        vm.stopBroadcast();

        console.log("Sepolia mUSDC:   ", address(usdc));
        console.log("KarunEscrow:     ", address(escrow));
        console.log("KarunSpender:    ", address(spender));
    }
}

/// Creditcoin testnet: yalnizca HAKEM defteri (odeme yapmaz, token tutmaz)
/// ESCROW_ADDRESS ve SPENDER_ADDRESS Sepolia dagitimindan gelir.
/// forge script script/Deploy.s.sol:DeployCreditcoin --rpc-url creditcoin_testnet --broadcast
contract DeployCreditcoin is Script {
    uint64 constant SEPOLIA_CHAIN_KEY = 1;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address escrowAdresi = vm.envAddress("ESCROW_ADDRESS");
        address spenderAdresi = vm.envAddress("SPENDER_ADDRESS");

        vm.startBroadcast(pk);
        KarunLedger ledger = new KarunLedger(30, address(0)); // %0,30 komisyon, gercek precompile
        // Sepolia: hem teminat hem odeme acik
        ledger.zincirTanimla(SEPOLIA_CHAIN_KEY, escrowAdresi, spenderAdresi, 8000, true, true);
        vm.stopBroadcast();

        console.log("KarunLedger (arbiter):", address(ledger));
    }
}

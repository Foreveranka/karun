// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {KarunEscrow, IERC20 as IEscrowERC20} from "../src/KarunEscrow.sol";
import {KarunLedger, IERC20 as ILedgerERC20} from "../src/KarunLedger.sol";

/// Kaynak zincir (Sepolia) dagitimi: mUSDC + KarunEscrow
/// forge script script/Deploy.s.sol:DeploySepolia --rpc-url sepolia --broadcast
contract DeploySepolia is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address dagitici = vm.addr(pk);

        vm.startBroadcast(pk);
        MockUSDC usdc = new MockUSDC();
        // operator + hazine baslangicta dagitici; demo icin 2 dakikalik cekim gecikmesi
        KarunEscrow escrow = new KarunEscrow(IEscrowERC20(address(usdc)), dagitici, dagitici, 2 minutes);
        usdc.mint(dagitici, 100_000e6);
        vm.stopBroadcast();

        console.log("Sepolia mUSDC:   ", address(usdc));
        console.log("KarunEscrow:     ", address(escrow));
    }
}

/// Creditcoin testnet dagitimi: mUSDC + KarunLedger + escrow kaydi + havuz fonlamasi
/// ESCROW_ADDRESS ortam degiskeni Sepolia dagitimindan gelir.
/// forge script script/Deploy.s.sol:DeployCreditcoin --rpc-url creditcoin_testnet --broadcast
contract DeployCreditcoin is Script {
    uint64 constant SEPOLIA_CHAIN_KEY = 1;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address escrowAdresi = vm.envAddress("ESCROW_ADDRESS");
        address dagitici = vm.addr(pk);

        vm.startBroadcast(pk);
        MockUSDC usdc = new MockUSDC();
        KarunLedger ledger = new KarunLedger(ILedgerERC20(address(usdc)), 30, address(0)); // %0,30 komisyon, gercek precompile
        ledger.registerEscrow(SEPOLIA_CHAIN_KEY, escrowAdresi, 8000); // stabil LTV %80

        // demo havuzu: 50.000 mUSDC
        usdc.mint(dagitici, 50_000e6);
        usdc.approve(address(ledger), type(uint256).max);
        ledger.fundPool(50_000e6);
        vm.stopBroadcast();

        console.log("Creditcoin mUSDC:", address(usdc));
        console.log("KarunLedger:     ", address(ledger));
    }
}

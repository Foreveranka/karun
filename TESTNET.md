# Karun on testnet

Live deployment used for the BUIDL CTC 2026 Fall submission.

## Creditcoin Testnet (chain id 102031) — the arbiter

| Contract | Address |
|---|---|
| `KarunLedger` | [`0xb7d89dD5b11814E73995602F90603ddd893107bB`](https://creditcoin-testnet.blockscout.com/address/0xb7d89dD5b11814E73995602F90603ddd893107bB) |
| Block Prover Precompile (Attestcoin) | `0x0000000000000000000000000000000000000FD2` |

The ledger holds no tokens and makes no payouts. It verifies Attestcoin proofs, keeps the single spendable limit, prevents double spends and settles claims.

Registered chain: Sepolia (chain key 1), LTV 8000 bps, collateral and payouts both enabled.

## Sepolia (chain id 11155111) — collateral and payouts

| Contract | Address |
|---|---|
| `MockUSDC` (mUSDC, 6 decimals) | [`0xb7d89dD5b11814E73995602F90603ddd893107bB`](https://sepolia.etherscan.io/address/0xb7d89dD5b11814E73995602F90603ddd893107bB) |
| `KarunEscrow` | [`0x07BEf458F5AF8D041e8ac497B2f4528eEec3D855`](https://sepolia.etherscan.io/address/0x07BEf458F5AF8D041e8ac497B2f4528eEec3D855) |
| `KarunSpender` | [`0xD819c276908A910659a5cc9315ee25b8a6287953`](https://sepolia.etherscan.io/address/0xD819c276908A910659a5cc9315ee25b8a6287953) |

Payout pool funded with 50,000 mUSDC. Escrow unlock delay: 2 minutes (demo setting).

## Live run

1. Locked 5,000 mUSDC into the escrow — tx [`0xf497dda0…`](https://sepolia.etherscan.io/tx/0xf497dda097a58b462b3fad7bafd34aa4f0797e8c40e50613d549baad6ee9dad4), block 11538379.
2. The worker waited for Attestcoin attestation of that Sepolia block, pulled Merkle and continuity proofs from the proof builder, and submitted them to `submitLockProof` on Creditcoin.
3. The precompile verified the proofs on chain, the ledger decoded the `Locked` event and opened the spendable limit.

Attestation lag on testnet is roughly 8 minutes, matching the documented interval.

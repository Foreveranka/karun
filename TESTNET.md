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
3. The precompile verified the proofs on chain, the ledger decoded the `Locked` event and opened the spendable limit of 4,000 mUSDC (80% LTV) — proof tx [`0x957c921b…`](https://creditcoin-testnet.blockscout.com/tx/0x957c921ba99e4096b6f0fb0dd64c439c462fcdc8c8abb40d1a75ba9b11af0a97).
4. Requested a payment of 1,000 mUSDC to `0x…bEEF`, to be paid on Sepolia and settled from Sepolia collateral — tx [`0x70b03e0b…`](https://creditcoin-testnet.blockscout.com/tx/0x70b03e0b2d6ef1fe3a89f81bbae3d4e59cf92246a019ce1ac42ddf08e621e01a). Outstanding became 1,003 mUSDC (1,000 plus the 0.30% fee).
5. The Sepolia pool paid the recipient — tx [`0xd2c812a5…`](https://sepolia.etherscan.io/tx/0xd2c812a5398952c0480b372ee0b91deed1c0718f01c45ae2d36f45560b69c507). The recipient's balance went from 0 to 1,000 mUSDC.
6. That payout was proven back on Creditcoin via Attestcoin — tx [`0xaf518150…`](https://creditcoin-testnet.blockscout.com/tx/0xaf518150a14425463e9aa32243800a0b25412e5f9740a9aa370fd61d061b97d9).
7. The escrow deducted 1,003 mUSDC, taking the lock from 5,000 to 3,997 — tx [`0x6647ed05…`](https://sepolia.etherscan.io/tx/0x6647ed053da0f876f4661e3638e045d45639236bdef8febab44e99895347ff0f).
8. The deduction was proven on Creditcoin and the claim was settled — tx [`0x999fff41…`](https://creditcoin-testnet.blockscout.com/tx/0x999fff413cdaab35d6901543f276439ee7a03581e1ef0510bbe0babbf33828c8).

## Final state after the run

| | |
|---|---|
| Outstanding debt | **0** — every payment settles against the user's own collateral |
| Collateral (Creditcoin view) | 3,997 mUSDC, synced from the escrow's own event |
| Spendable balance | 3,197.60 mUSDC (80% of the remaining collateral) |
| Recipient | 1,000 mUSDC on Sepolia, paid from the Karun pool |

Three separate Attestcoin proofs were verified on chain during this single cycle: the lock, the payout and the deduction. Attestation lag on testnet is roughly 8 minutes, matching the documented interval.

# Deployments

Live testnet addresses and the full recorded run.

## Creditcoin Testnet · the arbiter

Chain id 102031 · RPC `https://rpc.cc3-testnet.creditcoin.network` · [Blockscout](https://creditcoin-testnet.blockscout.com/)

| Contract | Address |
|---|---|
| `KarunLedger` | [`0xb7d89dD5b11814E73995602F90603ddd893107bB`](https://creditcoin-testnet.blockscout.com/address/0xb7d89dD5b11814E73995602F90603ddd893107bB) |
| Block Prover Precompile | `0x0000000000000000000000000000000000000FD2` |

Holds no tokens. Fee 30 bps. Registered chain: Sepolia (chain key 1), LTV 8000 bps, collateral and payouts both enabled.

## Sepolia · collateral and payouts

Chain id 11155111 · [Etherscan](https://sepolia.etherscan.io/)

| Contract | Address |
|---|---|
| `MockUSDC` (6 decimals) | [`0xb7d89dD5b11814E73995602F90603ddd893107bB`](https://sepolia.etherscan.io/address/0xb7d89dD5b11814E73995602F90603ddd893107bB) |
| `KarunEscrow` | [`0x07BEf458F5AF8D041e8ac497B2f4528eEec3D855`](https://sepolia.etherscan.io/address/0x07BEf458F5AF8D041e8ac497B2f4528eEec3D855) |
| `KarunSpender` | [`0xD819c276908A910659a5cc9315ee25b8a6287953`](https://sepolia.etherscan.io/address/0xD819c276908A910659a5cc9315ee25b8a6287953) |

Payout pool funded with 50,000 mUSDC. Unlock delay 2 minutes for the demo.

> The ledger and the Sepolia mUSDC share an address string. They are different contracts on different chains; the deployer simply had the same nonce on both.

## The recorded cycle

Every step below is a real transaction, in order, with three Attestcoin verifications on chain.

| # | Step | Chain | Transaction |
|---|---|---|---|
| 1 | Lock 5,000 mUSDC | Sepolia | [`0xf497dda0…`](https://sepolia.etherscan.io/tx/0xf497dda097a58b462b3fad7bafd34aa4f0797e8c40e50613d549baad6ee9dad4) |
| 2 | **Lock proven**, balance opens at 4,000 | Creditcoin | [`0x957c921b…`](https://creditcoin-testnet.blockscout.com/tx/0x957c921ba99e4096b6f0fb0dd64c439c462fcdc8c8abb40d1a75ba9b11af0a97) |
| 3 | Authorise 1,000 to `0x…bEEF`, reserve 1,003 | Creditcoin | [`0x70b03e0b…`](https://creditcoin-testnet.blockscout.com/tx/0x70b03e0b2d6ef1fe3a89f81bbae3d4e59cf92246a019ce1ac42ddf08e621e01a) |
| 4 | Pool pays the recipient | Sepolia | [`0xd2c812a5…`](https://sepolia.etherscan.io/tx/0xd2c812a5398952c0480b372ee0b91deed1c0718f01c45ae2d36f45560b69c507) |
| 5 | **Payout proven** | Creditcoin | [`0xaf518150…`](https://creditcoin-testnet.blockscout.com/tx/0xaf518150a14425463e9aa32243800a0b25412e5f9740a9aa370fd61d061b97d9) |
| 6 | Escrow deducts 1,003, lock drops to 3,997 | Sepolia | [`0x6647ed05…`](https://sepolia.etherscan.io/tx/0x6647ed053da0f876f4661e3638e045d45639236bdef8febab44e99895347ff0f) |
| 7 | **Deduction proven**, claim settled | Creditcoin | [`0x999fff41…`](https://creditcoin-testnet.blockscout.com/tx/0x999fff413cdaab35d6901543f276439ee7a03581e1ef0510bbe0babbf33828c8) |

### Final state

| | |
|---|---|
| Outstanding debt | **0** |
| Collateral | 3,997 mUSDC, synced from the escrow's own event |
| Spendable balance | 3,197.60 mUSDC |
| Recipient | 1,000 mUSDC, received on Sepolia from the Karun pool |

Attestation lag was roughly eight minutes per proof, matching the documented interval.

## Interface

[karun-eta.vercel.app](https://karun-eta.vercel.app) reads directly from these contracts. No backend sits in between.

# Architecture

Highest level description of how Karun is put together, and what each chain is responsible for.

Karun runs on three kinds of chain, and the separation between them is the whole design.

## Key terms

* **Arbiter:** the Creditcoin contract that holds the accounting. It verifies proofs, tracks each user's spendable balance, authorises payments and settles claims. It holds no tokens and pays nobody.
* **Collateral chain:** a chain where a user locks funds. Runs a `KarunEscrow`.
* **Payout chain:** a chain where a recipient can be paid. Runs a `KarunSpender` holding protocol liquidity.
* **Claim:** one authorised payment, tracked from creation to settlement. Carries the user, both chains, the recipient, the amount and the total to be deducted.
* **Spendable balance:** the loan-to-value share of a user's attested collateral, minus anything still settling.
* **Worker:** an off chain service that carries transactions and proofs between the chains. It cannot forge anything; every action it takes is verified on chain.

A chain can be a collateral chain, a payout chain, or both. Sepolia is both in the current deployment.

> Creditcoin is **not** a payout chain. It is deliberately kept free of user funds so that the accounting layer can never be drained. A compromise of the arbiter cannot move money; it can only mis-authorise a payment, which is still bounded by the liquidity of the target pool.

## Contracts

### KarunEscrow

> Deployed on every collateral chain

Holds user collateral. Three operations matter:

* `lock(amount)` pulls stablecoins in and emits `Locked(user, amount, totalLocked)`. The event carries the **cumulative** total, not the delta, so a stale proof can never inflate a balance.
* `deduct(user, amount, claimId)` moves the settled amount to the treasury and emits `Deducted(user, amount, claimId, remainingLocked)`. Each `claimId` is processed once.
* `requestUnlock` and `withdraw` implement a delayed withdrawal. The delay exists so that in flight payments can be deducted before collateral leaves.

### KarunSpender

> Deployed on every payout chain

Holds protocol liquidity and pays recipients.

* `payout(payoutId, recipient, amount)` transfers to the recipient and emits `Paid(payoutId, recipient, amount)`. The `payoutId` is the claim id created by the arbiter, which is what lets the arbiter recognise the payout later.
* `fund` and `defund` manage the pool.

Replay protection is per payout id, so a repeated instruction can never pay twice.

### KarunLedger

> Deployed on Creditcoin. This is the Attestcoin Smart Contract.

The arbiter. It exposes:

* `zincirTanimla` to register a chain with its escrow, its spender, its loan-to-value ratio and whether collateral and payouts are enabled there.
* `submitLockProof`, `submitPaymentProof`, `submitDeductionProof`, each taking one proof bundle and each calling the Block Prover Precompile before it believes anything.
* `requestPayment(recipient, amount, targetChain, sourceChain)` which checks the balance, reserves it, and emits `PaymentAuthorized`.
* Views: `available`, `collateral`, `outstanding`, `talepler` for claim state.

### KarunAscBase

The reusable base that every Attestcoin Smart Contract in this project inherits. It owns the precompile handle, computes a query id from chain key, block height and transaction index, and refuses to process the same query twice.

## Actors

### The user

Locks collateral, authorises payments. Signs on the collateral chain to lock, and on Creditcoin to authorise. Never signs on the payout chain and never needs gas there.

### The worker

Watches both sides. When it sees a `Locked` event it waits for Attestcoin to attest that block, fetches the Merkle and continuity proofs from the proof builder service, and submits them to the arbiter. When it sees a `PaymentAuthorized` event it calls the spender, proves the payout, calls the escrow deduction, and proves that too.

The worker is a courier, not an authority. It cannot fabricate a lock, cannot pay itself, and cannot close a claim without a proof that the precompile accepts. If it disappears mid cycle, everything it has already done is on chain and it resumes from where it stopped.

### The Attestcoin Protocol

Attestors watch source chains and reach consensus on their state. Validators commit those attestations to Creditcoin. The Block Prover Precompile at `0x0FD2` verifies, synchronously and at native speed, that a given transaction really belongs to a block that really belongs to the attested chain.

## Why this shape

The obvious alternative is to keep the money on Creditcoin and pay from there. That is what the first version of Karun did, and it was wrong. It makes Creditcoin a payout chain, which means every user must end up with a balance there, which is bridging with extra words.

Keeping Creditcoin as a pure arbiter has three consequences that matter:

1. **The user never leaves their chain.** Their funds sit where they put them and are spent where they are needed.
2. **Adding a chain is a configuration change, not a migration.** A new payout chain needs a spender and one call to `zincirTanimla`.
3. **The accounting layer holds nothing worth stealing.** All value sits in escrows and pools, each bounded and each on its own chain.

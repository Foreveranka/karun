# Security model

What Karun trusts, what it guarantees, and what happens when something goes wrong.

## Trust assumptions

| Component | Trusted for | Consequence if it misbehaves |
|---|---|---|
| Attestcoin attestors | Honest reporting of source chain state | A dishonest quorum could attest a fake chain. This is Creditcoin's own security assumption, shared by every application on it. |
| Block Prover Precompile | Correct proof verification | Same as above. Runtime code, not application code. |
| Worker | Liveness only | Cannot forge, pay itself or settle. A dead worker delays settlement; it cannot cause loss. |
| Operator key | Calling `deduct` and `payout` | Bounded: see below. Removed entirely when Writability ships. |
| Escrow and spender contracts | Holding funds correctly | Per chain, per contract. Failure is contained to that chain. |

## What is guaranteed

**Nobody spends more than they locked.** All accounting lives in one contract on Creditcoin. A payment must fit inside the spendable balance and inside the collateral of the chain it will settle from. Two simultaneous payments cannot both draw on the same collateral because the reservation happens before the payout is authorised.

**No debt accumulates.** Every payment reserves its own settlement amount at authorisation time. A claim cannot close without proof that the escrow deducted exactly that amount.

**Collateral cannot be inflated.** Lock events carry cumulative totals and the arbiter only raises collateral from them. Stale proofs are ineffective, replayed proofs revert.

**Payments are not double paid.** The spender records each payout id. A repeated instruction reverts on chain, no matter who sends it.

**Withdrawals cannot outrun settlement.** Unlocking is a two step process with a delay, and a deduction that lands during the delay shrinks any pending withdrawal to what the remaining collateral can cover.

## The operator key, honestly

Attestcoin **Writability** is not yet live on testnet; the official documentation states it is undergoing third party testing and audits. Until it ships, two actions need a courier: calling `payout` on the spender and `deduct` on the escrow. Karun uses an operator key for both.

This is a real trust assumption and it is worth being precise about what it can and cannot do.

**It cannot** create collateral, raise a balance, authorise a payment, settle a claim, or move funds to itself. Every one of those paths requires a proof.

**It can** delay a cycle by refusing to act, or pay a recipient the arbiter already authorised (which is the intended behaviour). A compromised operator key can drain a spender pool up to the pool balance, because `payout` is the one privileged action that moves money outward. This is why pools are funded per chain and sized deliberately rather than pooled globally.

**Mitigations in place today:** payout ids are single use, the escrow's `deduct` is bounded by the user's actual locked balance, and every operator action is proven back to the arbiter, so any divergence between what was paid and what was authorised is visible on chain.

**The fix:** when Writability lands, `payout` and `deduct` become messages published by the ledger through an Outbox and delivered to an Inbox on the destination chain, validated by attestor signatures. The operator disappears from the trust model entirely. The claim id and replay protections stay exactly as they are, so this is a swap of the caller, not a redesign.

## Failure handling

**The worker dies mid cycle.** Every intermediate state is on chain. On restart the worker reads the last processed block from its own state file, checks the on chain status of each claim, skips what is already done and resumes. A claim that was paid but not settled is picked up at the deduction step, not repeated from the start.

**An attestation is slow.** Normal operation. The worker polls up to thirty minutes with backoff. The claim stays open and the reservation stays in place, so the user cannot spend the same balance twice while waiting.

**A payout fails on the target chain.** The claim stays unpaid, no deduction happens, and the reservation stays. The user's collateral is untouched. Retrying is safe because the payout id is idempotent.

**A pool runs dry.** `payout` reverts with a clear reason and the interface checks pool liquidity before letting the user authorise a payment at all, so the common case is caught before any transaction is signed.

**A chain becomes unhealthy.** Collateral and payouts are separate flags per chain. Either can be disabled without touching the other, and disabling payouts does not block settlement of claims already in flight.

## Known limits

* **Liquidity rebalancing is manual.** Pools drain on chains where users spend and fill on chains where they settle. A production system needs automated rebalancing; the current build funds pools directly.
* **One collateral asset.** The loan-to-value ratio is per chain and the code paths are asset agnostic, but only a 6 decimal stablecoin has been exercised.
* **No independent audit.** The contracts have 21 unit tests and a three chain end to end simulation, plus a full recorded testnet cycle. That is evidence of correctness, not a substitute for review. Any mainnet deployment should be preceded by an external audit, which is exactly what the CertiK credit offered by this hackathon would fund.

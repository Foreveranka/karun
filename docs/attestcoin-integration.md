# Attestcoin integration

How Karun builds, submits and verifies proofs, and why the protocol is load bearing rather than decorative.

## Three proofs per payment

Every completed payment produces three separate on chain verifications on Creditcoin:

| Proof | Source chain event | What the arbiter learns | Without it |
|---|---|---|---|
| Lock | `Locked(user, amount, totalLocked)` | The user really locked collateral | The worker could invent balances |
| Payout | `Paid(claimId, recipient, amount)` | The recipient really got paid | The protocol could claim it paid and deduct anyway |
| Deduction | `Deducted(user, amount, claimId, remaining)` | The escrow really took the money | Claims would close on a courier's word |

Remove the protocol and there is no honest way to run any of these steps. That is the test of a real integration.

## The proof bundle

All three entry points take the same structure, kept as a single struct so the call stays within EVM stack limits:

```solidity
struct Kanit {
    uint64 chainKey;                                   // source chain, Sepolia is 1
    uint64 blockHeight;                                // block containing the transaction
    bytes encodedTransaction;                          // the transaction and receipt bytes
    bytes32 merkleRoot;                                // root the inclusion proof lands on
    INativeQueryVerifier.MerkleProofEntry[] siblings;  // inclusion path
    bytes32 lowerEndpointDigest;                       // start of the continuity chain
    bytes32[] continuityRoots;                         // digests linking to an attestation
}
```

The worker fills this from the proof builder response, mapping `headerNumber` to `blockHeight` and `txBytes` to `encodedTransaction`.

## Verification path

```solidity
uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
queryId = keccak256(abi.encodePacked(chainKey, blockHeight, txIndex));
require(!processedQueries[queryId], "Karun: sorgu islendi");

bool verified = VERIFIER.verifyAndEmit(
    chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof
);
require(verified, "Karun: kanit gecersiz");
processedQueries[queryId] = true;
```

`VERIFIER` is the Block Prover Precompile at `0x0000000000000000000000000000000000000FD2`. Verification is synchronous, so a single Creditcoin transaction proves a foreign event and acts on it.

## Three checks the precompile does not do for you

The precompile answers exactly one question: is this transaction genuinely part of the confirmed source chain. Everything else is the contract's job, and skipping any of these is a vulnerability.

**Was the transaction successful?** A reverted transaction is still included in a block. Karun decodes the receipt and requires `receiptStatus == 1`.

```solidity
EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);
require(receipt.receiptStatus == 1, "Karun: islem basarisiz");
```

**Who emitted the event?** Anyone can deploy a contract that emits an event with the same signature. Karun filters by event signature and then keeps only logs emitted by the address registered for that chain.

```solidity
EvmV1Decoder.LogEntry[] memory bySig = EvmV1Decoder.getLogsByEventSignature(receipt, signature);
// keep only bySig[i].address_ == registered escrow or spender
```

**Has this proof been used already?** Query ids are derived from chain key, block height and transaction index, and stored. A resubmitted proof reverts.

## Handling stale proofs

Replay protection stops the same proof twice, but not an *old* proof submitted late. A user could lock 5,000, spend, then submit a proof of an earlier smaller lock to try to confuse the accounting.

Karun avoids this by design rather than by rule: the `Locked` event carries the cumulative total, and the arbiter only ever raises collateral, never lowers it from a lock proof.

```solidity
if (totalLocked > collateral[user][chainKey]) collateral[user][chainKey] = totalLocked;
```

Collateral only comes down through a deduction proof, which carries the escrow's own reported remaining balance.

## What the worker does and does not do

The worker waits for attestation, fetches proofs, and submits transactions. It uses `@gluwa/usc-sdk` for both:

```ts
const proofBuilder = new proofProvider.service.ProofBuilder(CHAIN_KEY, proofBuilderUrl);
await proofBuilder.waitUntilHeightAttested(CHAIN_KEY, blockNumber, 15_000, 1_800_000);
const proof = await proofBuilder.getProof(txHash);
```

It cannot forge a lock, pay itself, or close a claim, because every one of those actions is gated by a proof the precompile must accept. The worst a malicious worker can do is stop working, which delays settlement but loses nothing: collateral stays locked, the claim stays open, and any other worker can finish the job.

## Timing

Attestations arrive at intervals, so there is a wait between an event and the moment it can be proven. On testnet this is roughly eight minutes, which matched the documented interval in every cycle we ran. The worker polls with a thirty minute ceiling and retries with exponential backoff, because a slow attestation is normal operation, not an error.

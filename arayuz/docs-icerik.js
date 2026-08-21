window.KARUN_DOCS = [
 {
  "slug": "what-is-karun",
  "menu": "What is Karun",
  "baslik": "What is Karun",
  "altBaslik": "Description of Karun, a settlement layer that turns funds locked on any chain into one spendable balance, without bridging.",
  "html": "<p>Karun is named after King Croesus, known in Turkish as Karun, the Anatolian ruler who minted the first coins in history. His wealth was proverbial because it was recognised everywhere. That is the goal here: money that counts wherever you are, without being moved.</p>\n<h2 id=\"the-problem\">The problem</h2>\n<p>Capital is scattered. A user holds USDC on Ethereum, a little on Base, some on Arbitrum. When they need to pay someone on a chain where they hold nothing, they have exactly one option today: bridge. Bridging means locking or burning on one side, waiting, minting a wrapped asset on the other, and trusting whatever sits in the middle. Every hop costs time, costs fees, and adds an attack surface. Worse, it fragments the balance further: after the bridge, the money is somewhere new and the old chain is empty.</p>\n<p>The user never wanted to move their money. They wanted to make a payment.</p>\n<h2 id=\"the-idea\">The idea</h2>\n<p>Karun separates <strong>where value sits</strong> from <strong>where value is spent</strong>.</p>\n<p>Funds stay locked on the chain the user already trusts. Creditcoin acts as an arbiter: it verifies, through the Attestcoin Protocol, that the lock genuinely happened, then grants the user a single spendable balance worth a percentage of that collateral. When the user pays, the recipient is paid from a Karun liquidity pool <strong>on the chain the user chooses</strong>, and the exact amount plus a fee is deducted from the collateral on the source chain. That deduction is proven back on Creditcoin, and the claim closes.</p>\n<p>No wrapped token is ever minted for the user. No debt accrues. Every payment settles against the user's own funds.</p>\n<h2 id=\"what-the-user-sees\">What the user sees</h2>\n<ol><li>Lock stablecoins on a chain where you already hold them.</li><li>Your spendable balance opens once Creditcoin has verified the lock.</li><li>Pay any address on any supported chain. The recipient receives real tokens and never needs to know Karun exists.</li><li>Your collateral drops by exactly what you spent, plus the fee.</li></ol>\n<h2 id=\"who-it-is-for\">Who it is for</h2>\n<ul><li><strong>People paid across borders</strong> who hold stablecoins on one chain and need to pay on another.</li><li><strong>Merchants and freelancers</strong> who want funds to arrive on the chain their customer uses, not the chain their supplier uses.</li><li><strong>Treasuries</strong> that want to keep reserves on one chain while paying operating costs on several.</li></ul>\n<h2 id=\"what-makes-it-possible\">What makes it possible</h2>\n<p>Karun is not a bridge with extra steps. It works because Creditcoin can <em>read other chains natively</em>. The Attestcoin Protocol gives contracts on Creditcoin verified access to events on any supported chain, checked by a decentralised set of attestors and validated on chain by the Block Prover Precompile. Without that, the arbiter would have to trust a relayer's word about a lock, and the whole model would collapse into the same trust problem bridges have.</p>\n<p>Karun uses that capability three times in every single payment. See <a href=\"attestcoin-integration.md\">Attestcoin integration</a>.</p>",
  "basliklar": [
   {
    "id": "the-problem",
    "ad": "The problem"
   },
   {
    "id": "the-idea",
    "ad": "The idea"
   },
   {
    "id": "what-the-user-sees",
    "ad": "What the user sees"
   },
   {
    "id": "who-it-is-for",
    "ad": "Who it is for"
   },
   {
    "id": "what-makes-it-possible",
    "ad": "What makes it possible"
   }
  ]
 },
 {
  "slug": "architecture",
  "menu": "Architecture",
  "baslik": "Architecture",
  "altBaslik": "Highest level description of how Karun is put together, and what each chain is responsible for.",
  "html": "<p>Karun runs on three kinds of chain, and the separation between them is the whole design.</p>\n<h2 id=\"key-terms\">Key terms</h2>\n<ul><li><strong>Arbiter:</strong> the Creditcoin contract that holds the accounting. It verifies proofs, tracks each user's spendable balance, authorises payments and settles claims. It holds no tokens and pays nobody.</li><li><strong>Collateral chain:</strong> a chain where a user locks funds. Runs a <code>KarunEscrow</code>.</li><li><strong>Payout chain:</strong> a chain where a recipient can be paid. Runs a <code>KarunSpender</code> holding protocol liquidity.</li><li><strong>Claim:</strong> one authorised payment, tracked from creation to settlement. Carries the user, both chains, the recipient, the amount and the total to be deducted.</li><li><strong>Spendable balance:</strong> the loan-to-value share of a user's attested collateral, minus anything still settling.</li><li><strong>Worker:</strong> an off chain service that carries transactions and proofs between the chains. It cannot forge anything; every action it takes is verified on chain.</li></ul>\n<p>A chain can be a collateral chain, a payout chain, or both. Sepolia is both in the current deployment.</p>\n<blockquote>Creditcoin is <strong>not</strong> a payout chain. It is deliberately kept free of user funds so that the accounting layer can never be drained. A compromise of the arbiter cannot move money; it can only mis-authorise a payment, which is still bounded by the liquidity of the target pool.</blockquote>\n<h2 id=\"contracts\">Contracts</h2>\n<h3 id=\"karunescrow\">KarunEscrow</h3>\n<blockquote>Deployed on every collateral chain</blockquote>\n<p>Holds user collateral. Three operations matter:</p>\n<ul><li><code>lock(amount)</code> pulls stablecoins in and emits <code>Locked(user, amount, totalLocked)</code>. The event carries the <strong>cumulative</strong> total, not the delta, so a stale proof can never inflate a balance.</li><li><code>deduct(user, amount, claimId)</code> moves the settled amount to the treasury and emits <code>Deducted(user, amount, claimId, remainingLocked)</code>. Each <code>claimId</code> is processed once.</li><li><code>requestUnlock</code> and <code>withdraw</code> implement a delayed withdrawal. The delay exists so that in flight payments can be deducted before collateral leaves.</li></ul>\n<h3 id=\"karunspender\">KarunSpender</h3>\n<blockquote>Deployed on every payout chain</blockquote>\n<p>Holds protocol liquidity and pays recipients.</p>\n<ul><li><code>payout(payoutId, recipient, amount)</code> transfers to the recipient and emits <code>Paid(payoutId, recipient, amount)</code>. The <code>payoutId</code> is the claim id created by the arbiter, which is what lets the arbiter recognise the payout later.</li><li><code>fund</code> and <code>defund</code> manage the pool.</li></ul>\n<p>Replay protection is per payout id, so a repeated instruction can never pay twice.</p>\n<h3 id=\"karunledger\">KarunLedger</h3>\n<blockquote>Deployed on Creditcoin. This is the Attestcoin Smart Contract.</blockquote>\n<p>The arbiter. It exposes:</p>\n<ul><li><code>zincirTanimla</code> to register a chain with its escrow, its spender, its loan-to-value ratio and whether collateral and payouts are enabled there.</li><li><code>submitLockProof</code>, <code>submitPaymentProof</code>, <code>submitDeductionProof</code>, each taking one proof bundle and each calling the Block Prover Precompile before it believes anything.</li><li><code>requestPayment(recipient, amount, targetChain, sourceChain)</code> which checks the balance, reserves it, and emits <code>PaymentAuthorized</code>.</li><li>Views: <code>available</code>, <code>collateral</code>, <code>outstanding</code>, <code>talepler</code> for claim state.</li></ul>\n<h3 id=\"karunascbase\">KarunAscBase</h3>\n<p>The reusable base that every Attestcoin Smart Contract in this project inherits. It owns the precompile handle, computes a query id from chain key, block height and transaction index, and refuses to process the same query twice.</p>\n<h2 id=\"actors\">Actors</h2>\n<h3 id=\"the-user\">The user</h3>\n<p>Locks collateral, authorises payments. Signs on the collateral chain to lock, and on Creditcoin to authorise. Never signs on the payout chain and never needs gas there.</p>\n<h3 id=\"the-worker\">The worker</h3>\n<p>Watches both sides. When it sees a <code>Locked</code> event it waits for Attestcoin to attest that block, fetches the Merkle and continuity proofs from the proof builder service, and submits them to the arbiter. When it sees a <code>PaymentAuthorized</code> event it calls the spender, proves the payout, calls the escrow deduction, and proves that too.</p>\n<p>The worker is a courier, not an authority. It cannot fabricate a lock, cannot pay itself, and cannot close a claim without a proof that the precompile accepts. If it disappears mid cycle, everything it has already done is on chain and it resumes from where it stopped.</p>\n<h3 id=\"the-attestcoin-protocol\">The Attestcoin Protocol</h3>\n<p>Attestors watch source chains and reach consensus on their state. Validators commit those attestations to Creditcoin. The Block Prover Precompile at <code>0x0FD2</code> verifies, synchronously and at native speed, that a given transaction really belongs to a block that really belongs to the attested chain.</p>\n<h2 id=\"why-this-shape\">Why this shape</h2>\n<p>The obvious alternative is to keep the money on Creditcoin and pay from there. That is what the first version of Karun did, and it was wrong. It makes Creditcoin a payout chain, which means every user must end up with a balance there, which is bridging with extra words.</p>\n<p>Keeping Creditcoin as a pure arbiter has three consequences that matter:</p>\n<ol><li><strong>The user never leaves their chain.</strong> Their funds sit where they put them and are spent where they are needed.</li><li><strong>Adding a chain is a configuration change, not a migration.</strong> A new payout chain needs a spender and one call to <code>zincirTanimla</code>.</li><li><strong>The accounting layer holds nothing worth stealing.</strong> All value sits in escrows and pools, each bounded and each on its own chain.</li></ol>",
  "basliklar": [
   {
    "id": "key-terms",
    "ad": "Key terms"
   },
   {
    "id": "contracts",
    "ad": "Contracts"
   },
   {
    "id": "actors",
    "ad": "Actors"
   },
   {
    "id": "why-this-shape",
    "ad": "Why this shape"
   }
  ]
 },
 {
  "slug": "payment-lifecycle",
  "menu": "How a payment works",
  "baslik": "How a payment works",
  "altBaslik": "The complete cycle, from locking collateral to a settled claim, with the state changes at each step.",
  "html": "<h2 id=\"the-cycle\">The cycle</h2>\n<pre class=\"mermaid\">sequenceDiagram\n    participant U as User\n    participant E as KarunEscrow&lt;br/&gt;(collateral chain)\n    participant W as Worker\n    participant P as Attestcoin&lt;br/&gt;attestors + precompile\n    participant L as KarunLedger&lt;br/&gt;(Creditcoin)\n    participant S as KarunSpender&lt;br/&gt;(payout chain)\n    participant R as Recipient\n\n    U-&gt;&gt;E: lock(5,000)\n    E--&gt;&gt;W: Locked(user, 5000, total 5000)\n    W-&gt;&gt;P: wait for attestation, fetch proofs\n    W-&gt;&gt;L: submitLockProof\n    L-&gt;&gt;P: verifyAndEmit at 0x0FD2\n    L-&gt;&gt;L: collateral 5,000 → balance 4,000\n\n    U-&gt;&gt;L: requestPayment(recipient, 1000, payoutChain, sourceChain)\n    L-&gt;&gt;L: reserve 1,003 (amount + 0.30% fee)\n    L--&gt;&gt;W: PaymentAuthorized(claimId)\n\n    W-&gt;&gt;S: payout(claimId, recipient, 1000)\n    S-&gt;&gt;R: 1,000 arrives\n    S--&gt;&gt;W: Paid(claimId, recipient, 1000)\n    W-&gt;&gt;P: prove the payout\n    W-&gt;&gt;L: submitPaymentProof\n    L-&gt;&gt;L: claim marked paid\n\n    W-&gt;&gt;E: deduct(user, 1003, claimId)\n    E--&gt;&gt;W: Deducted(user, 1003, claimId, remaining 3997)\n    W-&gt;&gt;P: prove the deduction\n    W-&gt;&gt;L: submitDeductionProof\n    L-&gt;&gt;L: claim settled, outstanding → 0</pre>\n<h2 id=\"step-by-step\">Step by step</h2>\n<h3 id=\"1-lock\">1. Lock</h3>\n<p>The user calls <code>lock</code> on the escrow of a chain where they already hold stablecoins. Nothing else happens yet: no token is minted for them, no balance appears. The escrow emits <code>Locked</code> carrying the cumulative total.</p>\n<h3 id=\"2-prove-the-lock\">2. Prove the lock</h3>\n<p>The worker waits until the Attestcoin attestors have attested the block containing that transaction, which takes roughly eight minutes on testnet. It then asks the proof builder service for a Merkle proof of transaction inclusion and a continuity proof linking that block to an on chain attestation, and submits both to <code>submitLockProof</code>.</p>\n<p>The arbiter calls the Block Prover Precompile. If verification succeeds, it decodes the receipt, insists the transaction status is <code>0x1</code>, checks the event came from the registered escrow, and syncs the collateral. The spendable balance opens at the loan-to-value ratio, currently 80% for stablecoins.</p>\n<blockquote>The precompile proves inclusion, not success. A reverted transaction is still included in a block. The arbiter therefore checks the receipt status itself, as the protocol documentation requires.</blockquote>\n<h3 id=\"3-authorise-a-payment\">3. Authorise a payment</h3>\n<p>The user calls <code>requestPayment</code> on Creditcoin with the recipient, the amount, the chain to pay on and the chain to settle from. The arbiter checks three things: the payout chain accepts payouts, the source chain holds enough of this user's collateral, and the amount plus fee fits inside the spendable balance. It reserves the total, creates the claim, and emits <code>PaymentAuthorized</code>.</p>\n<p>Reserving before paying is what prevents double spending. All balance accounting happens in one place, so two payments authorised in the same block cannot both draw on the same collateral.</p>\n<h3 id=\"4-pay-the-recipient\">4. Pay the recipient</h3>\n<p>The worker calls <code>payout</code> on the spender of the target chain. The recipient receives real stablecoins from the Karun pool. They sign nothing, hold no gas on any other chain, and do not need to know the protocol exists.</p>\n<h3 id=\"5-prove-the-payout\">5. Prove the payout</h3>\n<p>The payout transaction is proven back to Creditcoin the same way the lock was. The arbiter checks that the claim id, recipient and amount all match what it authorised, then marks the claim paid. Until this proof lands, the protocol has no on chain evidence that the money actually arrived.</p>\n<h3 id=\"6-deduct-and-prove\">6. Deduct and prove</h3>\n<p>The worker calls <code>deduct</code> on the escrow with the claim id. The escrow moves the amount plus fee to the treasury and emits <code>Deducted</code> with the remaining lock. That transaction is proven to Creditcoin one final time. The arbiter matches the claim, releases the reservation, syncs the collateral down to the escrow's own reported figure, and closes the claim.</p>\n<p>Outstanding debt returns to zero. The user's balance is now the loan-to-value share of whatever collateral remains.</p>\n<h2 id=\"what-the-numbers-look-like\">What the numbers look like</h2>\n<p>From the recorded testnet run:</p>\n<div class=\"tablo-sar\"><table><thead><tr><th>Stage</th><th>Collateral</th><th>Spendable</th><th>Outstanding</th><th>Recipient</th></tr></thead><tbody><tr><td>After lock, before proof</td><td>5,000</td><td>0</td><td>0</td><td>0</td></tr><tr><td>Lock proven</td><td>5,000</td><td>4,000</td><td>0</td><td>0</td></tr><tr><td>Payment authorised</td><td>5,000</td><td>2,997</td><td>1,003</td><td>0</td></tr><tr><td>Recipient paid</td><td>5,000</td><td>2,997</td><td>1,003</td><td>1,000</td></tr><tr><td>Deduction settled</td><td>3,997</td><td>3,197.60</td><td>0</td><td>1,000</td></tr></tbody></table></div>\n<p>The user spent 1,000, paid 3 in fees, and never bridged anything.</p>\n<h2 id=\"why-the-80\">Why the 80%</h2>\n<p>The gap between collateral and spendable balance covers the window between authorising a payment and settling it. During those minutes the protocol has paid a recipient but has not yet recovered the funds. The buffer absorbs latency, and for non stablecoin collateral it would also absorb price movement. It is a per chain parameter, so a volatile asset can carry a lower ratio without affecting stablecoin users.</p>",
  "basliklar": [
   {
    "id": "the-cycle",
    "ad": "The cycle"
   },
   {
    "id": "step-by-step",
    "ad": "Step by step"
   },
   {
    "id": "what-the-numbers-look-like",
    "ad": "What the numbers look like"
   },
   {
    "id": "why-the-80",
    "ad": "Why the 80%"
   }
  ]
 },
 {
  "slug": "attestcoin-integration",
  "menu": "Attestcoin integration",
  "baslik": "Attestcoin integration",
  "altBaslik": "How Karun builds, submits and verifies proofs, and why the protocol is load bearing rather than decorative.",
  "html": "<h2 id=\"three-proofs-per-payment\">Three proofs per payment</h2>\n<p>Every completed payment produces three separate on chain verifications on Creditcoin:</p>\n<div class=\"tablo-sar\"><table><thead><tr><th>Proof</th><th>Source chain event</th><th>What the arbiter learns</th><th>Without it</th></tr></thead><tbody><tr><td>Lock</td><td><code>Locked(user, amount, totalLocked)</code></td><td>The user really locked collateral</td><td>The worker could invent balances</td></tr><tr><td>Payout</td><td><code>Paid(claimId, recipient, amount)</code></td><td>The recipient really got paid</td><td>The protocol could claim it paid and deduct anyway</td></tr><tr><td>Deduction</td><td><code>Deducted(user, amount, claimId, remaining)</code></td><td>The escrow really took the money</td><td>Claims would close on a courier's word</td></tr></tbody></table></div>\n<p>Remove the protocol and there is no honest way to run any of these steps. That is the test of a real integration.</p>\n<h2 id=\"the-proof-bundle\">The proof bundle</h2>\n<p>All three entry points take the same structure, kept as a single struct so the call stays within EVM stack limits:</p>\n<pre><code>struct Kanit {\n    uint64 chainKey;                                   // source chain, Sepolia is 1\n    uint64 blockHeight;                                // block containing the transaction\n    bytes encodedTransaction;                          // the transaction and receipt bytes\n    bytes32 merkleRoot;                                // root the inclusion proof lands on\n    INativeQueryVerifier.MerkleProofEntry[] siblings;  // inclusion path\n    bytes32 lowerEndpointDigest;                       // start of the continuity chain\n    bytes32[] continuityRoots;                         // digests linking to an attestation\n}</code></pre>\n<p>The worker fills this from the proof builder response, mapping <code>headerNumber</code> to <code>blockHeight</code> and <code>txBytes</code> to <code>encodedTransaction</code>.</p>\n<h2 id=\"verification-path\">Verification path</h2>\n<pre><code>uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);\nqueryId = keccak256(abi.encodePacked(chainKey, blockHeight, txIndex));\nrequire(!processedQueries[queryId], \"Karun: sorgu islendi\");\n\nbool verified = VERIFIER.verifyAndEmit(\n    chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof\n);\nrequire(verified, \"Karun: kanit gecersiz\");\nprocessedQueries[queryId] = true;</code></pre>\n<h2 id=\"three-checks-the-precompile-does-not-do-for-you\">Three checks the precompile does not do for you</h2>\n<p>The precompile answers exactly one question: is this transaction genuinely part of the confirmed source chain. Everything else is the contract's job, and skipping any of these is a vulnerability.</p>\n<pre><code>EvmV1Decoder.ReceiptFields memory receipt = EvmV1Decoder.decodeReceiptFields(encodedTransaction);\nrequire(receipt.receiptStatus == 1, \"Karun: islem basarisiz\");</code></pre>\n<pre><code>EvmV1Decoder.LogEntry[] memory bySig = EvmV1Decoder.getLogsByEventSignature(receipt, signature);\n// keep only bySig[i].address_ == registered escrow or spender</code></pre>\n<h2 id=\"handling-stale-proofs\">Handling stale proofs</h2>\n<p>Replay protection stops the same proof twice, but not an <em>old</em> proof submitted late. A user could lock 5,000, spend, then submit a proof of an earlier smaller lock to try to confuse the accounting.</p>\n<p>Karun avoids this by design rather than by rule: the <code>Locked</code> event carries the cumulative total, and the arbiter only ever raises collateral, never lowers it from a lock proof.</p>\n<pre><code>if (totalLocked &gt; collateral[user][chainKey]) collateral[user][chainKey] = totalLocked;</code></pre>\n<p>Collateral only comes down through a deduction proof, which carries the escrow's own reported remaining balance.</p>\n<h2 id=\"what-the-worker-does-and-does-not-do\">What the worker does and does not do</h2>\n<p>The worker waits for attestation, fetches proofs, and submits transactions. It uses <code>@gluwa/usc-sdk</code> for both:</p>\n<pre><code>const proofBuilder = new proofProvider.service.ProofBuilder(CHAIN_KEY, proofBuilderUrl);\nawait proofBuilder.waitUntilHeightAttested(CHAIN_KEY, blockNumber, 15_000, 1_800_000);\nconst proof = await proofBuilder.getProof(txHash);</code></pre>\n<p>It cannot forge a lock, pay itself, or close a claim, because every one of those actions is gated by a proof the precompile must accept. The worst a malicious worker can do is stop working, which delays settlement but loses nothing: collateral stays locked, the claim stays open, and any other worker can finish the job.</p>\n<h2 id=\"timing\">Timing</h2>\n<p>Attestations arrive at intervals, so there is a wait between an event and the moment it can be proven. On testnet this is roughly eight minutes, which matched the documented interval in every cycle we ran. The worker polls with a thirty minute ceiling and retries with exponential backoff, because a slow attestation is normal operation, not an error.</p>",
  "basliklar": [
   {
    "id": "three-proofs-per-payment",
    "ad": "Three proofs per payment"
   },
   {
    "id": "the-proof-bundle",
    "ad": "The proof bundle"
   },
   {
    "id": "verification-path",
    "ad": "Verification path"
   },
   {
    "id": "three-checks-the-precompile-does-not-do-for-you",
    "ad": "Three checks the precompile does not do for you"
   },
   {
    "id": "handling-stale-proofs",
    "ad": "Handling stale proofs"
   },
   {
    "id": "what-the-worker-does-and-does-not-do",
    "ad": "What the worker does and does not do"
   },
   {
    "id": "timing",
    "ad": "Timing"
   }
  ]
 },
 {
  "slug": "security-model",
  "menu": "Security model",
  "baslik": "Security model",
  "altBaslik": "What Karun trusts, what it guarantees, and what happens when something goes wrong.",
  "html": "<h2 id=\"trust-assumptions\">Trust assumptions</h2>\n<div class=\"tablo-sar\"><table><thead><tr><th>Component</th><th>Trusted for</th><th>Consequence if it misbehaves</th></tr></thead><tbody><tr><td>Attestcoin attestors</td><td>Honest reporting of source chain state</td><td>A dishonest quorum could attest a fake chain. This is Creditcoin's own security assumption, shared by every application on it.</td></tr><tr><td>Block Prover Precompile</td><td>Correct proof verification</td><td>Same as above. Runtime code, not application code.</td></tr><tr><td>Worker</td><td>Liveness only</td><td>Cannot forge, pay itself or settle. A dead worker delays settlement; it cannot cause loss.</td></tr><tr><td>Operator key</td><td>Calling <code>deduct</code> and <code>payout</code></td><td>Bounded: see below. Removed entirely when Writability ships.</td></tr><tr><td>Escrow and spender contracts</td><td>Holding funds correctly</td><td>Per chain, per contract. Failure is contained to that chain.</td></tr></tbody></table></div>\n<h2 id=\"what-is-guaranteed\">What is guaranteed</h2>\n<h2 id=\"the-operator-key-honestly\">The operator key, honestly</h2>\n<p>Attestcoin <strong>Writability</strong> is not yet live on testnet; the official documentation states it is undergoing third party testing and audits. Until it ships, two actions need a courier: calling <code>payout</code> on the spender and <code>deduct</code> on the escrow. Karun uses an operator key for both.</p>\n<p>This is a real trust assumption and it is worth being precise about what it can and cannot do.</p>\n<h2 id=\"failure-handling\">Failure handling</h2>\n<h2 id=\"known-limits\">Known limits</h2>\n<ul><li><strong>Liquidity rebalancing is manual.</strong> Pools drain on chains where users spend and fill on chains where they settle. A production system needs automated rebalancing; the current build funds pools directly.</li><li><strong>One collateral asset.</strong> The loan-to-value ratio is per chain and the code paths are asset agnostic, but only a 6 decimal stablecoin has been exercised.</li><li><strong>No independent audit.</strong> The contracts have 21 unit tests and a three chain end to end simulation, plus a full recorded testnet cycle. That is evidence of correctness, not a substitute for review. Any mainnet deployment should be preceded by an external audit, which is exactly what the CertiK credit offered by this hackathon would fund.</li></ul>",
  "basliklar": [
   {
    "id": "trust-assumptions",
    "ad": "Trust assumptions"
   },
   {
    "id": "what-is-guaranteed",
    "ad": "What is guaranteed"
   },
   {
    "id": "the-operator-key-honestly",
    "ad": "The operator key, honestly"
   },
   {
    "id": "failure-handling",
    "ad": "Failure handling"
   },
   {
    "id": "known-limits",
    "ad": "Known limits"
   }
  ]
 },
 {
  "slug": "deployments",
  "menu": "Deployments",
  "baslik": "Deployments",
  "altBaslik": "Live testnet addresses and the full recorded run.",
  "html": "<h2 id=\"creditcoin-testnet-the-arbiter\">Creditcoin Testnet · the arbiter</h2>\n<p>Chain id 102031 · RPC <code>https://rpc.cc3-testnet.creditcoin.network</code> · <a href=\"https://creditcoin-testnet.blockscout.com/\" target=\"_blank\" rel=\"noopener\">Blockscout</a></p>\n<div class=\"tablo-sar\"><table><thead><tr><th>Contract</th><th>Address</th></tr></thead><tbody><tr><td><code>KarunLedger</code></td><td><a href=\"https://creditcoin-testnet.blockscout.com/address/0xb7d89dD5b11814E73995602F90603ddd893107bB\" target=\"_blank\" rel=\"noopener\"><code>0xb7d89dD5b11814E73995602F90603ddd893107bB</code></a></td></tr><tr><td>Block Prover Precompile</td><td><code>0x0000000000000000000000000000000000000FD2</code></td></tr></tbody></table></div>\n<p>Holds no tokens. Fee 30 bps. Registered chain: Sepolia (chain key 1), LTV 8000 bps, collateral and payouts both enabled.</p>\n<h2 id=\"sepolia-collateral-and-payouts\">Sepolia · collateral and payouts</h2>\n<p>Chain id 11155111 · <a href=\"https://sepolia.etherscan.io/\" target=\"_blank\" rel=\"noopener\">Etherscan</a></p>\n<div class=\"tablo-sar\"><table><thead><tr><th>Contract</th><th>Address</th></tr></thead><tbody><tr><td><code>MockUSDC</code> (6 decimals)</td><td><a href=\"https://sepolia.etherscan.io/address/0xb7d89dD5b11814E73995602F90603ddd893107bB\" target=\"_blank\" rel=\"noopener\"><code>0xb7d89dD5b11814E73995602F90603ddd893107bB</code></a></td></tr><tr><td><code>KarunEscrow</code></td><td><a href=\"https://sepolia.etherscan.io/address/0x07BEf458F5AF8D041e8ac497B2f4528eEec3D855\" target=\"_blank\" rel=\"noopener\"><code>0x07BEf458F5AF8D041e8ac497B2f4528eEec3D855</code></a></td></tr><tr><td><code>KarunSpender</code></td><td><a href=\"https://sepolia.etherscan.io/address/0xD819c276908A910659a5cc9315ee25b8a6287953\" target=\"_blank\" rel=\"noopener\"><code>0xD819c276908A910659a5cc9315ee25b8a6287953</code></a></td></tr></tbody></table></div>\n<p>Payout pool funded with 50,000 mUSDC. Unlock delay 2 minutes for the demo.</p>\n<blockquote>The ledger and the Sepolia mUSDC share an address string. They are different contracts on different chains; the deployer simply had the same nonce on both.</blockquote>\n<h2 id=\"the-recorded-cycle\">The recorded cycle</h2>\n<p>Every step below is a real transaction, in order, with three Attestcoin verifications on chain.</p>\n<div class=\"tablo-sar\"><table><thead><tr><th>#</th><th>Step</th><th>Chain</th><th>Transaction</th></tr></thead><tbody><tr><td>1</td><td>Lock 5,000 mUSDC</td><td>Sepolia</td><td><a href=\"https://sepolia.etherscan.io/tx/0xf497dda097a58b462b3fad7bafd34aa4f0797e8c40e50613d549baad6ee9dad4\" target=\"_blank\" rel=\"noopener\"><code>0xf497dda0…</code></a></td></tr><tr><td>2</td><td><strong>Lock proven</strong>, balance opens at 4,000</td><td>Creditcoin</td><td><a href=\"https://creditcoin-testnet.blockscout.com/tx/0x957c921ba99e4096b6f0fb0dd64c439c462fcdc8c8abb40d1a75ba9b11af0a97\" target=\"_blank\" rel=\"noopener\"><code>0x957c921b…</code></a></td></tr><tr><td>3</td><td>Authorise 1,000 to <code>0x…bEEF</code>, reserve 1,003</td><td>Creditcoin</td><td><a href=\"https://creditcoin-testnet.blockscout.com/tx/0x70b03e0b2d6ef1fe3a89f81bbae3d4e59cf92246a019ce1ac42ddf08e621e01a\" target=\"_blank\" rel=\"noopener\"><code>0x70b03e0b…</code></a></td></tr><tr><td>4</td><td>Pool pays the recipient</td><td>Sepolia</td><td><a href=\"https://sepolia.etherscan.io/tx/0xd2c812a5398952c0480b372ee0b91deed1c0718f01c45ae2d36f45560b69c507\" target=\"_blank\" rel=\"noopener\"><code>0xd2c812a5…</code></a></td></tr><tr><td>5</td><td><strong>Payout proven</strong></td><td>Creditcoin</td><td><a href=\"https://creditcoin-testnet.blockscout.com/tx/0xaf518150a14425463e9aa32243800a0b25412e5f9740a9aa370fd61d061b97d9\" target=\"_blank\" rel=\"noopener\"><code>0xaf518150…</code></a></td></tr><tr><td>6</td><td>Escrow deducts 1,003, lock drops to 3,997</td><td>Sepolia</td><td><a href=\"https://sepolia.etherscan.io/tx/0x6647ed053da0f876f4661e3638e045d45639236bdef8febab44e99895347ff0f\" target=\"_blank\" rel=\"noopener\"><code>0x6647ed05…</code></a></td></tr><tr><td>7</td><td><strong>Deduction proven</strong>, claim settled</td><td>Creditcoin</td><td><a href=\"https://creditcoin-testnet.blockscout.com/tx/0x999fff413cdaab35d6901543f276439ee7a03581e1ef0510bbe0babbf33828c8\" target=\"_blank\" rel=\"noopener\"><code>0x999fff41…</code></a></td></tr></tbody></table></div>\n<h3 id=\"final-state\">Final state</h3>\n<div class=\"tablo-sar\"><table><thead><tr><th></th><th></th></tr></thead><tbody><tr><td>Outstanding debt</td><td><strong>0</strong></td></tr><tr><td>Collateral</td><td>3,997 mUSDC, synced from the escrow's own event</td></tr><tr><td>Spendable balance</td><td>3,197.60 mUSDC</td></tr><tr><td>Recipient</td><td>1,000 mUSDC, received on Sepolia from the Karun pool</td></tr></tbody></table></div>\n<p>Attestation lag was roughly eight minutes per proof, matching the documented interval.</p>\n<h2 id=\"interface\">Interface</h2>\n<p><a href=\"https://karun-eta.vercel.app\" target=\"_blank\" rel=\"noopener\">karun-eta.vercel.app</a> reads directly from these contracts. No backend sits in between.</p>",
  "basliklar": [
   {
    "id": "creditcoin-testnet-the-arbiter",
    "ad": "Creditcoin Testnet · the arbiter"
   },
   {
    "id": "sepolia-collateral-and-payouts",
    "ad": "Sepolia · collateral and payouts"
   },
   {
    "id": "the-recorded-cycle",
    "ad": "The recorded cycle"
   },
   {
    "id": "interface",
    "ad": "Interface"
   }
  ]
 },
 {
  "slug": "running-locally",
  "menu": "Run it yourself",
  "baslik": "Run it yourself",
  "altBaslik": "Everything in this project can be reproduced from the repository.",
  "html": "<h2 id=\"requirements\">Requirements</h2>\n<p>Foundry, Node.js 20 or newer.</p>\n<h2 id=\"unit-tests\">Unit tests</h2>\n<pre><code>forge test</code></pre>\n<p>21 tests. They cover the escrow, the spender, the arbiter and the full cross chain cycle, including the case where a user pays on a chain where they hold nothing. Failure paths are tested explicitly: exceeding the balance, paying from a chain with no collateral, replaying a proof, submitting a proof of a failed transaction, and events emitted by an unregistered contract.</p>\n<h2 id=\"local-simulation\">Local simulation</h2>\n<pre><code>sim/calistir.sh</code></pre>\n<p>Starts three local chains, deploys the whole system, and runs eight scenarios end to end with twenty assertions. Chain A holds collateral and pays, chain B only pays, and the third chain plays Creditcoin.</p>\n<p>The simulation is not a mock of the proof format. It takes the <strong>real receipt logs</strong> of the transactions it just made, encodes them the way Attestcoin encodes transactions, and feeds them through the same decoding path the production contract uses. Only the precompile itself is replaced, because a local chain has no attestors.</p>\n<p>Scenario 2 is the one to read first: the user has zero balance on chain B, pays 1,000 there, and the amount is deducted from chain A.</p>\n<h2 id=\"deployment\">Deployment</h2>\n<p>Copy <code>.env.example</code> to <code>.env</code> and fill in a private key.</p>\n<pre><code>forge script script/Deploy.s.sol:DeploySepolia --rpc-url sepolia --broadcast\n\nESCROW_ADDRESS=0x… SPENDER_ADDRESS=0x… \\\nforge create src/KarunLedger.sol:KarunLedger \\\n  --rpc-url https://rpc.cc3-testnet.creditcoin.network \\\n  --private-key $PRIVATE_KEY --legacy --broadcast \\\n  --constructor-args 30 0x0000000000000000000000000000000000000000</code></pre>\n<p>Then register the chain:</p>\n<pre><code>cast send $LEDGER \"zincirTanimla(uint64,address,address,uint16,bool,bool)\" \\\n  1 $ESCROW $SPENDER 8000 true true \\\n  --rpc-url https://rpc.cc3-testnet.creditcoin.network --private-key $PRIVATE_KEY --legacy</code></pre>\n<blockquote>Creditcoin testnet needs <code>--legacy</code>. <code>forge script</code> fails against it with a <code>prevrandao</code> header error, so deploy the ledger with <code>forge create</code> instead.</blockquote>\n<p>Testnet funds: Sepolia from any public faucet, tCTC from the <code>token-faucet</code> channel on the <a href=\"https://discord.gg/creditcoin\" target=\"_blank\" rel=\"noopener\">Creditcoin Discord</a> with <code>/faucet address:0x…</code>.</p>\n<h2 id=\"the-worker\">The worker</h2>\n<pre><code>npm install\nnpm run worker</code></pre>\n<p>It polls both chains, resumes from <code>worker/durum.json</code> after a restart, queues work serially so nonces never collide, and retries transient failures with exponential backoff. Before acting it checks on chain state, so a restart mid cycle does not repeat completed steps.</p>\n<h2 id=\"the-interface\">The interface</h2>\n<p>Any static server works.</p>\n<pre><code>cd arayuz &amp;&amp; python3 -m http.server 8099</code></pre>\n<p>Addresses live in <code>arayuz/karun-config.js</code>.</p>",
  "basliklar": [
   {
    "id": "requirements",
    "ad": "Requirements"
   },
   {
    "id": "unit-tests",
    "ad": "Unit tests"
   },
   {
    "id": "local-simulation",
    "ad": "Local simulation"
   },
   {
    "id": "deployment",
    "ad": "Deployment"
   },
   {
    "id": "the-worker",
    "ad": "The worker"
   },
   {
    "id": "the-interface",
    "ad": "The interface"
   }
  ]
 },
 {
  "slug": "roadmap",
  "menu": "Roadmap",
  "baslik": "Roadmap",
  "altBaslik": "What exists, and what changes as the protocol matures.",
  "html": "<h2 id=\"today\">Today</h2>\n<ul><li>Creditcoin as arbiter, with three Attestcoin proofs per payment</li><li>Collateral and payouts live on Sepolia, verified end to end on testnet</li><li>One stablecoin, one loan-to-value ratio, manual pool funding</li><li>An operator key carries the two outbound actions</li></ul>\n<h2 id=\"when-writability-ships\">When Writability ships</h2>\n<p>Attestcoin Writability is under audit at the time of writing. When it lands, the ledger publishes payout and deduction instructions through an Outbox, attestors validate them, and an Inbox on the destination chain executes them.</p>\n<p>The operator key leaves the trust model. Nothing else about the design changes: claim ids, replay protection and the proof checks stay exactly as they are. This is the single largest security improvement available to the project and it is already anticipated in the contract structure.</p>\n<h2 id=\"more-chains\">More chains</h2>\n<p>Adding a payout chain is a spender deployment plus one <code>zincirTanimla</code> call. Adding a collateral chain is an escrow deployment plus the same call. Every chain Attestcoin supports as a source chain can serve as collateral; every EVM chain can serve as a payout destination.</p>\n<p>The value of the network grows with each chain: a user locking on one chain gains spending reach everywhere else.</p>\n<h2 id=\"liquidity\">Liquidity</h2>\n<p>Pools drain where people spend and fill where they settle. Three steps, in order of ambition:</p>\n<ol><li>Automated rebalancing between pools using the settlement flow itself</li><li>Third party liquidity providers earning the payment fee</li><li>Dynamic fees that price the imbalance, making it profitable to supply the scarce side</li></ol>\n<h2 id=\"beyond-stablecoins\">Beyond stablecoins</h2>\n<p>The loan-to-value ratio is already a per chain parameter. Volatile collateral needs a price feed and a liquidation path, which is a natural fit for the same attestation machinery: prices proven from a source chain rather than trusted from an oracle operator.</p>",
  "basliklar": [
   {
    "id": "today",
    "ad": "Today"
   },
   {
    "id": "when-writability-ships",
    "ad": "When Writability ships"
   },
   {
    "id": "more-chains",
    "ad": "More chains"
   },
   {
    "id": "liquidity",
    "ad": "Liquidity"
   },
   {
    "id": "beyond-stablecoins",
    "ad": "Beyond stablecoins"
   }
  ]
 }
];

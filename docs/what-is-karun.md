# What is Karun

Description of Karun, a settlement layer that turns funds locked on any chain into one spendable balance, without bridging.

Karun is named after King Croesus, known in Turkish as Karun, the Anatolian ruler who minted the first coins in history. His wealth was proverbial because it was recognised everywhere. That is the goal here: money that counts wherever you are, without being moved.

## The problem

Capital is scattered. A user holds USDC on Ethereum, a little on Base, some on Arbitrum. When they need to pay someone on a chain where they hold nothing, they have exactly one option today: bridge. Bridging means locking or burning on one side, waiting, minting a wrapped asset on the other, and trusting whatever sits in the middle. Every hop costs time, costs fees, and adds an attack surface. Worse, it fragments the balance further: after the bridge, the money is somewhere new and the old chain is empty.

The user never wanted to move their money. They wanted to make a payment.

## The idea

Karun separates **where value sits** from **where value is spent**.

Funds stay locked on the chain the user already trusts. Creditcoin acts as an arbiter: it verifies, through the Attestcoin Protocol, that the lock genuinely happened, then grants the user a single spendable balance worth a percentage of that collateral. When the user pays, the recipient is paid from a Karun liquidity pool **on the chain the user chooses**, and the exact amount plus a fee is deducted from the collateral on the source chain. That deduction is proven back on Creditcoin, and the claim closes.

No wrapped token is ever minted for the user. No debt accrues. Every payment settles against the user's own funds.

## What the user sees

1. Lock stablecoins on a chain where you already hold them.
2. Your spendable balance opens once Creditcoin has verified the lock.
3. Pay any address on any supported chain. The recipient receives real tokens and never needs to know Karun exists.
4. Your collateral drops by exactly what you spent, plus the fee.

## Who it is for

* **People paid across borders** who hold stablecoins on one chain and need to pay on another.
* **Merchants and freelancers** who want funds to arrive on the chain their customer uses, not the chain their supplier uses.
* **Treasuries** that want to keep reserves on one chain while paying operating costs on several.

## What makes it possible

Karun is not a bridge with extra steps. It works because Creditcoin can *read other chains natively*. The Attestcoin Protocol gives contracts on Creditcoin verified access to events on any supported chain, checked by a decentralised set of attestors and validated on chain by the Block Prover Precompile. Without that, the arbiter would have to trust a relayer's word about a lock, and the whole model would collapse into the same trust problem bridges have.

Karun uses that capability three times in every single payment. See [Attestcoin integration](attestcoin-integration.md).

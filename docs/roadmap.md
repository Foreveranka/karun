# Roadmap

What exists, and what changes as the protocol matures.

## Today

* Creditcoin as arbiter, with three Attestcoin proofs per payment
* Collateral and payouts live on Sepolia, verified end to end on testnet
* One stablecoin, one loan-to-value ratio, manual pool funding
* An operator key carries the two outbound actions

## When Writability ships

Attestcoin Writability is under audit at the time of writing. When it lands, the ledger publishes payout and deduction instructions through an Outbox, attestors validate them, and an Inbox on the destination chain executes them.

The operator key leaves the trust model. Nothing else about the design changes: claim ids, replay protection and the proof checks stay exactly as they are. This is the single largest security improvement available to the project and it is already anticipated in the contract structure.

## More chains

Adding a payout chain is a spender deployment plus one `zincirTanimla` call. Adding a collateral chain is an escrow deployment plus the same call. Every chain Attestcoin supports as a source chain can serve as collateral; every EVM chain can serve as a payout destination.

The value of the network grows with each chain: a user locking on one chain gains spending reach everywhere else.

## Liquidity

Pools drain where people spend and fill where they settle. Three steps, in order of ambition:

1. Automated rebalancing between pools using the settlement flow itself
2. Third party liquidity providers earning the payment fee
3. Dynamic fees that price the imbalance, making it profitable to supply the scarce side

## Beyond stablecoins

The loan-to-value ratio is already a per chain parameter. Volatile collateral needs a price feed and a liquidation path, which is a natural fit for the same attestation machinery: prices proven from a source chain rather than trusted from an oracle operator.

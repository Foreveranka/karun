# Run it yourself

Everything in this project can be reproduced from the repository.

## Requirements

Foundry, Node.js 20 or newer.

## Unit tests

```bash
forge test
```

21 tests. They cover the escrow, the spender, the arbiter and the full cross chain cycle, including the case where a user pays on a chain where they hold nothing. Failure paths are tested explicitly: exceeding the balance, paying from a chain with no collateral, replaying a proof, submitting a proof of a failed transaction, and events emitted by an unregistered contract.

## Local simulation

```bash
sim/calistir.sh
```

Starts three local chains, deploys the whole system, and runs eight scenarios end to end with twenty assertions. Chain A holds collateral and pays, chain B only pays, and the third chain plays Creditcoin.

The simulation is not a mock of the proof format. It takes the **real receipt logs** of the transactions it just made, encodes them the way Attestcoin encodes transactions, and feeds them through the same decoding path the production contract uses. Only the precompile itself is replaced, because a local chain has no attestors.

Scenario 2 is the one to read first: the user has zero balance on chain B, pays 1,000 there, and the amount is deducted from chain A.

## Deployment

Copy `.env.example` to `.env` and fill in a private key.

```bash
forge script script/Deploy.s.sol:DeploySepolia --rpc-url sepolia --broadcast

ESCROW_ADDRESS=0x… SPENDER_ADDRESS=0x… \
forge create src/KarunLedger.sol:KarunLedger \
  --rpc-url https://rpc.cc3-testnet.creditcoin.network \
  --private-key $PRIVATE_KEY --legacy --broadcast \
  --constructor-args 30 0x0000000000000000000000000000000000000000
```

Then register the chain:

```bash
cast send $LEDGER "zincirTanimla(uint64,address,address,uint16,bool,bool)" \
  1 $ESCROW $SPENDER 8000 true true \
  --rpc-url https://rpc.cc3-testnet.creditcoin.network --private-key $PRIVATE_KEY --legacy
```

> Creditcoin testnet needs `--legacy`. `forge script` fails against it with a `prevrandao` header error, so deploy the ledger with `forge create` instead.

Testnet funds: Sepolia from any public faucet, tCTC from the `token-faucet` channel on the [Creditcoin Discord](https://discord.gg/creditcoin) with `/faucet address:0x…`.

## The worker

```bash
npm install
npm run worker
```

It polls both chains, resumes from `worker/durum.json` after a restart, queues work serially so nonces never collide, and retries transient failures with exponential backoff. Before acting it checks on chain state, so a restart mid cycle does not repeat completed steps.

## The interface

Any static server works.

```bash
cd arayuz && python3 -m http.server 8099
```

Addresses live in `arayuz/karun-config.js`.

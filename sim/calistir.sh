#!/bin/bash
# Karun yerel simulasyonu: uc anvil zinciri + uctan uca coklu zincir senaryosu
set -e
export PATH="$PATH:$HOME/.foundry/bin"
cd "$(dirname "$0")/.."

echo "Kontratlar derleniyor..."
forge build > /dev/null

pkill -f "anvil --port 854" 2>/dev/null || true
sleep 0.5
echo "Yerel zincirler baslatiliyor (A: teminat, B: hedef, CC: Creditcoin)..."
anvil --port 8545 --chain-id 11155111 --silent &   # A: Sepolia benzeri
ANVIL_A=$!
anvil --port 8547 --chain-id 8453 --silent &       # B: Base benzeri
ANVIL_B=$!
anvil --port 8546 --chain-id 102031 --silent &     # CC: Creditcoin
ANVIL_CC=$!
trap "kill $ANVIL_A $ANVIL_B $ANVIL_CC 2>/dev/null" EXIT
sleep 1.5

npx tsx sim/senaryo.ts

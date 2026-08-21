#!/bin/bash
# Karun yerel simulasyonu: iki anvil zinciri + uctan uca senaryo
set -e
export PATH="$PATH:$HOME/.foundry/bin"
cd "$(dirname "$0")/.."

echo "Kontratlar derleniyor..."
forge build > /dev/null

pkill -f "anvil --port 854" 2>/dev/null || true
sleep 0.5
echo "Yerel zincirler baslatiliyor..."
anvil --port 8545 --chain-id 11155111 --silent &
ANVIL_A=$!
anvil --port 8546 --chain-id 102031 --silent &
ANVIL_B=$!
trap "kill $ANVIL_A $ANVIL_B 2>/dev/null" EXIT
sleep 1.5

npx tsx sim/senaryo.ts

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

source ./scripts/helpers.sh

require_cmd sncast
require_env STARKNET_RPC_URL

if [[ "${UA2_USE_PROXY:-0}" != "1" ]]; then
  warn "UA2_USE_PROXY != 1. Upgrade is a no-op. Enable proxy mode once UUPS is implemented."
  exit 0
fi

OUTPUT_FILE="${UA2_OUTPUT_FILE:-./.ua2-sepolia-addresses.json}"

# Resolve addresses
UA2_PROXY_ADDR="${UA2_PROXY_ADDR:-$(sed -n 's/.*"UA2_PROXY_ADDR": *"\([^"]*\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)}"
UA2_CLASS_HASH="${UA2_CLASS_HASH:-$(sed -n 's/.*"UA2_CLASS_HASH": *"\([^"]*\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)}"

require_env UA2_PROXY_ADDR
require_env UA2_CLASS_HASH

AUTH_ARGS="$(sncast_auth_args)"

log "Upgrading UA2 proxy to new implementation (class hash: $UA2_CLASS_HASH)…"
warn "This expects UA2Account to implement UUPS and proxy admin to be correctly configured."
warn "No effect unless your contract exposes upgrade entrypoint per OZ UUPS."

# Placeholder call. Replace with your UUPS upgrade entrypoint name and calldata once implemented.
ENTRYPOINT="upgradeTo"   # example; adjust to your contract
CALLDATA="$UA2_CLASS_HASH"

set +e
OUTPUT=$(sncast --rpc-url "$STARKNET_RPC_URL" $AUTH_ARGS invoke \
  --address "$UA2_PROXY_ADDR" \
  --function "$ENTRYPOINT" \
  --calldata "$CALLDATA" 2>&1)
STATUS=$?
set -e

echo "$OUTPUT"

if [[ $STATUS -ne 0 ]]; then
  err "Upgrade call failed (expected if not UUPS-ready)."
  exit $STATUS
fi

log "Upgrade transaction submitted."

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

source ./scripts/helpers.sh

require_cmd sncast
require_env STARKNET_RPC_URL
require_env UA2_CLASS_HASH

OUTPUT_FILE="${UA2_OUTPUT_FILE:-./.ua2-sepolia-addresses.json}"

if [[ -z "${UA2_ACCOUNT_ADDR:-}" ]]; then
  if [[ -f "$OUTPUT_FILE" ]]; then
    UA2_ACCOUNT_ADDR=$(sed -n 's/.*"UA2_ACCOUNT_ADDR": *"\([^"]*\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)
  fi
fi

require_env UA2_ACCOUNT_ADDR

AUTH_ARGS="$(sncast_auth_args)"

log "Upgrading UA2Account at $UA2_ACCOUNT_ADDR to class hash $UA2_CLASS_HASH…"
log "Reminder: signer must be the UA2 account owner so the contract can call itself."

set +e
OUTPUT=$(sncast --rpc-url "$STARKNET_RPC_URL" $AUTH_ARGS invoke \
  --address "$UA2_ACCOUNT_ADDR" \
  --function upgrade \
  --calldata "$UA2_CLASS_HASH" 2>&1)
STATUS=$?
set -e

echo "$OUTPUT"

if [[ $STATUS -ne 0 ]]; then
  err "Upgrade transaction failed."
  exit $STATUS
fi

log "Upgrade transaction submitted."

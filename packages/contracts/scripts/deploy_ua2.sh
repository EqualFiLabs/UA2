#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

source ./scripts/helpers.sh

require_cmd sncast
require_env STARKNET_RPC_URL
require_env UA2_OWNER_PUBKEY

OUTPUT_FILE="${UA2_OUTPUT_FILE:-./.ua2-sepolia-addresses.json}"

log "Deploying UA2Account (native upgradeable) to Starknet Sepolia…"
log "RPC: $STARKNET_RPC_URL"
log "OWNER_PUBKEY: $UA2_OWNER_PUBKEY"

AUTH_ARGS="$(sncast_auth_args)"

# Ensure the class hash is declared (read from cache or declare now).
if [[ -z "${UA2_CLASS_HASH:-}" ]]; then
  if [[ -f "$OUTPUT_FILE" ]]; then
    UA2_CLASS_HASH=$(sed -n 's/.*"UA2_CLASS_HASH": *"\([^"]*\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)
  fi
fi

if [[ -z "${UA2_CLASS_HASH:-}" ]]; then
  log "UA2_CLASS_HASH not found. Declaring UA2Account…"
  ./scripts/declare_ua2.sh
  UA2_CLASS_HASH=$(sed -n 's/.*"UA2_CLASS_HASH": *"\([^"]*\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)
  [[ -n "${UA2_CLASS_HASH:-}" ]] || { err "Could not resolve UA2_CLASS_HASH after declare."; exit 1; }
fi

CALldata="$UA2_OWNER_PUBKEY"

set +e
OUTPUT=$(sncast --rpc-url "$STARKNET_RPC_URL" $AUTH_ARGS deploy \
  --class-hash "$UA2_CLASS_HASH" \
  --constructor-calldata "$CALldata" 2>&1)
STATUS=$?
set -e

echo "$OUTPUT"

if [[ $STATUS -ne 0 ]]; then
  err "sncast deploy failed."
  exit $STATUS
fi

ACCOUNT_ADDR=$(echo "$OUTPUT" | sed -n 's/.*contract_address: \([0-9xa-fA-F]\+\).*/\1/p' | tail -n1)
if [[ -z "${ACCOUNT_ADDR:-}" ]]; then
  warn "Could not parse contract_address from output. Please copy from above."
else
  write_json_kv "$OUTPUT_FILE" "UA2_ACCOUNT_ADDR" "$ACCOUNT_ADDR"
  log "Wrote UA2_ACCOUNT_ADDR=$ACCOUNT_ADDR to $OUTPUT_FILE"
fi

log "Done."

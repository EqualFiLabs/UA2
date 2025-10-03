#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

source ./scripts/helpers.sh

require_cmd sncast
require_env STARKNET_RPC_URL
require_env UA2_OWNER_PUBKEY

OUTPUT_FILE="${UA2_OUTPUT_FILE:-./.ua2-sepolia-addresses.json}"

log "Deploying UA2Account to Starknet Sepolia…"
log "RPC: $STARKNET_RPC_URL"
log "OWNER_PUBKEY: $UA2_OWNER_PUBKEY"
log "USE_PROXY: ${UA2_USE_PROXY:-0}"

AUTH_ARGS="$(sncast_auth_args)"

if [[ "${UA2_USE_PROXY:-0}" == "1" ]]; then
  warn "Proxy path enabled, but requires UA2Account to be UUPS-ready and an OZ proxy class available."
  warn "Falling back to direct deploy unless you’ve implemented UUPS and updated this script."
fi

# Direct deployment (default, safe)
# Ensure class declared first. If not, we can inline-declare.
if [[ -z "${UA2_CLASS_HASH:-}" ]]; then
  # Try to read from output file
  if [[ -f "$OUTPUT_FILE" ]]; then
    UA2_CLASS_HASH=$(sed -n 's/.*"UA2_CLASS_HASH": *"\([^"]*\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)
  fi
fi

if [[ -z "${UA2_CLASS_HASH:-}" ]]; then
  log "No UA2_CLASS_HASH found. Declaring now…"
  ./scripts/declare_ua2.sh
  UA2_CLASS_HASH=$(sed -n 's/.*"UA2_CLASS_HASH": *"\([^"]*\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)
  [[ -n "${UA2_CLASS_HASH:-}" ]] || { err "Could not resolve UA2_CLASS_HASH after declare."; exit 1; }
fi

# Encode constructor calldata (felt252 owner_pubkey)
# sncast deploy expects flat felts array
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

# Parse contract address
PROXY_ADDR=$(echo "$OUTPUT" | sed -n 's/.*contract_address: \([0-9xa-fA-F]\+\).*/\1/p' | tail -n1)
if [[ -z "${PROXY_ADDR:-}" ]]; then
  warn "Could not parse contract_address from output. Please copy from above."
else
  write_json_kv "$OUTPUT_FILE" "UA2_PROXY_ADDR" "$PROXY_ADDR"
  log "Wrote UA2_PROXY_ADDR=$PROXY_ADDR to $OUTPUT_FILE"
fi

# For direct deploy, "implementation" is same as deployed contract
if [[ -n "${PROXY_ADDR:-}" ]]; then
  write_json_kv "$OUTPUT_FILE" "UA2_IMPLEMENTATION_ADDR" "$PROXY_ADDR"
fi

log "Done."

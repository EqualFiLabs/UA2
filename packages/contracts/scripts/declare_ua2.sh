#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

source ./scripts/helpers.sh

require_cmd sncast
require_env STARKNET_RPC_URL

log "Declaring UA2Account on Starknet Sepolia…"
log "RPC: $STARKNET_RPC_URL"

SIERRA_PATH="$(resolve_sierra_path)"

AUTH_ARGS="$(sncast_auth_args)"

# sncast declare
set +e
OUTPUT=$(sncast --rpc-url "$STARKNET_RPC_URL" $AUTH_ARGS declare \
  --contract "$SIERRA_PATH" 2>&1)
STATUS=$?
set -e

echo "$OUTPUT"

if [[ $STATUS -ne 0 ]]; then
  err "sncast declare failed."
  exit $STATUS
fi

# Try to extract class_hash from output
CLASS_HASH=$(echo "$OUTPUT" | sed -n 's/.*class_hash: \([0-9xa-fA-F]\+\).*/\1/p' | tail -n1)

if [[ -z "${CLASS_HASH:-}" ]]; then
  warn "Could not parse class_hash from output. Please copy from above."
else
  log "Parsed class_hash: $CLASS_HASH"
fi

# Persist to output file if provided
OUTPUT_FILE="${UA2_OUTPUT_FILE:-./.ua2-sepolia-addresses.json}"
if [[ -n "${CLASS_HASH:-}" ]]; then
  write_json_kv "$OUTPUT_FILE" "UA2_CLASS_HASH" "$CLASS_HASH"
  log "Wrote UA2_CLASS_HASH to $OUTPUT_FILE"
fi

log "Done."

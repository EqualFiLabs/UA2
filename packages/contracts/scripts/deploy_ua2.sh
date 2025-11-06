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
  # Deploy UA2 via proxy. First ensure the UA2 implementation class hash exists.
  log "UA2_USE_PROXY=1: deploying UA2 through proxy"
  if [[ -z "${UA2_CLASS_HASH:-}" ]]; then
    # Attempt to load class hash from output file or declare it
    if [[ -f "$OUTPUT_FILE" ]]; then
      UA2_CLASS_HASH=$(sed -n 's/.*"UA2_CLASS_HASH": *"\([0-9xa-fA-F]\+\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)
    fi
    if [[ -z "${UA2_CLASS_HASH:-}" ]]; then
      log "UA2_CLASS_HASH not found, declaring UA2Account class…"
      ./scripts/declare_ua2.sh
      UA2_CLASS_HASH=$(sed -n 's/.*"UA2_CLASS_HASH": *"\([0-9xa-fA-F]\+\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)
    fi
  fi

  # Resolve or declare proxy class hash
  if [[ -z "${UA2_PROXY_CLASS_HASH:-}" ]]; then
    if [[ -f "$OUTPUT_FILE" ]]; then
      UA2_PROXY_CLASS_HASH=$(sed -n 's/.*"UA2_PROXY_CLASS_HASH": *"\([0-9xa-fA-F]\+\)".*/\1/p' "$OUTPUT_FILE" | tail -n1 || true)
    fi
  fi
  if [[ -z "${UA2_PROXY_CLASS_HASH:-}" ]]; then
    log "Declaring UA2Proxy class…"
    SIERRA_PROXY_PATH="target/dev/ua2proxy.sierra"
    if [[ ! -f "$SIERRA_PROXY_PATH" ]]; then
      err "Proxy SIERRA not found at $SIERRA_PROXY_PATH. Please run 'scarb build' first."
      exit 1
    fi
    OUTPUT_DECLARE=$(sncast --rpc-url "$STARKNET_RPC_URL" $AUTH_ARGS declare \
      --contract "$SIERRA_PROXY_PATH")
    echo "$OUTPUT_DECLARE"
    UA2_PROXY_CLASS_HASH=$(echo "$OUTPUT_DECLARE" | sed -n 's/.*class_hash: \([0-9xa-fA-F]\+\).*/\1/p' | tail -n1)
    if [[ -z "${UA2_PROXY_CLASS_HASH:-}" ]]; then
      err "Failed to parse UA2_PROXY_CLASS_HASH from declare output."
      exit 1
    fi
    write_json_kv "$OUTPUT_FILE" "UA2_PROXY_CLASS_HASH" "$UA2_PROXY_CLASS_HASH"
    log "Wrote UA2_PROXY_CLASS_HASH=$UA2_PROXY_CLASS_HASH to $OUTPUT_FILE"
  fi

  # Deploy proxy instance. The constructor expects [implementation_class_hash, admin_pubkey].
  log "Deploying UA2Proxy instance with implementation $UA2_CLASS_HASH and admin $UA2_OWNER_PUBKEY…"
  CALldata="$UA2_CLASS_HASH $UA2_OWNER_PUBKEY"
  set +e
  OUTPUT_DEPLOY=$(sncast --rpc-url "$STARKNET_RPC_URL" $AUTH_ARGS deploy \
    --class-hash "$UA2_PROXY_CLASS_HASH" \
    --constructor-calldata "$CALldata" 2>&1)
  STATUS_DEPLOY=$?
  set -e
  echo "$OUTPUT_DEPLOY"
  if [[ $STATUS_DEPLOY -ne 0 ]]; then
    err "sncast deploy (proxy) failed."
    exit $STATUS_DEPLOY
  fi
  PROXY_ADDR=$(echo "$OUTPUT_DEPLOY" | sed -n 's/.*contract_address: \([0-9xa-fA-F]\+\).*/\1/p' | tail -n1)
  if [[ -z "${PROXY_ADDR:-}" ]]; then
    warn "Could not parse proxy contract_address from output. Please copy from above."
  else
    write_json_kv "$OUTPUT_FILE" "UA2_PROXY_ADDR" "$PROXY_ADDR"
    log "Wrote UA2_PROXY_ADDR=$PROXY_ADDR to $OUTPUT_FILE"
    # Set implementation address equal to proxy for front-end calls
    write_json_kv "$OUTPUT_FILE" "UA2_IMPLEMENTATION_ADDR" "$PROXY_ADDR"
  fi
  log "Proxy deployment complete."
  exit 0
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

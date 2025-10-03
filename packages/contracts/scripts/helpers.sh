#!/usr/bin/env bash
set -euo pipefail

# Pretty logging
log() { printf "\033[1;34m[ua2]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[ua2:warn]\033[0m %s\n" "$*"; }
err() { printf "\033[1;31m[ua2:err]\033[0m %s\n" "$*" >&2; }

require_cmd() {
  local c="$1"
  command -v "$c" >/dev/null 2>&1 || { err "Missing required command: $c"; exit 1; }
}

require_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || { err "Missing required env var: $name"; exit 1; }
}

write_json_kv() {
  # args: file key value
  local file="$1" key="$2" value="$3"
  if [[ ! -f "$file" ]]; then
    printf '{\n}\n' > "$file"
  fi
  # update JSON using jq if available, else sed fallback
  if command -v jq >/dev/null 2>&1; then
    tmp="$(mktemp)"
    jq --arg k "$key" --arg v "$value" '.[$k]=$v' "$file" > "$tmp" && mv "$tmp" "$file"
  else
    # very minimal naive updater (no spaces in key/value assumed)
    # not robust, but avoids adding dependencies
    if grep -q "\"$key\"" "$file"; then
      sed -i.bak "s/\"$key\" *: *\"[^\"]*\"/\"$key\": \"$value\"/" "$file"
    else
      sed -i.bak "s/}/  \"$key\": \"$value\"\n}/" "$file"
    fi
  fi
}

init_sncast_profile_inline() {
  # Allow scripts to run without user global profiles by passing flags directly.
  : # no-op; we will pass --rpc-url and auth flags per-command
}

sncast_auth_args() {
  # Emit auth flags for sncast:
  # priority: keystore -> private key
  if [[ -n "${SNCAST_KEYSTORE_PATH:-}" && -f "${SNCAST_KEYSTORE_PATH:-}" ]]; then
    printf -- "--keystore %s " "$SNCAST_KEYSTORE_PATH"
    if [[ -n "${SNCAST_ACCOUNT:-}" ]]; then
      printf -- "--account %s " "$SNCAST_ACCOUNT"
    fi
  elif [[ -n "${SNCAST_PRIVATE_KEY:-}" ]]; then
    printf -- "--private-key %s " "$SNCAST_PRIVATE_KEY"
  else
    err "No sncast auth found. Set SNCAST_KEYSTORE_PATH or SNCAST_PRIVATE_KEY."
    exit 1
  fi
}

resolve_sierra_path() {
  # returns the UA2Account.sierra.json path
  local path="target/dev/UA2Account.sierra.json"
  [[ -f "$path" ]] || { err "Missing $path. Run: scarb build"; exit 1; }
  printf "%s" "$path"
}

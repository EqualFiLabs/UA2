#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────
# Pretty output + helpers
# ──────────────────────────────
CYN(){ printf "\033[36m%s\033[0m\n" "$*"; }
GRN(){ printf "\033[32m%s\033[0m\n" "$*"; }
YEL(){ printf "\033[33m%s\033[0m\n" "$*"; }
RED(){ printf "\033[31m%s\033[0m\n" "$*"; }
DIM(){ printf "\033[90m%s\033[0m\n" "$*"; }
HR(){  printf "\n\033[90m%s\033[0m\n\n" "────────────────────────────────────────────────────────────────"; }
PAUSE(){
  if [ -t 0 ]; then
    printf '\n\033[90m%s\033[0m ' "press Enter to continue…"
    read -r || true
  else
    printf '\n\033[90m%s\033[0m\n' "(stdin is not a TTY; auto-continue in 2s…)"
    sleep 2
  fi
}

NEED(){ command -v "$1" >/dev/null 2>&1 || { RED "Missing required command: $1"; exit 1; }; }

RUN(){
  local label="$1"; shift
  local expect_fail=""
  if [[ "${1:-}" == "EXPECT_FAIL" ]]; then
    expect_fail="EXPECT_FAIL"
    shift
  fi
  local cmd="$*"

  CYN "[RUN] $label"
  DIM "$cmd"
  PAUSE
  # shellcheck disable=SC2091
  set +e
  local output
  output="$(bash -lc "$cmd" 2>&1)"
  local cmd_status=$?
  set -e
  printf '%s\n' "$output" | tee -a "$LOGFILE"
  if [[ "$output" == *"already exists"* || "$output" == *"already deployed"* ]]; then
    cmd_status=0
  elif [[ $cmd_status -eq 0 && "$output" == *"Error:"* ]]; then
    cmd_status=1
  fi
  if [[ "$expect_fail" == "EXPECT_FAIL" ]]; then
    if [[ $cmd_status -eq 0 ]]; then
      RED "Expected this to fail (revert), but it succeeded."
      exit 1
    fi
    GRN "Revert observed as expected."
  else
    if [[ $cmd_status -ne 0 ]]; then
      RED "Command failed (exit $cmd_status)."
      exit $cmd_status
    fi
  fi
  HR
}

# ──────────────────────────────
# Tooling + defaults
# ──────────────────────────────
NEED sncast
NEED curl
NEED jq
NEED node
NEED date

LOGFILE="${LOGFILE:-ua2_e2e_demo.log}"
: > "$LOGFILE"  # truncate

RPC_DEFAULT="http://127.0.0.1:5050"
RPC="${RPC:-$RPC_DEFAULT}"
UA2_NAME="${UA2_NAME:-ua2}"

# MUST be provided (or you’ll be prompted):
UA2_CLASS_HASH="${UA2_CLASS_HASH:-}"                     # 0x… Sierra class hash
UA2_DEVNET_OWNER_PRIVATE_KEY="${UA2_DEVNET_OWNER_PRIVATE_KEY:-}"  # 0x… 32B hex
TARGET_ADDRESS="${TARGET_ADDRESS:-}"                     # 0x… contract to allow (e.g. FRI)

clear
CYN "UA² — interactive E2E demo (sncast + curl)"
HR
YEL "Steps:"
echo "  1) sncast account create (custom class)"
echo "  2) show predicted address"
echo "  3) devnet_mint (fund fee token)"
echo "  4) sncast account deploy"
echo "  5) call get_owner()"
echo "  6) add_session_with_allowlists (tight policy)"
echo "  7) apply_session_usage (success)"
echo "  8) apply_session_usage (expected revert)"
HR

# Prompt for any missing required inputs (good for live demo)
[[ -z "$UA2_CLASS_HASH" ]] && read -r -p "UA2_CLASS_HASH (0x…): " UA2_CLASS_HASH
if [[ -z "$UA2_DEVNET_OWNER_PRIVATE_KEY" ]]; then
  read -r -s -p "UA2_DEVNET_OWNER_PRIVATE_KEY (0x…): " UA2_DEVNET_OWNER_PRIVATE_KEY; echo
fi
[[ -z "$TARGET_ADDRESS" ]] && read -r -p "ALLOWED TARGET contract (0x…): " TARGET_ADDRESS
read -r -p "RPC URL [$RPC_DEFAULT]: " _in || true; RPC="${_in:-$RPC}"

GRN "Config:"
echo "  RPC              : $RPC"
echo "  UA2_NAME         : $UA2_NAME"
echo "  UA2_CLASS_HASH   : $UA2_CLASS_HASH"
echo "  TARGET_ADDRESS   : $TARGET_ADDRESS"
echo "  LOGFILE          : $LOGFILE"
HR
PAUSE

# ──────────────────────────────
# Derived values (show them!)
# ──────────────────────────────
TRANSFER_SELECTOR="$(node --input-type=module -e 'import {hash} from "starknet"; console.log(hash.getSelectorFromName("transfer"))')"
NOW="$(date +%s)"
VALID_AFTER=$((NOW-30))
VALID_UNTIL=$((NOW+2*60*60))
SESSION_PUBKEY="$(PKEY="$UA2_DEVNET_OWNER_PRIVATE_KEY" node --input-type=module -e '
  import {ec} from "starknet";
  const p=(process.env.PKEY||"").replace(/^0x/,"");
  if(!p){process.exit(1)}; console.log(ec.starkCurve.getStarkKey(p));
')"
SESSION_KEY_HASH="$(K="$SESSION_PUBKEY" node --input-type=module -e '
  import {hash} from "starknet";
  const k=(process.env.K||"").toLowerCase();
  console.log(hash.computePedersenHash(k,"0x0"));
')"

VAL_LOW=0
VAL_HIGH=0
MAX_CALLS=1

YEL "Derived:"
echo "  TRANSFER_SELECTOR : $TRANSFER_SELECTOR"
echo "  VALID_AFTER       : $VALID_AFTER"
echo "  VALID_UNTIL       : $VALID_UNTIL"
echo "  SESSION_PUBKEY    : $SESSION_PUBKEY"
echo "  SESSION_KEY_HASH  : $SESSION_KEY_HASH"
echo "  VALUE_CAP (u256)  : low=$VAL_LOW high=$VAL_HIGH"
HR
PAUSE

TARGET_ALLOWLISTS=("$TARGET_ADDRESS")
SELECTOR_ALLOWLISTS=("$TRANSFER_SELECTOR")
TARGETS_LEN=${#TARGET_ALLOWLISTS[@]}
SELECTORS_LEN=${#SELECTOR_ALLOWLISTS[@]}

# ──────────────────────────────
# 1) Create account (local)
# ──────────────────────────────
RUN "sncast account create (custom class)" \
  "sncast account create --url '$RPC' \
    --name '$UA2_NAME' \
    --class-hash '$UA2_CLASS_HASH' \
    --type oz \
    --salt 0x1 \
    --add-profile '$UA2_NAME'"

# ──────────────────────────────
# 2) Show predicted address
# ──────────────────────────────
ACCOUNTS_FILE="$(awk -v section="sncast.$UA2_NAME" '
  $0 == "["section"]" {in_section=1; next}
  /^\[/ && in_section {in_section=0}
  in_section && $1 == "accounts-file" {gsub(/"/, "", $3); print $3; exit}
' snfoundry.toml)"
ACCOUNTS_FILE="${ACCOUNTS_FILE:-$HOME/.starknet_accounts/starknet_open_zeppelin_accounts.json}"

RUN "sncast account list (log accounts)" \
  "sncast account list"

if [[ ! -f "$ACCOUNTS_FILE" ]]; then
  RED "Accounts file not found: $ACCOUNTS_FILE"
  exit 1
fi

UA2_ADDR="$(jq -r --arg name "$UA2_NAME" '.[].[$name]?.address // empty' "$ACCOUNTS_FILE" | head -n1)"
if [[ -z "$UA2_ADDR" ]]; then
  RED "Could not find address for account '$UA2_NAME' in $ACCOUNTS_FILE."
  exit 1
fi
printf '%s\n' "$UA2_ADDR" > .ua2_addr
DIM "Accounts file: $ACCOUNTS_FILE"
GRN "UA² predicted address: $UA2_ADDR"
HR
PAUSE

# ──────────────────────────────
# 3) Mint funds (fee token)
# ──────────────────────────────
read -r -p "Amount in FRI (fee token) to mint [2000000000000000000]: " MINT_AMOUNT || true
MINT_AMOUNT="${MINT_AMOUNT:-2000000000000000000}"
read -r -p "Mint unit [FRI]: " MINT_UNIT || true
MINT_UNIT="${MINT_UNIT:-FRI}"

RUN "curl devnet_mint (fund predicted address)" \
  "curl -s '$RPC' -H 'content-type: application/json' -d '{
    \"jsonrpc\":\"2.0\",\"id\":1,
    \"method\":\"devnet_mint\",
    \"params\": {\"address\":\"$UA2_ADDR\",\"amount\":$MINT_AMOUNT,\"unit\":\"$MINT_UNIT\"}
  }' | jq ."

# ──────────────────────────────
# 4) Deploy account
# ──────────────────────────────
RUN "sncast account deploy --tip 1" \
  "sncast account deploy --url '$RPC' --name '$UA2_NAME' --tip 1"

# ──────────────────────────────
# 5) get_owner() sanity
# ──────────────────────────────
RUN "sncast call get_owner()" \
  "sncast call --url '$RPC' --contract-address '$UA2_ADDR' --function get_owner"

# ──────────────────────────────
# 6) add_session_with_allowlists
# ──────────────────────────────
SESSION_ADD_CALLDATA=(
  "$SESSION_PUBKEY"
  "$VALID_AFTER"
  "$VALID_UNTIL"
  "$MAX_CALLS"
  "$VAL_LOW" "$VAL_HIGH"
  "$TARGETS_LEN"
  "$TARGETS_LEN"
)
SESSION_ADD_CALLDATA+=("${TARGET_ALLOWLISTS[@]}")
SESSION_ADD_CALLDATA+=(
  "$SELECTORS_LEN"
  "$SELECTORS_LEN"
)
SESSION_ADD_CALLDATA+=("${SELECTOR_ALLOWLISTS[@]}")
SESSION_ADD_CALLDATA_STR="${SESSION_ADD_CALLDATA[*]}"

RUN "add_session_with_allowlists (1 call; target+selector; cap=0)" \
  "sncast --profile '$UA2_NAME' invoke --url '$RPC' \
    --contract-address '$UA2_ADDR' \
    --function add_session_with_allowlists \
    --calldata $SESSION_ADD_CALLDATA_STR"

# ──────────────────────────────
# 7) apply_session_usage — success
# ──────────────────────────────
RUN "apply_session_usage (first call; expect SUCCESS)" \
  "sncast --profile '$UA2_NAME' invoke --url '$RPC' \
    --contract-address '$UA2_ADDR' \
    --function apply_session_usage \
    --calldata '$SESSION_KEY_HASH' 0 1 0"

# ──────────────────────────────
# 8) apply_session_usage — expected revert
# ──────────────────────────────
RUN "apply_session_usage again (expect REVERT due to call cap)" EXPECT_FAIL \
  "sncast --profile '$UA2_NAME' invoke --url '$RPC' \
    --contract-address '$UA2_ADDR' \
    --function apply_session_usage \
    --calldata '$SESSION_KEY_HASH' 1 1 1"

GRN "Demo complete. Log saved to: $LOGFILE"

# UA²-SDK • Sepolia Runbook
Status: Draft (Resolve Hackathon)
Target: Starknet Sepolia (testnet)
Goal: From clean machine → live demo in ~20–40 minutes

---

## 0) Prereqs

- OS: Linux/macOS/WSL (Windows ok with WSL2)
- Tooling:
  - Node.js 20.x + npm 10+: `node -v && npm -v`
  - Rust toolchain (for Starknet Foundry): `rustup -V`
  - Scarb (Cairo package manager): `scarb --version`
  - Starknet Foundry (snforge/sncast): `snforge --version && sncast --version`
- Wallet: **Argent X** (recommended) or **Braavos** with network set to **Starknet Sepolia**
- Test ETH: Fund the wallet on **Starknet Sepolia** via a faucet, then switch your wallet to Sepolia

> Tip: If Scarb/Forged aren’t installed, follow their official instructions. Versions tested:
> - Scarb ≥ 2.6.x
> - Starknet Foundry ≥ 0.22.x
> - starknet.js ≥ 6.x

---

## 1) Clone & bootstrap

```bash
git clone https://github.com/your-org/ua2-sdk.git
cd ua2-sdk

# Install JS deps for all packages
npm ci

# Bootstrap workspaces (if repo uses npm workspaces)
npm run bootstrap || true
```

> Expected: `node_modules/` populated in root and in `packages/*`.

---

## 2) Environment files

Copy the provided templates and then adjust the values:

```bash
cp .env.example .env
cp .env.sepolia.example .env.sepolia
```

Populate them as follows:

**`./.env`** (local devnet defaults)

```env
# Shared
NODE_ENV=development

# Starknet endpoints (devnet/local)
STARKNET_RPC_URL=http://127.0.0.1:5050
STARKNET_NETWORK=devnet

# UA² contracts (fill after local deploys)
UA2_CLASS_HASH=
UA2_IMPLEMENTATION_ADDR=
UA2_PROXY_ADDR=

# Demo app
NEXT_PUBLIC_NETWORK=devnet
NEXT_PUBLIC_UA2_PROXY_ADDR=
```

**`./.env.sepolia`** (testnet)

```env
# Shared
NODE_ENV=development

# Sepolia RPC (Infura/Alchemy/Blast/etc.)
STARKNET_RPC_URL=https://starknet-sepolia.infura.io/v3/REPLACE_WITH_KEY
STARKNET_NETWORK=sepolia

# UA² contracts (populated after deploy)
UA2_CLASS_HASH=
UA2_IMPLEMENTATION_ADDR=
UA2_PROXY_ADDR=

# Demo app
NEXT_PUBLIC_NETWORK=sepolia
NEXT_PUBLIC_UA2_PROXY_ADDR=
```

> Fill RPC with your provider key. Leave the contract fields empty for now; update them after deployment.

---

## 3) Cairo contracts: build & test locally

```bash
# Build contracts
cd packages/contracts
scarb build

# Run unit tests (Cairo)
snforge test -vv
```

Expected tail:

```
Collected 24 tests
PASSED 24 tests
All tests passed.
```

Return to repo root:

```bash
cd ../../
```

---

## 4) Local devnet with `sncast` (Docker)

If you want to smoke-test on a local devnet before heading to Sepolia, run the same
flow we use in CI. The commands below were copy/pasted against
`shardlabs/starknet-devnet-rs:latest` and `sncast 0.33.x`.

```bash
# In a separate terminal
docker run -it --rm -p 127.0.0.1:5050:5050 \
  shardlabs/starknet-devnet-rs:latest \
  --seed 0 --accounts 10
```

Back in the repo root:

```bash
RPC=http://127.0.0.1:5050
NAME=devnet

# 1. Create a named account (writes to ~/.starknet_accounts/devnet)
sncast account create --name "$NAME" --url "$RPC"

# 2. Fund it with FRI (STRK) for fees – copy the address from the previous output
ADDR=0xPASTE_ADDRESS_FROM_OUTPUT
curl -s "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"devnet_mint","params":{"address":"'"$ADDR"'","amount":100000000000000000000,"unit":"FRI"}}'

# (Optional) give it some ETH (WEI) so you can test paymasters that refund in ETH
curl -s "$RPC" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"devnet_mint","params":{"address":"'"$ADDR"'","amount":100000000000000000000,"unit":"WEI"}}'

# 3. Deploy the account (accept the default-account prompt)
sncast account deploy --name "$NAME" --url "$RPC"

# 4. Make sure scarb is discoverable (sncast shells out to it)
scarb manifest-path

# 5. Declare the UA² class (bump --max-fee if sncast suggests a higher estimate)
#    NOTE: `--contract-name UA2Account` is required so sncast locates the compiled class.
sncast --account "$NAME" \
  declare \
  --contract-name UA2Account \
  --url "$RPC" \
  --max-fee 9638049920000000000

# capture the class hash from the output
UA2_CLASS_HASH=0xYOUR_CLASS_HASH

# 6. Deploy the declared class (any felt pubkey works for local testing)
OWNER_PUBKEY=0x4173f320ca395828b2630fdb693cfb761047fc3822a66c40f9156c4bc8d7836
sncast --account "$NAME" \
  deploy \
  --class-hash "$UA2_CLASS_HASH" \
  --constructor-calldata "$OWNER_PUBKEY" \
  --url "$RPC" \
  --max-fee 9638049920000000000

# capture the proxy address for the next step
UA2_ADDR=0xPASTE_DEPLOYED_ADDRESS

# 7. Smoke test – zero-arg view, so no --calldata flag required
#    Passing `--calldata ""` will fail; omit the flag entirely for zero-arg reads.
sncast --account "$NAME" \
  call \
  --contract-address "$UA2_ADDR" \
  --function get_owner \
  --url "$RPC"
```

Every command above should succeed when pasted into a fresh shell. If a declare or
deploy fails with "fee too low", rerun it with the quoted `--max-fee` adjusted to the
estimate reported by `sncast`. Fees are denominated in **FRI (STRK)** on devnet.

With the contract running locally you can point the demo app to the devnet values or
run the TypeScript integration tests:

```bash
npm run e2e:devnet
```

Expected:

```
E2E (devnet): sessions create/use/revoke ✓
E2E (devnet): policy selector/target caps ✓
E2E (devnet): recovery propose/execute ✓
```

---

## 5) Configure `sncast` for Sepolia

Create (or update) `~/.starknet_foundry/aliases.toml` and `~/.starknet_foundry/profiles.toml`:

**`~/.starknet_foundry/profiles.toml`**

```toml
[sepolia]
rpc_url = "${STARKNET_RPC_URL}"
account = "default"
keystore = "~/.starknet_accounts/sepolia/keystore.json"
```

**`~/.starknet_foundry/aliases.toml`**

```toml
[sepolia]
ua2_account = "${UA2_PROXY_ADDR}"
```

> You can also use `sncast --profile sepolia ...` with `--ledger` or `--keystore` flags if you prefer. The important part is pointing to a funded **Sepolia** account.

---

## 6) Declare & deploy on Sepolia

You can still use `./scripts/deploy_ua2.sh`, but when debugging or verifying
interactively we recommend mirroring the devnet flow with `sncast` so the same
commands work everywhere. Replace `<...>` placeholders before running.

```bash
cd packages/contracts

RPC=https://starknet-sepolia.infura.io/v3/<YOUR_KEY>
NAME=sepolia

# 1. Create or reuse a named account backed by your keystore/ledger
sncast account create --name "$NAME" --url "$RPC"
sncast account deploy --name "$NAME" --url "$RPC"

# 2. Declare the class (fees are in FRI/STRK; raise --max-fee if needed)
#    `--contract-name UA2Account` must match the Scarb target.
sncast --account "$NAME" \
  declare \
  --contract-name UA2Account \
  --url "$RPC" \
  --max-fee 9638049920000000000

UA2_CLASS_HASH=0xCLASS_HASH_FROM_OUTPUT

# 3. Deploy the class to get a live proxy
OWNER_PUBKEY=0xYOUR_OWNER_FELT
sncast --account "$NAME" \
  deploy \
  --class-hash "$UA2_CLASS_HASH" \
  --constructor-calldata "$OWNER_PUBKEY" \
  --url "$RPC" \
  --max-fee 9638049920000000000

UA2_PROXY_ADDR=0xDEPLOYED_ADDRESS

# 4. Verify with a read-only call (no calldata flag for zero-arg functions)
#    Leave `--calldata` off entirely when the selector takes no arguments.
sncast --account "$NAME" \
  call \
  --contract-address "$UA2_PROXY_ADDR" \
  --function get_owner \
  --url "$RPC"
```

Copy the resulting `UA2_CLASS_HASH`, implementation address (from the deploy receipt),
and `UA2_PROXY_ADDR` into `.env.sepolia` so the SDK and demo app target the right
contracts. If `sncast` reports an estimated fee above the provided max, re-run the
command with the suggested value.

When you prefer automation, `./scripts/deploy_ua2.sh` is still available and writes the
same values into `packages/contracts/.ua2-sepolia-addresses.json`.

> [!NOTE]
> If you open a new shell before the smoke tests below, re-export `RPC` and `NAME`
> so `sncast` can find the correct endpoint and account.

---

## 7) Smoke-test calls on Sepolia (sncast)

```bash
# Read owner
sncast --account sepolia \
  call \
  --contract-address "$UA2_PROXY_ADDR" \
  --function get_owner \
  --url "$RPC"
```

Expected:

```
result: [0x<OWNER_PUBKEY_FELT>]
```

Add a dummy session key (owner-signed tx):

```bash
# Example: add session with 8h expiry, 50 max calls, single target, two selectors
sncast --account sepolia \
  invoke \
  --contract-address "$UA2_PROXY_ADDR" \
  --function add_session_with_allowlists \
  --calldata \
    <SESSION_PUBKEY_FELT> \
    1 \
    28800 \
    50 \
    0 \
    0 0 \
    1 \
    <TARGET_CONTRACT_ADDR> \
    2 \
    <ALLOWED_SELECTOR_1> \
    <ALLOWED_SELECTOR_2> \
  --url "$RPC" \
  --max-fee 9638049920000000000
```

The calldata order is: session key, `valid_after`, `valid_until`, `max_calls`, `max_value_per_call.low`,
`max_value_per_call.high`, number of allowed targets, each target address, number of allowed selectors, each selector felt.
If the contract checks revert, verify you supplied proper calldata as per `docs/interfaces.md`.

---

## 8) Paymaster wiring (AVNU on Sepolia)

AVNU exposes a Starknet paymaster RPC that supports sponsored (gasless) and token-fee modes.

1. Copy the template and export it:

   ```bash
   cp .env.sepolia.example .env.sepolia
   export $(grep -v '^#' .env.sepolia | xargs)
   ```

2. Fill in `STARKNET_RPC_URL`, `UA2_ADDR`, and the paymaster fields:

   ```env
   PAYMASTER_URL=https://sepolia.paymaster.avnu.fi
   PAYMASTER_API_KEY=<optional>
   PM_MODE=sponsored   # or default
   GAS_TOKEN=0x<ERC20> # required when PM_MODE=default
   ```

3. Run the Sepolia script:

   ```bash
   npm run e2e:sepolia
   ```

Expected output highlights:

```
[paymaster] AVNU available at https://sepolia.paymaster.avnu.fi using mode=sponsored
[paymaster] Sponsored tx sent: 0x<hash> (in-policy session call)
UA² sepolia e2e PASS ✅
```

If AVNU is temporarily unavailable, override `PAYMASTER_URL` with an invalid value to confirm the fallback path:

```
[paymaster] AVNU unavailable, falling back to Noop (fees paid by user)
[paymaster] executing in-policy session call without sponsorship (Noop fallback)
```

---

## 9) Demo App (React) on Sepolia

```bash
# Back to root
cd ../../

# Use Sepolia env
export $(grep -v '^#' ./.env.sepolia | xargs)

# Start demo
npm run dev
```

* Navigate to the local URL (printed by the dev server).
* In the app:

  1. Connect wallet (Argent/Braavos)
  2. Attach the UA² proxy address (reads owner/public state)
  3. Create a session with a narrow policy
  4. Trigger an in-policy call (should pass without owner popup)
  5. Toggle “Use Paymaster” (if configured) and repeat
  6. Revoke session and retry (should revert with `ERR_SESSION_INACTIVE` or another policy error)

---

## 10) Troubleshooting

* **`Class not declared`**: ensure step 6.1 succeeded and your RPC URL points to Sepolia.
* **`Insufficient funds`**: top up your **Sepolia** account with test ETH (L2).
* **`Signature invalid`**: check you’re signing with the same account that owns UA² or with a registered session key.
* **Front-end shows wrong network**: verify wallet is on **Starknet Sepolia** and `NEXT_PUBLIC_NETWORK=sepolia`.
* **Paymaster failures**: ensure adapter config matches provider; app should fallback to non-sponsored path.

---

## 11) Clean up

* Revoke any test sessions you no longer need.
* Optionally `pause` the account (if you enabled pausable) after demos.

---

## 12) What “done” looks like

* You can read/write the UA² account on Sepolia.
* Session creation, use, and revocation work.
* Recovery flow can be staged and executed (if guardians set).
* Demo app performs an in-policy call without wallet popups (session path).
* Optional: a sponsored tx runs via paymaster adapter.

```

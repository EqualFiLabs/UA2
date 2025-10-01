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

Create the following env files:

**`./.env`** (local devnet defaults)

```env
# Shared
NODE_ENV=development

# Starknet endpoints (devnet/local)
STARKNET_RPC_URL=http://127.0.0.1:5050
STARKNET_NETWORK=devnet

# Demo app
NEXT_PUBLIC_NETWORK=devnet
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

## 4) (Optional) Local devnet E2E

If you run a local Starknet devnet:

```bash
# Start a local devnet in another terminal (example; adjust to your stack)
docker run --rm -p 5050:5050 shardlabs/starknet-devnet:latest
```

Then run the JavaScript E2E against devnet:

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

From repo root:

```bash
cd packages/contracts

# 6.1 Declare implementation (class hash)
sncast --profile sepolia declare \
  --contract target/dev/UA2Account.sierra.json

# Output contains `class_hash: 0x...`
# Copy it into UA2_CLASS_HASH in .env.sepolia

# 6.2 Deploy implementation behind an OZ-style proxy (provided script)
sncast --profile sepolia run scripts/deploy_ua2_proxy \
  --calldata <OWNER_PUBKEY_FELT>

# Script prints:
# implementation: 0x...
# proxy:          0x...
```

Paste values into **`.env.sepolia`**:

```
UA2_CLASS_HASH=0x...
UA2_IMPLEMENTATION_ADDR=0x...
UA2_PROXY_ADDR=0x...
NEXT_PUBLIC_UA2_PROXY_ADDR=0x...
```

Commit env (without secrets) or keep local.

---

## 7) Smoke-test calls on Sepolia (sncast)

```bash
# Read owner
sncast --profile sepolia call \
  --address $UA2_PROXY_ADDR \
  --function get_owner \
  --calldata ""
```

Expected:

```
result: [0x<OWNER_PUBKEY_FELT>]
```

Add a dummy session key (owner-signed tx):

```bash
# Example: add session with 8h expiry, 50 max calls, no value
# (selectors/targets are demo values; replace with real addresses/selectors)
sncast --profile sepolia invoke \
  --address $UA2_PROXY_ADDR \
  --function add_session \
  --calldata <SESSION_PUBKEY_FELT> 28800 50 0 0 0
```

> If the contract checks revert, verify you supplied proper calldata as per `docs/interfaces.md`.

---

## 8) Paymaster wiring (optional in hackathon)

If you have a paymaster provider:

```bash
# In JS SDK usage (example):
# UA2.paymasters.from('starknet-react:<provider>') or custom adapter
npm run test:paymaster
```

Expected: Sponsored tx succeeds; negative-path test shows a clear error.

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
  6. Revoke session and retry (should revert with `ERR_SESSION_EXPIRED` or policy error)

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

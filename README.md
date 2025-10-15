# UA²-SDK — Universal Account Abstraction SDK for Starknet

> **Hackathon Project • Resolve Starknet 2025**  
> Build once, run anywhere: session keys • guardians • paymasters for Starknet AA.

---

## ✨ Overview

Starknet is **account-abstraction by default**, but today AA features are fragmented across wallets, blog posts, and vendor SDKs.  

**UA²-SDK** unifies them into a **modular Cairo account + TypeScript SDK**:

- 🔑 **Session Keys** — scoped, expiring, revocable
- 🛡️ **Guardians & Recovery** — m-of-n social recovery with timelock
- ♻️ **Key Rotation** — secure ownership change
- ⛽ **Paymaster Adapters** — plug in any sponsor provider, gasless or alt-token
- 🧩 **Wallet-agnostic** — Argent, Braavos, Cartridge, injected

**Goal:** Make Starknet AA features *usable today* by any dApp, game, or protocol.

---

## 📐 Architecture

- **On-chain**: UA² Account contract (inherits OZ AccountComponent)  
- **Modules**: SessionKeys, Guardians, KeyRotation  
- **Off-chain**: TypeScript SDK (`@ua2/core`, `@ua2/react`, `@ua2/paymasters`)  
- **Demo app**: React front-end + CLI showing end-to-end flows

See [`docs/architecture.md`](./docs/architecture.md) for diagrams and flow details.

---

## 🚀 Quickstart

### 0. Configure env files

```bash
cp .env.example .env
cp .env.sepolia.example .env.sepolia
```

> Update the copied files with your local devnet defaults (`.env`) and Sepolia RPC + UA² addresses (`.env.sepolia`).

### 1. Install deps
```bash
npm ci
```

### 2. Build contracts

```bash
cd packages/contracts
scarb build
```

> [!TIP]
> The repo pins `scarb 2.12.0` via `.tool-versions` and expects it to be provided by
> [mise](https://mise.jdx.dev/). If `scarb` is not on your `PATH`, install the pinned version with
> `mise install scarb@2.12.0` (or ensure `/root/.asdf/shims` is exported when using `asdf`).

### 3. Declare & deploy with `sncast`

Mirror the same workflow locally and on Sepolia so copy/pasting always works. Replace the
placeholders (`<...>`) before running.

```bash
# still inside packages/contracts

# Devnet example (see docs/runbook-sepolia.md for full flow)
RPC=http://127.0.0.1:5050
NAME=devnet

sncast account create --name "$NAME" --url "$RPC"
sncast account deploy --name "$NAME" --url "$RPC"

sncast --account "$NAME" \
  declare \
  --contract-name UA2Account \
  --url "$RPC" \
  --max-fee 9638049920000000000

UA2_CLASS_HASH=0xCLASS_HASH_FROM_OUTPUT

OWNER_PUBKEY=0xYOUR_OWNER_FELT
sncast --account "$NAME" \
  deploy \
  --class-hash "$UA2_CLASS_HASH" \
  --constructor-calldata "$OWNER_PUBKEY" \
  --url "$RPC" \
  --max-fee 9638049920000000000

UA2_PROXY_ADDR=0xDEPLOYED_ADDRESS

sncast --account "$NAME" \
  call \
  --contract-address "$UA2_PROXY_ADDR" \
  --function get_owner \
  --url "$RPC"

# Sepolia mirrors the same steps; just switch RPC/NAME and fund the account with STRK (FRI)
RPC=https://starknet-sepolia.infura.io/v3/<YOUR_KEY>
NAME=sepolia
```

If `sncast` reports "fee too low", rerun the declare/deploy with the suggested higher
`--max-fee` (fees are denominated in **FRI (STRK)**). Copy the resulting class hash,
implementation hash, and proxy address into `.env` / `.env.sepolia` so the SDK and demo app
point at the correct contracts. `./scripts/deploy_ua2.sh` is still available when you want an
automated run.

> [!NOTE]
> On devnet, mint FRI to the printed account address via `devnet_mint`. On Sepolia,
> top up the account with STRK/ETH from your faucet or bridge of choice before
> deploying.

### 4. Run demo app

```bash
export $(grep -v '^#' ./.env.sepolia | xargs)
npm run dev
```

* Connect wallet (Argent X / Braavos)
* Create session → call via session key
* Try gasless call with paymaster
* Revoke session → call fails
* (Optional) Guardian recovery flow

For full walkthrough: [`docs/runbook-sepolia.md`](./docs/runbook-sepolia.md)

---

## 🧪 Testing

* **Cairo unit tests:**

  ```bash
  cd packages/contracts
  snforge test -vv
  ```

  > [!NOTE]
  > The setup script installs `snforge` via the `asdf` `starknet-foundry` plugin.
  > Export the `asdf` shims directory (e.g. `~/.asdf/shims`) to your `PATH`, or call
  > the binary directly from the install root (e.g. `~/.asdf/installs/starknet-foundry/0.48.1/bin/snforge`)
  > if the command is not found.
* **TS/SDK tests:**

  ```bash
  npm run test:unit
  ```
* **E2E on devnet:**

  ```bash
  npm run e2e:devnet
  ```

  > [!TIP]
  > Use the devnet + `sncast` recipe in [`docs/runbook-sepolia.md`](./docs/runbook-sepolia.md) to
  > create/fund the named account and deploy the UA² class before running the suite.
* **E2E on Sepolia:**

  ```bash
  npm run e2e:sepolia
  ```

### Manual CLI demo (`run.sh`)

For reviewers who want to watch the interactive `sncast` + curl flow, we keep the repo-local
`run.sh`. It walks through account creation, funding, deployment, and the session-key happy/
sad-path calls while teeing all output into `ua2_e2e_demo.log`.

1. Prereqs: Starknet devnet running at `http://127.0.0.1:5050`, the UA² class declared, and
   `sncast` ≥ 0.50.0 available on your `PATH` (plus `curl`, `jq`, `node`, `date`).
2. Export the values the script needs:
   ```bash
   export UA2_CLASS_HASH=0x...
   export UA2_DEVNET_OWNER_PRIVATE_KEY=0x...   # 32B hex private key you control on devnet
   export TARGET_ADDRESS=0x...                 # e.g. mock ERC20 you want to permit
   export UA2_NAME=ua2                         # optional; defaults to "ua2"
   export RPC=http://127.0.0.1:5050            # optional; defaults to devnet URL above
   ```
3. If you want a clean slate, delete the prior account/profile first:
   ```bash
   sncast account delete --name "${UA2_NAME:-ua2}"
   ```
4. Run the walkthrough:
   ```bash
   ./run.sh
   ```
   The pauses will prompt in interactive terminals; in CI/non-TTY contexts they auto-advance with
   a short delay. Step three now mints **FRI (STRK)** by default so deployments succeed on the
   latest devnet builds.
5. Inspect `ua2_e2e_demo.log` for the captured transcript, including the expected `ERR_POLICY_CALLCAP`
   revert on the final session call.

Coverage and case mapping: [`docs/test-plan.md`](./docs/test-plan.md)

---

## 🔒 Security

Threat model: [`docs/threat-model.md`](./docs/threat-model.md)
Highlights:

* Domain-separated session signatures
* Hard expiries and call/value caps
* Guardian quorum + timelock recovery
* Events for every state change
* Proxy upgrade separation + pause switch

---

## 📚 Documentation Set

* [RFC (high-level spec)](./docs/rfc-ua2-sdk.md)
* [Architecture Overview](./docs/architecture.md)
* [Interfaces](./docs/interfaces.md)
* [Validation Logic](./docs/validation.md)
* [Runbook (Sepolia)](./docs/runbook-sepolia.md)
* [Test Plan](./docs/test-plan.md)
* [Threat Model](./docs/threat-model.md)
* [SDK API Reference](./docs/sdk-api.md)
* [Demo Script](./docs/demo-script.md)
* [ADRs (Design Records)](./docs/adrs)
* [Roadmap](./docs/roadmap.md)

---

## 📹 Demo Script (6 min)

1. Connect & deploy UA² Account
2. Create session (transfer cap)
3. Use session (no wallet popup)
4. Policy violation → revert
5. Sponsored tx → succeed
6. Revoke → fail
7. Guardian recovery → owner rotated

Details: [`docs/demo-script.md`](./docs/demo-script.md)

---

## 🗺️ Roadmap

* v0.2: bitmap allowlists, policy templates, extra paymasters
* v0.3: WebAuthn session keys, multisig owners, more wallets
* v0.4: formal verification, gas benchmarking, Python/Rust SDKs

Full plan: [`docs/roadmap.md`](./docs/roadmap.md)

---

## 🤝 Contributing

Contributions welcome!
See [`CONTRIBUTING.md`](./CONTRIBUTING.md) and [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md).

---

## 📜 License

Apache-2.0. See [`LICENSE`](./LICENSE).

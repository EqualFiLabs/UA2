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

### 3. Deploy to Sepolia

```bash
# still inside packages/contracts
export STARKNET_RPC_URL=<YOUR_SEPOLIA_RPC>
export UA2_OWNER_PUBKEY=<OWNER_PUBKEY_FELT>
./scripts/deploy_ua2.sh
```

The helper script declares the class if needed and writes `UA2_CLASS_HASH`, `UA2_IMPLEMENTATION_ADDR`,
and `UA2_PROXY_ADDR` to `packages/contracts/.ua2-sepolia-addresses.json`. Copy the relevant values into
`.env.sepolia` (and `NEXT_PUBLIC_UA2_PROXY_ADDR` for the demo app).

### 4. Run demo app

```bash
export $(grep -v '^#' .env.sepolia | xargs)
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
* **E2E on Sepolia:**

  ```bash
  npm run e2e:sepolia
  ```

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

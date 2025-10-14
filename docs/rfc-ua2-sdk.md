# RFC: Universal Account Abstraction SDK for Starknet (UA²-SDK)

**Status:** Draft for Resolve Hackathon submission
**Author:** Matt (“Hooftly”)
**Date:** September 30, 2025
**Target chain(s):** Starknet Sepolia → Starknet Mainnet
**License (proposed):** Apache-2.0

---

## 0. Executive Summary

Starknet ships **native Account Abstraction (AA)** — all user accounts are smart contracts — which enables programmable validation, multicall, and UX superpowers out of the box. ([docs.starknet.io][1]) The ecosystem has excellent **building blocks** (OpenZeppelin Cairo accounts, starknet.js, wallet vendors like Argent/Braavos, and session keys patterns; game-centric stacks like Cartridge with passkeys + paymaster). But there’s no **wallet-agnostic, drop-in SDK** that standardizes **session keys, recovery/guardians, and paymaster adapters** behind one minimal API for any dApp. ([OpenZeppelin Docs][2])

**UA²-SDK** delivers:

* A **Cairo account module set** (plug-in style) atop OpenZeppelin’s account component:

  * **SessionKeys** with fine-grained constraints (function allowlist, target allowlist, per-call/per-period limits, expirations).
  * **Guardians/SocialRecovery** with threshold + timelock.
  * **KeyRotation** hardening and auditable events. ([OpenZeppelin Docs][2])
* A **TypeScript SDK** that abstracts wallets (Argent, Braavos, Cartridge, injected), session management, and **Paymaster** providers (gasless or alt-fee token) using **starknet.js** primitives. ([starknetjs.com][3])
* A polished **React demo app** and **CLI** showing real workflows: create session, revoke, sponsor tx, perform guarded actions, execute social recovery.

Goal for hackathon: **ship a working reference account + SDK + demo** that other teams can adopt immediately.

---

## 1. Motivation & Problem Statement

* **Fragmented AA UX:** Wallets expose different interfaces; session-key guidance lives in blog posts and vendor SDKs (e.g., Argent, Cartridge) instead of a neutral toolkit. ([starknet.io][4])
* **Missing common patterns:** dApps repeatedly re-implement session scoping, revocation, and safety rails, or avoid them altogether.
* **Sponsored tx complexity:** Paymaster integration is provider-specific; developers lack a thin, stable interface. ([starknetjs.com][5])

This RFC proposes a neutral, modular SDK that standardizes these primitives without locking developers into a single wallet, paymaster, or app vertical.

---

## 2. Non-Goals (for hackathon scope)

* Not a new wallet. The SDK integrates **existing wallets** (Argent, Braavos, Cartridge, etc.).
* Not a paymaster service. It **plugs into** existing paymaster RPC providers via adapters. ([starknet-react.com][6])
* Not a custody solution. Guardians/recovery are **self-custody** mechanisms.

---

## 3. Prior Art & References

* **Starknet AA & Accounts:** official docs. ([docs.starknet.io][1])
* **OpenZeppelin Cairo accounts/components:** used as the account base. ([OpenZeppelin Docs][2])
* **starknet.js accounts & paymaster guide:** SDK foundation + paymaster interface. ([starknetjs.com][3])
* **Session keys on Starknet:** ecosystem article + Argent sessions repo. ([starknet.io][4])
* **Cartridge Controller:** session keys & passkeys; demonstrates sponsor/pay flows (the SDK integrates, not replaces). ([docs.cartridge.gg][7])
* **Starknet React Paymaster Providers:** confirms provider concept used by the community. ([starknet-react.com][6])

---

## 4. Glossary

* **AA (Account Abstraction):** Users are smart-contract accounts; validation is programmable. ([docs.starknet.io][1])
* **Session Key:** Ephemeral key authorized to execute constrained actions for a limited time/amount. ([starknet.io][4])
* **Guardian/Social Recovery:** Extra signers able to recover/rotate the owner after a timelock.
* **Paymaster:** Service that sponsors gas or allows alternative fee tokens via an API used by starknet.js. ([starknetjs.com][5])

---

## 5. High-Level Architecture

```
+---------------------+        +---------------------------+        +-----------------------+
|  dApp (Web/Node)    |  SDK   |   UA²-SDK (TypeScript)    |  RPC   |  Wallets / Providers  |
|  - business logic   +------->+  - Wallet Abstraction     +------->+  Argent / Braavos     |
|  - UI/CLI           |        |  - Session Manager        |        |  Cartridge Controller |
+---------+-----------+        |  - Paymaster Adapters     |        |  Paymaster Providers  |
          |                    +------------+--------------+        +-----------+-----------+
          | Cairo calls                                     starknet.js        |
          v                                                                  (sponsor)
+---------------------+                                                        |
|  UA² Account (Cairo)|<-------------------------------------------------------+
|  - OZ Account base  |
|  - SessionKeys mod  |
|  - Guardians mod    |
|  - KeyRotation mod  |
+---------------------+
```

* **On-chain**: Composable account built from **OpenZeppelin AccountComponent** plus custom modules. ([OpenZeppelin Docs][2])
* **Off-chain**: TypeScript SDK bundles wallet connectors, session persistence, and paymaster adapters using **starknet.js**. ([starknetjs.com][3])

---

## 6. Functional Requirements

1. **Account module** ships with:

* `SessionKeys`: add/list/revoke; constraints: `functionSelectors[]`, `targetContracts[]`, `maxCalls`, `maxValuePerCall`, `valid_after`, `valid_until`, `nonceSalt`; emits events; enforced in `__validate__`.
   * `Guardians`: `addGuardian`, `removeGuardian`, `proposeRecovery`, `confirmRecovery`, `executeRecovery` after `recoveryDelay`, threshold `m-of-n`.
   * `KeyRotation`: owner rotate with optional guardian assist; emits `OwnerRotated`.
2. **SDK**:

   * `connect()` → unified wallet session (Argent/Braavos/Cartridge/injected).
   * `createSession(policy)` / `revokeSession(id)` / `useSession(id)` wrappers.
   * `withPaymaster(provider)` → returns signer/account that sponsors tx per provider API. ([starknetjs.com][5])
   * `guard()` helpers to build call-policies (selectors/targets/limits).
3. **Demo app**:

   * One protected action (e.g., “post note”), one value-bearing action (ERC-20 transfer cap), a “gasless” button using a paymaster, session list UI, and a recovery walkthrough.

---

## 7. Non-Functional Requirements

* **Security-first:** Chain/addr domain separation, bounded key lifetimes, revocation semantics, guardian threshold + timelock.
* **Backward-compatible:** Works with any OZ-compatible account; modules callable via `__validate__` hook. ([OpenZeppelin Docs][2])
* **Minimal deps:** starknet.js only; optional peer adapters (starknet-react, Cartridge). ([starknetjs.com][3])
* **Docs & samples:** Code-first docs; copy-paste integrable examples.
* **Testability:** Unit tests (Cairo + TS), devnet e2e.

---

## 8. Cairo Contract Design

### 8.1 Base & Storage

* **Base:** `UA2Account` inherits **OpenZeppelin Account** (Cairo 2.x). Storage keeps:

  * `owner_pubkey: felt252`
  * `guardians: LegacyMap<ContractAddress,bool>` + `guardian_count: u32` + `guardian_threshold: u8`
  * `recovery_delay: u64`
  * `recovery_active: bool`
  * `recovery_proposed_owner: felt252`
  * `recovery_eta: u64`
  * `recovery_confirm_count: u32`
  * `recovery_proposal_id: u64`
  * `recovery_guardian_last_confirm: LegacyMap<ContractAddress, u64>`
  * `session: Map<session_key_hash, SessionPolicy>`
  * `sessionNonce: Map<session_key_hash, u128>`
  * `sessionTargetAllow: LegacyMap<(session_key_hash, ContractAddress), bool>`
  * `sessionSelectorAllow: LegacyMap<(session_key_hash, felt252), bool>`

OZ Account is the canonical base for `__validate__`/`__execute__` pattern and multicall. ([OpenZeppelin Docs][2])

### 8.2 Session Policy (struct)

```
struct SessionPolicy {
    is_active: bool,
    valid_after: u64,                // block timestamp
    valid_until: u64,                // block timestamp
    max_calls: u32,
    calls_used: u32,
    max_value_per_call: Uint256,     // wei-like units for ERC-20 transfers (native send unsupported in v0)
}
```

Selector and target allowlists are stored separately under `sessionTargetAllow(session_key_hash, ContractAddress)` and `sessionSelectorAllow(session_key_hash, felt252)` legacy maps. The owner typically calls `add_session_with_allowlists` to write the base policy and seed those maps in a single transaction. Empty allowlists are technically valid but render the session unusable, and we recommend keeping each list ≤32 entries in v0 to avoid excessive storage writes.

**Validation path:**

* If signature is by `owner_pubkey`: standard path.
* Else if signature verifies to a registered **session key**:

  * Check `is_active`, `now >= valid_after`, `now <= valid_until`, and `calls_used + tx_call_count <= max_calls`.
  * Require allowlist booleans for `(key_hash, target)` and `(key_hash, selector)` to be `true`.
  * Enforce ERC-20 `transfer` / `transferFrom` amounts ≤ `max_value_per_call` (native `call.value` transfers are out-of-scope for v0).
  * Require session nonce match, then verify the ECDSA signature over the poseidon-hashed call set.
  * Call `apply_session_usage` to bump counters/nonce and emit `SessionUsed` + `SessionNonceAdvanced`.

**Events:**

```
event SessionAdded(key_hash: felt252, valid_after: u64, valid_until: u64, max_calls: u32);
event SessionRevoked(key_hash: felt252);
event SessionUsed(key_hash: felt252, used: u32);
event SessionNonceAdvanced(key_hash: felt252, new_nonce: u128);
event GuardianAdded(addr: ContractAddress);
event GuardianRemoved(addr: ContractAddress);
event ThresholdSet(threshold: u8);
event RecoveryDelaySet(delay: u64);
event OwnerRotated(new_owner: felt252);
event RecoveryProposed(new_owner: felt252, eta: u64);
event RecoveryConfirmed(guardian: ContractAddress, new_owner: felt252, count: u32);
event RecoveryCanceled();
event RecoveryExecuted(new_owner: felt252);
```

### 8.3 Guardians & Recovery

* `addGuardian(addr)`, `removeGuardian(addr)` (owner-only).
* `proposeRecovery(new_owner, proof)` callable by any **m-of-n guardians**, sets `recovery.proposed_owner` and `eta = now + recoveryDelay`.
* `executeRecovery()` after `eta` rotates `owner_pubkey = proposed_owner` and clears recovery info.

### 8.4 Key Rotation

* `rotateOwner(new_owner)` (owner-only), emits `OwnerRotated`.
* Optional guardian-assisted rotation bypassing current owner if recovery active.

### 8.5 Upgradeability

* Ship as **proxy + implementation** using OZ Cairo proxy pattern to allow module upgrades (future-proof). ([openzeppelin.com][8])

---

## 9. TypeScript SDK Design

**Packages**

* `@ua2/core` — wallet abstraction (starknet.js), session manager, policy builder, paymaster adapters. ([starknetjs.com][3])
* `@ua2/react` — hooks (`useAccount`, `useSessions`, `usePaymaster`).
* `@ua2/paymasters` — adapters implementing a common interface, including `NoopPaymaster` for devnet and `AvnuPaymaster` for Sepolia sponsorship (`sponsored` and token-fee `default` modes).

  Provide examples wired to **starknet.js PaymasterInterface** and **Starknet React paymaster providers**. ([starknetjs.com][5])
* `@ua2/contracts` — Cairo artifacts + deploy script.

**Key APIs**

```ts
// connect any wallet (Argent, Braavos, Cartridge, injected)
const ua = await UA2.connect({ preferred: ['argent', 'braavos', 'cartridge'] });

// create a session
const sess = await ua.sessions.create({
  validAfter: Math.floor(Date.now() / 1000),
  validUntil: nowPlusHours(8),
  allow: {
    targets: [erc20.address],
    selectors: [erc20.interface.getFunction('transfer').selector],
  },
  limits: { maxCalls: 50, maxValuePerCall: toUint256('10000000000000000') }, // 0.01 ETH
<<<<<<< ours
  validAfter: Date.now() / 1000,
  validUntil: Date.now() / 1000 + 8 * 3600,
=======
>>>>>>> theirs
});

// use a paymaster
const transport = /* CallTransport wired to your Account */;
const avnu = UA2.paymasters.avnu({ url: 'https://sepolia.paymaster.avnu.fi' });
if (await avnu.isAvailable()) {
  await avnu.sponsor(account, calls, 'sponsored');
} else {
  const runner = ua.withPaymaster(UA2.paymasters.noop(), { ua2Address: account.address, transport });
  const tx = await runner.call(contract.address, contract.selector('doThing'), args);
}

// revoke
await ua.sessions.revoke(sess.id);
```

**Internals**

* Session keys: ECDSA stark-curve keypairs generated in-app; public keys registered on-chain; private keys held locally (or in WebAuthn/secure enclave where available).
* Domain separation: `hash(chainId, accountAddress, sessionKey, nonceSalt)` to prevent cross-chain/key replay.

---

## 10. Security Considerations

* **Domain separation:** Session signatures bind to `(chain_id, account_addr)`. ([docs.starknet.io][1])
* **Expiry & limits:** Every session must declare `valid_after`/`valid_until`; default small `maxCalls`.
* **Revocation:** `revokeSession(key_hash)` immediately blocks use. Events let dApps react.
* **Replay protection:** Optional per-session nonce (`sessionNonce`) incremented in validation.
* **Guardian griefing:** Require **m-of-n** quorum and **timelock**; owner can cancel a pending recovery.
* **Upgrade risk:** Proxy admin separated from owner; publish class hash + implementation address; include pausable kill-switch (owner/guardian quorum).
* **Paymaster trust:** SDK flags which provider is used, shows fee assumptions, and fails closed on sponsorship errors. ([starknetjs.com][5])

---

## 11. Gas/Performance Notes

* **Validation path**: O(#calls * (selector + target checks)). Use **bitset/bitmap** encodings for selectors if needed; start with arrays for simplicity, upgrade later.
* **Storage**: `calls_used` is incremented once per tx (after checking aggregate calls), not per inner call, to minimize writes.
* **Policy packing**: keep `valid_after`/`valid_until` in `u64`; `maxCalls` in `u32`; selectors as `felt252[]`.

---

## 12. Compatibility & Integrations

* **Wallets:** support **Argent/Braavos** (injected) and **Cartridge** (Controller) through connection abstractions; leverage starknet.js for accounts and providers. ([starknetjs.com][3])
* **Paymasters:** implement adapters compatible with **starknet.js paymaster guide**; optionally surface **Starknet React provider list** as presets. ([starknetjs.com][5])
* **Contracts:** OZ Cairo compatible; no dependency on specific token standards.

---

## 13. Deliverables (Hackathon)

1. **Cairo contracts** (`@ua2/contracts`): account + modules, deployment script, events.
2. **TypeScript SDK** (`@ua2/core`, `@ua2/react`, `@ua2/paymasters`).
3. **Demo app**:

   * Connect wallet → Deploy/attach UA² account → Create session → Gasless action via paymaster → Revoke → Guardian recovery flow.
4. **Docs**: Quickstart, Architecture, Security, API reference.
5. **Tests**: Cairo unit tests + TS e2e (Devnet/ Sepolia).

---

## 14. Demo Narrative (5–7 minutes)

* **Cold start:** Connect wallet, deploy UA² account (or attach existing).
* **Session power:** Approve session to post notes (no wallet popups).
* **Gasless action:** Flip a toggle; same action executes via **paymaster**. ([starknetjs.com][5])
* **Safety:** Attempt out-of-policy action → revert with clear error.
* **Recovery:** Simulate lost owner key → guardian quorum recovers ownership after timelock.

---

## 15. Testing Plan

* **Cairo**

  * Unit: policy enforcement, expiry, call/limit checks, guardian quorum, recovery timelock.
  * Property tests: never allow out-of-allowlist call; invariants across upgrades.
* **E2E**

  * Devnet: session create/use/revoke; sponsored tx happy/negative paths.
  * Sepolia: deploy, run all flows with small value limits.
* **Fuzz**

  * Random selector/target sets; adversarial payloads (over-max, expired).

---

## 16. API & Event Schemas (Selected)

**Events**

```
event SessionAdded(key_hash: felt252, valid_after: u64, valid_until: u64, max_calls: u32);
event SessionRevoked(key_hash: felt252);
event SessionUsed(key_hash: felt252, used: u32);
event SessionNonceAdvanced(key_hash: felt252, new_nonce: u128);
event GuardianAdded(addr: ContractAddress);
event GuardianRemoved(addr: ContractAddress);
event ThresholdSet(threshold: u8);
event RecoveryDelaySet(delay: u64);
event OwnerRotated(new_owner: felt252);
event GuardianProposed(guardian: ContractAddress, proposal_id: u64, new_owner: felt252, eta: u64);
event GuardianFinalized(guardian: ContractAddress, proposal_id: u64, new_owner: felt252);
event RecoveryProposed(new_owner: felt252, eta: u64);
event RecoveryConfirmed(guardian: ContractAddress, new_owner: felt252, count: u32);
event RecoveryCanceled();
event RecoveryExecuted(new_owner: felt252);
```

**Error codes**

* `ERR_SESSION_EXPIRED`
* `ERR_SESSION_INACTIVE`
* `ERR_SESSION_STALE`
* `ERR_SESSION_NOT_READY`
* `ERR_SESSION_TARGETS_LEN`
* `ERR_SESSION_SELECTORS_LEN`
* `ERR_POLICY_CALLCAP`
* `ERR_POLICY_SELECTOR_DENIED`
* `ERR_POLICY_TARGET_DENIED`
* `ERR_POLICY_CALLCOUNT_MISMATCH`
* `ERR_VALUE_LIMIT_EXCEEDED`
* `ERR_BAD_SESSION_NONCE`
* `ERR_BAD_VALID_WINDOW`
* `ERR_BAD_MAX_CALLS`
* `ERR_SESSION_SIG_INVALID`
* `ERR_SIGNATURE_MISSING`
* `ERR_OWNER_SIG_INVALID`
* `ERR_GUARDIAN_SIG_INVALID`
* `ERR_GUARDIAN_EXISTS`
* `ERR_NOT_GUARDIAN`
* `ERR_GUARDIAN_CALL_DENIED`
* `ERR_BAD_THRESHOLD`
* `ERR_RECOVERY_IN_PROGRESS`
* `ERR_NO_RECOVERY`
* `ERR_RECOVERY_MISMATCH`
* `ERR_ALREADY_CONFIRMED`
* `ERR_BEFORE_ETA`
* `ERR_NOT_ENOUGH_CONFIRMS`
* `ERR_NOT_OWNER`
* `ERR_ZERO_OWNER`
* `ERR_SAME_OWNER`
* `ERR_UNSUPPORTED_AUTH_MODE`

---

## 17. Rollout & Versioning

* Tag **v0.1.0**: single policy type with dedicated allowlist maps; argent/braavos/cartridge connectors; 1–2 paymaster adapters.
* Publish Cairo class hashes (Sepolia) in README; deploy script prints addresses.
* Post-hackathon: v0.2.x adds bitmap encodings, WebAuthn helper, more providers.

---

## 18. Risks & Mitigations

* **Provider churn:** Keep adapter surface tiny; document how to add new paymasters. ([starknet-react.com][6])
* **Wallet heterogeneity:** Prefer starknet.js account interface; fall back to vendor bridges as needed. ([starknetjs.com][3])
* **Security review time:** Ship explicit limits, conservative defaults, verbose events; keep code small.

---

## 19. 15-Day Execution Plan (Resolve timeline)

**Day 1:** Finalize spec; scaffold monorepo (`packages/{contracts,core,react,paymasters,example}`); CI skeleton.
**Day 2:** Cairo base account + storage; events; stub `__validate__` hooks.
**Day 3:** Implement `SessionKeys` policy checks (selectors/targets/expiry/callcap).
**Day 4:** Implement value cap + `calls_used` accounting; unit tests (happy/negative).
**Day 5:** Guardians module + recovery timelock; tests.
**Day 6:** KeyRotation; pausable; proxy wiring; deploy script (Sepolia). ([openzeppelin.com][8])
**Day 7:** TS `@ua2/core`: wallet abstraction on **starknet.js**; connect, sign, call. ([starknetjs.com][3])
**Day 8:** Sessions API (create/list/revoke/use); local key mgmt; domain sep.
**Day 9:** Paymaster interface + 1 adapter following **starknet.js paymaster guide**; e2e devnet. ([starknetjs.com][5])
**Day 10:** `@ua2/react` hooks; demo app skeleton (connect/deploy/attach).
**Day 11:** Demo actions (post note, capped ERC-20 transfer); gasless toggle via adapter.
**Day 12:** Recovery UI flow; copy-able code snippets in docs.
**Day 13:** Hardening pass: revert reasons, edge-case tests, readme polish.
**Day 14:** Record demo; write submission; Sepolia sanity runs.
**Day 15:** Buffer; paper-cut fixes; final deploy & submission.

---

## 20. Success Criteria

* Cairo account & modules deployed on Sepolia; addresses documented.
* TS SDK published (or tarball) with **two** examples: React app + Node CLI.
* Paymaster adapter demoed live (sponsored tx). ([starknetjs.com][5])
* Clear docs: 10-minute Quickstart from zero → gasless action + session revoke.

---

## 21. Future Work

* **Bitmap-based selector/target sets** to cut gas.
* **Policy templates** (DeFi-only, NFT-only, read-only).
* **WebAuthn** helper (passkeys) and secure enclave storage; deeper Cartridge interop. ([docs.cartridge.gg][7])
* **Multi-sig owner** option out of the box.
* **Formal verification** of `__validate__` constraints.

---

[1]: https://docs.starknet.io/architecture/accounts?utm_source=chatgpt.com "Accounts"
[2]: https://docs.openzeppelin.com/contracts-cairo/0.14.0/accounts?utm_source=chatgpt.com "Accounts"
[3]: https://starknetjs.com/docs/next/category/account/?utm_source=chatgpt.com "Account"
[4]: https://www.starknet.io/blog/session-keys-on-starknet-unlocking-gasless-secure-transactions/?utm_source=chatgpt.com "Session Keys on Starknet: Unlocking Gasless & Secure ..."
[5]: https://starknetjs.com/docs/next/guides/account/paymaster/?utm_source=chatgpt.com "Execute calls using Paymaster"
[6]: https://www.starknet-react.com/docs/paymaster-providers?utm_source=chatgpt.com "Paymaster Providers"
[7]: https://docs.cartridge.gg/controller/getting-started?utm_source=chatgpt.com "Controller Getting Started"
[8]: https://www.openzeppelin.com/cairo-contracts?utm_source=chatgpt.com "Cairo Contracts"

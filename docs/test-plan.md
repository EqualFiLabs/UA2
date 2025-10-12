# UA²-SDK • Test Plan & Coverage Matrix
Status: Draft (Resolve Hackathon)

This plan maps requirements → tests so any contributor can validate correctness and regression-scan changes quickly.

---

## 1) Scope & Philosophy

- **Unit tests (Cairo)**: Validate each rule in `__validate__`, session policy, guardians, and rotation.
- **Integration tests (JS/TS)**: Exercise SDK flows (connect, create session, call, revoke, paymaster).
- **E2E (Devnet & Sepolia)**: Full flows against a live node.
- **Negative tests**: Explicitly assert that out-of-policy actions revert with the **specific** error codes.

Target coverage:
- Cairo: ≥ 90% lines/branches on validation and public entrypoints.
- TS SDK: ≥ 80% for critical paths (session manager, paymaster adapters).

---

## 2) Test Environments

- **Local devnet** (Docker or native) for fast iterations.
- **Starknet Sepolia** with a funded test account for real-network checks.

Matrix:
| Layer | Env | Purpose |
|---|---|---|
| Cairo unit | snforge | Deterministic logic checks |
| SDK unit | node:test / vitest | API surface + serialization |
| SDK integ | devnet | End-to-end create/use/revoke |
| E2E | Sepolia | Sanity against public infra |

---

## 3) Cairo Unit Tests (snforge)

**Files (examples):**
- `contracts/tests/test_session_add.cairo`
- `contracts/tests/test_session_policy_expiry.cairo`
- `contracts/tests/test_policy_allowlist.cairo`
- `contracts/tests/test_policy_value_limit.cairo`
- `contracts/tests/test_session_revoke.cairo`
- `contracts/tests/test_guardians_quorum.cairo`
- `contracts/tests/test_recovery_timeline.cairo`
- `contracts/tests/test_owner_rotate.cairo`
- `contracts/tests/test_replay_nonce.cairo`
- `contracts/tests/test_events.cairo`

**Key cases:**

1. **Session Creation**
   - Adds session; emits `SessionAdded`; retrievable via getter.
   - Rejects duplicate key; rejects malformed policy.

2. **Expiry Enforcement**
   - Tx with expired session → `ERR_SESSION_EXPIRED`.

3. **Call Caps**
   - Uses ≤ `max_calls` → OK (increments `calls_used`).
   - Exceeds `max_calls` → `ERR_POLICY_CALLCAP`.

4. **Selector/Target Allowlist**
   - Allowed selector+target → OK.
   - Selector not in list → `ERR_POLICY_SELECTOR_DENIED`.
   - Target not in list → `ERR_POLICY_TARGET_DENIED`.

5. **Value Caps**
   - `value <= max_value_per_call` → OK.
   - `value > max_value_per_call` → `ERR_VALUE_LIMIT_EXCEEDED`.

6. **Revocation**
   - After `revoke_session`, any use → `ERR_SESSION_INACTIVE`.

7. **Replay/Nonce**
   - Reusing same session signature with stale nonce → `ERR_BAD_SESSION_NONCE`.

8. **Guardians & Recovery**
   - `add_guardian`/`remove_guardian` events.
   - `propose_recovery` sets `eta`; `confirm_recovery` tracks quorum.
   - Pre-ETA execute → `ERR_BEFORE_ETA`.
   - Insufficient confirmations → `ERR_NOT_ENOUGH_CONFIRMS`.
   - Post-ETA; quorum met → `RecoveryExecuted` + owner updated.
   - Owner cancel window (if supported) works.

9. **Owner Rotation**
   - `rotate_owner` updates owner; emits `OwnerRotated`.

10. **Event Completeness**
   - All success paths emit expected events exactly once.

**Run:**
```bash
cd packages/contracts
snforge test -vv
```

Expected tail:

```
Collected 30 tests
PASSED 30 tests
All tests passed.
```

---

## 4) JS/TS Unit & Integration Tests

**Packages:**

* `@ua2/core`: session manager, wallet abstraction, policy builder.
* `@ua2/paymasters`: adapter interface & concrete adapters.
* `@ua2/react`: hooks (light coverage; integration via demo).

**Representative test files:**

* `packages/core/test/sessions.spec.ts`
* `packages/core/test/policy.spec.ts`
* `packages/core/test/wallet.spec.ts`
* `packages/paymasters/test/adapter.spec.ts`

**Core cases:**

* `UA2.connect()` selects wallet provider by preference/fallback.
* `sessions.create()` builds calldata consistent with `interfaces.md`.
* `sessions.revoke()` idempotent behavior.
* Policy builder composes selector/target sets correctly.
* Paymaster adapter:

  * Happy path: `sponsor(tx)` injects correct fields (per provider schema).
  * Negative path: provider failure surfaces deterministic error.

**Run:**

```bash
npm run test:unit
```

Expected:

```
core: 52 passed
paymasters: 14 passed
react: 6 passed
All tests passed (###ms)
```

---

## 5) E2E (Devnet)

Script: `packages/example/scripts/e2e-devnet.ts`

**Flow:**

1. Deploy UA² to devnet (or attach if auto-deployed by script).
2. Create a session with:

   * `expires_at = now + 2h`
   * `max_calls = 5`
   * selectors = `[transfer]`
   * targets = `[ERC20_TEST_ADDR]`
   * `max_value_per_call = 10**15` (example)
3. Perform 3 in-policy calls → success.
4. Attempt out-of-policy call (wrong selector or target) → revert with correct error.
5. Revoke session → subsequent call fails.

**Run:**

```bash
npm run e2e:devnet
```

Expected summary:

```
E2E DEVNET
- deploy/attach ✓
- create session ✓
- in-policy x3 ✓
- out-of-policy revert ✓ (ERR_POLICY_SELECTOR_DENIED)
- revoke + denied ✓
```

---

## 6) E2E (Sepolia)

Script: `packages/example/scripts/e2e-sepolia.ts`

**Prereqs:**

* `.env.sepolia` (copied from `.env.sepolia.example`) filled with RPC + deployed addresses.
* Wallet funded on Sepolia.

**Flow:**

1. Attach UA² at `$UA2_PROXY_ADDR`.
2. Create session with narrow policy.
3. Execute in-policy call (e.g., post a note or small ERC-20 transfer).
4. Revoke session; see call fail.
5. (Optional) Stage a guardian recovery with short delay if configured in test build.

**Run:**

```bash
export $(grep -v '^#' ./.env.sepolia | xargs)
npm run e2e:sepolia
```

Expected:

```
E2E SEPOLIA
- attach ✓
- create session ✓ (tx_hash 0x...)
- call via session ✓ (receipt status: ACCEPTED_ON_L2)
- revoke ✓
- denied after revoke ✓
```

---

## 7) Negative/Adversarial Tests (selected)

* **Selector smuggling:** Malformed selector array → revert.
* **Target drift:** Unknown target → revert.
* **Clock skew:** Expiry barely passed → revert consistently.
* **Max calls boundary:** Exactly at limit OK; limit+1 fails.
* **Large multicall:** Ensure aggregate enforcement (no per-call write bloat).
* **Paymaster denial:** Sponsorship refused → SDK bubbles precise reason, falls back disabled.

---

## 8) Coverage & Reporting

* Cairo: `snforge test --coverage` (if available) or use per-module counts. Goal ≥ 90%.
* JS/TS: `npm run test:coverage` (nyc/vitest). Goal ≥ 80% critical paths.

Artifacts:

* `coverage/` HTML for JS/TS.
* `target/` build artifacts for Cairo.
* CI uploads both as job artifacts.

---

## 9) CI Matrix (reference)

* Job A: `contracts` (scarb build + snforge tests)
* Job B: `core/paymasters/react` (npm ci + unit tests + lint)
* Job C: `e2e:devnet` (spin devnet container + run script)
* Manual: `e2e:sepolia` (requires secrets/RPC; run locally or in protected CI)

---

## 10) Exit Criteria (“ready to demo”)

* All unit and e2e tests pass on devnet locally.
* Sepolia e2e succeeds at least once (attach → create session → in-policy call → revoke).
* Docs updated with actual class hash and proxy addresses.
* Demo script rehearsed end-to-end in < 7 minutes.

```

# UA² Validation Logic

## Owner Path
- If signature verifies to `owner_pubkey`:
  - Transaction valid.
  - Proceed to `__execute__`.

---

## Session Key Path
1. Compute `key_hash` = pedersen(session_pubkey).
2. Lookup the base `SessionPolicy` in `session` storage and fetch allowlist booleans from `session_target_allow` / `session_selector_allow` using `(key_hash, target)` and `(key_hash, selector)` keys.
3. Require `is_active == true` (`ERR_SESSION_INACTIVE`).
4. Require `block.timestamp >= valid_after` (`ERR_SESSION_NOT_READY`).
5. Require `block.timestamp <= valid_until` (`ERR_SESSION_EXPIRED`).
6. Require `calls_used + tx_call_count <= max_calls` (`ERR_POLICY_CALLCAP`).
7. For each call in `tx.multicall`:
   - Assert target allowlist entry is `true` (`ERR_POLICY_TARGET_DENIED`).
   - Assert selector allowlist entry is `true` (`ERR_POLICY_SELECTOR_DENIED`).
   - If selector == `ERC20::transfer`, ensure amount ≤ `max_value_per_call` (`ERR_VALUE_LIMIT_EXCEEDED`).
8. Require provided session nonce == stored nonce (`ERR_BAD_SESSION_NONCE`).
9. Verify ECDSA signature against the computed session message (`ERR_SESSION_SIG_INVALID`).
10. Call `apply_session_usage` to atomically bump `calls_used`, advance the nonce, and emit `SessionUsed` + `SessionNonceAdvanced`.
11. Proceed to `__execute__`.

If any check fails → revert with specific error code.

---

## Recovery Flow
1. Guardian calls `propose_recovery(new_owner)`.
2. Contract records `recovery.proposed_owner = new_owner`, `eta = block.timestamp + recoveryDelay`.
3. Additional guardians call `confirm_recovery(new_owner)`; track confirmations.
4. If confirmations ≥ threshold and `block.timestamp >= eta`:
   - Owner rotated to `new_owner`.
   - Emit `RecoveryExecuted`.
   - Clear recovery state.

---

## Rotation Flow
- `rotate_owner(new_owner)` callable by current owner.
- Immediately updates `owner_pubkey`.
- Emits `OwnerRotated`.

---

## Revocation Flow
- `revoke_session(key_hash)` sets `is_active = false`.
- Any tx signed by revoked session → `ERR_SESSION_INACTIVE`.

---

## Security Guarantees
- **No bypass:** Only owner or active session keys can validate.
- **Replay protection:** `sessionNonce` increments per session use.
- **Granularity:** Selector + target checks enforce least privilege.
- **Guardian resilience:** Timelock prevents instant hostile takeover.


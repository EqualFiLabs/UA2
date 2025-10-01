# UA² Validation Logic

## Owner Path
- If signature verifies to `owner_pubkey`:
  - Transaction valid.
  - Proceed to `__execute__`.

---

## Session Key Path
1. Compute `key_hash` = pedersen(session_pubkey).
2. Lookup policy in storage.
3. Require `is_active == true`.
4. Require `block.timestamp <= expires_at`.
5. Require `calls_used < max_calls`.
6. For each call in tx.multicall:
   - target ∈ `target_allow`
   - selector ∈ `selector_allow`
   - value ≤ `max_value_per_call`
7. Increment `calls_used` += number_of_calls.
8. Emit `SessionUsed`.
9. Proceed to `__execute__`.

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
- Any tx signed by revoked session → fail.

---

## Security Guarantees
- **No bypass:** Only owner or active session keys can validate.
- **Replay protection:** `sessionNonce` increments per session use.
- **Granularity:** Selector + target checks enforce least privilege.
- **Guardian resilience:** Timelock prevents instant hostile takeover.


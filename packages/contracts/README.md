# UA2 Contracts

## Build
scarb build

## Test
snforge test -vv

## Artifacts
- SIERRA/CASM under `target/`.

## Sessions 

- `add_session(key, policy)` — owner-only; writes policy; emits `SessionAdded`.
- `get_session(key_hash)` — returns stored `SessionPolicy`.
- `revoke_session(key_hash)` — owner-only; sets `is_active=false`; emits `SessionRevoked`.

## Guardians & Recovery

- **Admin (owner-only) functions**
  - `add_guardian(addr)` / `remove_guardian(addr)` — mutate the guardian set while enforcing uniqueness and minimum threshold guarantees.
  - `set_guardian_threshold(m)` — updates the guardian confirmation threshold (must be > 0 and ≤ current guardian count).
  - `set_recovery_delay(seconds)` — configures the cooldown applied between proposing and executing a recovery.

- **Recovery lifecycle functions**
  - `propose_recovery(new_owner)` (guardian) — starts a recovery for `new_owner`, stores ETA, and auto-confirms the proposer on new proposals.
  - `confirm_recovery(new_owner)` (guardian) — records an additional guardian confirmation for the active proposal.
  - `cancel_recovery()` (owner) — aborts the active recovery and clears all recovery bookkeeping.
  - `execute_recovery()` — validates confirmations and delay before rotating ownership and finalising the recovery.

- **Events emitted**
  - `GuardianAdded`, `GuardianRemoved`, `ThresholdSet`, `RecoveryDelaySet` — mirror admin configuration changes.
  - `RecoveryProposed`, `RecoveryConfirmed`, `RecoveryCanceled`, `RecoveryExecuted`, `OwnerRotated` — signal recovery lifecycle progress.

- **Common errors**
  - `ERR_GUARDIAN_EXISTS` / `ERR_NOT_GUARDIAN` — guardian membership violations when adding, removing, or confirming.
  - `ERR_BAD_THRESHOLD` — supplied threshold is zero or above the number of guardians.
  - `ERR_RECOVERY_IN_PROGRESS` / `ERR_NO_RECOVERY` — recovery started twice or absent when confirming/canceling/executing.
  - `ERR_RECOVERY_MISMATCH` — confirmation attempted for a stale `new_owner` value.
  - `ERR_ALREADY_CONFIRMED` — guardian has already confirmed the current proposal.
  - `ERR_NOT_ENOUGH_CONFIRMS` — required guardian threshold has not been met during execution.
  - `ERR_BEFORE_ETA` — cooldown window has not elapsed prior to execution.

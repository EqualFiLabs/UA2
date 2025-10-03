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

## Guardians & Recovery (Task 1.5)

- Admin (owner-only):
  - `add_guardian(addr)`, `remove_guardian(addr)`
  - `set_guardian_threshold(m)`
  - `set_recovery_delay(seconds)`

- Recovery lifecycle:
  - `propose_recovery(new_owner)` (guardian): opens proposal, auto-confirms proposer
  - `confirm_recovery(new_owner)` (guardian): increments count
  - `cancel_recovery()` (owner): aborts proposal
  - `execute_recovery()`: require count ≥ threshold and `block.timestamp ≥ eta`; rotates owner

- Events:
  - `GuardianAdded/Removed`, `ThresholdSet`, `RecoveryDelaySet`
  - `RecoveryProposed`, `RecoveryConfirmed`, `RecoveryCanceled`, `RecoveryExecuted`

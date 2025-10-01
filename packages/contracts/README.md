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

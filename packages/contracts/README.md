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

## Owner Rotation (Task 1.6)

- `rotate_owner(new_owner)` — **owner-only** direct rotation.
- Emits `OwnerRotated(new_owner)`.
- Safety checks:
  - Rejects `new_owner == 0`.
  - Rejects rotating to current owner.
  - If a recovery is active, rotation reverts (`ERR_RECOVERY_IN_PROGRESS`) — cancel first via `cancel_recovery()`.

## Deploying to Starknet Sepolia

We ship portable `sncast` scripts that work without global Foundry profiles.

### 0) Prereqs
- `scarb`, `snforge`, `sncast` installed
- Build contracts once:
  ```bash
  scarb build
  ```
- Copy env template and fill values:

  ```bash
  cp packages/contracts/scripts/.env.sepolia.example .env.sepolia
  # edit .env.sepolia: set STARKNET_RPC_URL, and either SNCAST_KEYSTORE_PATH or SNCAST_PRIVATE_KEY.
  ```

### 1) Declare class hash

```bash
cd packages/contracts
source ./scripts/.env.sepolia
./scripts/declare_ua2.sh
# Outputs UA2_CLASS_HASH and stores it in .ua2-sepolia-addresses.json
```

### 2) Deploy UA² (direct by default)

```bash
./scripts/deploy_ua2.sh
# Writes UA2_PROXY_ADDR (the deployed contract addr) into .ua2-sepolia-addresses.json
```

### 3) (Optional) Proxy/UUPS path

If/when `UA2Account` implements UUPS, set:

```
UA2_USE_PROXY=1
```

in `.env.sepolia` and adapt `upgrade_ua2.sh` with your upgrade entrypoint. Then:

```bash
./scripts/upgrade_ua2.sh
```

### Outputs

* `.ua2-sepolia-addresses.json` generated in `packages/contracts/`:

  ```json
  {
    "UA2_CLASS_HASH": "0x...",
    "UA2_PROXY_ADDR": "0x...",
    "UA2_IMPLEMENTATION_ADDR": "0x..."
  }
  ```

### Troubleshooting

* `sncast declare/deploy` fails: check RPC/key; try again later (Sepolia endpoints rate-limit).
* Missing class hash: ensure `target/dev/UA2Account.sierra.json` exists (`scarb build`).
* Auth error: set either `SNCAST_KEYSTORE_PATH` (recommended) or `SNCAST_PRIVATE_KEY` in `.env.sepolia`.

# UA² Account Interfaces

## Externals

### Session Management
- `fn add_session(key: felt252, policy: SessionPolicy)`
- `fn add_session_with_allowlists(key: felt252, policy: SessionPolicy, targets: Array<ContractAddress>, selectors: Array<felt252>)`
- `fn apply_session_usage(key_hash: felt252, prior_calls_used: u32, tx_call_count: u32, provided_nonce: u128)`
- `fn revoke_session(key_hash: felt252)`
- `fn get_session(key_hash: felt252) -> SessionPolicy`

### Guardians
- `fn add_guardian(addr: ContractAddress)`
- `fn remove_guardian(addr: ContractAddress)`
- `fn propose_recovery(new_owner: felt252)`
- `fn confirm_recovery(new_owner: felt252)`
- `fn execute_recovery()`

### Owner Rotation
- `fn rotate_owner(new_owner: felt252)`

---

## Structs

```rust
struct SessionPolicy {
    is_active: bool,
    valid_after: u64,
    valid_until: u64,
    max_calls: u32,
    calls_used: u32,
    max_value_per_call: Uint256,
}
```

The selector and target allowlists are not embedded in the struct. They are stored in dedicated `LegacyMap` slots keyed by `(key_hash, target)` and `(key_hash, selector)` respectively, and are populated by calling `add_session_with_allowlists` alongside the base policy.

---

## Events

* `SessionAdded(key_hash: felt252, valid_after: u64, valid_until: u64, max_calls: u32)`
* `SessionRevoked(key_hash: felt252)`
* `SessionUsed(key_hash: felt252, used: u32)`
* `SessionNonceAdvanced(key_hash: felt252, new_nonce: u128)`
* `GuardianAdded(addr: ContractAddress)`
* `GuardianRemoved(addr: ContractAddress)`
* `ThresholdSet(threshold: u8)`
* `RecoveryDelaySet(delay: u64)`
* `OwnerRotated(new_owner: felt252)`
* `RecoveryProposed(new_owner: felt252, eta: u64)`
* `RecoveryConfirmed(guardian: ContractAddress, new_owner: felt252, count: u32)`
* `RecoveryCanceled()`
* `RecoveryExecuted(new_owner: felt252)`

---

## Errors

The contract reverts with the following identifiers:

* `ERR_SESSION_EXPIRED`
* `ERR_SESSION_INACTIVE`
* `ERR_POLICY_CALLCAP`
* `ERR_POLICY_SELECTOR_DENIED`
* `ERR_POLICY_TARGET_DENIED`
* `ERR_VALUE_LIMIT_EXCEEDED`
* `ERR_POLICY_CALLCOUNT_MISMATCH`
* `ERR_BAD_SESSION_NONCE`
* `ERR_SESSION_SIG_INVALID`
* `ERR_GUARDIAN_EXISTS`
* `ERR_NOT_GUARDIAN`
* `ERR_BAD_THRESHOLD`
* `ERR_RECOVERY_IN_PROGRESS`
* `ERR_NO_RECOVERY`
* `ERR_RECOVERY_MISMATCH`
* `ERR_ALREADY_CONFIRMED`
* `ERR_BEFORE_ETA`
* `ERR_NOT_ENOUGH_CONFIRMS`
* `ERR_ZERO_OWNER`
* `ERR_SAME_OWNER`


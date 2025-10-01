# UA² Account Interfaces

## Externals

### Session Management
- `fn add_session(key: felt252, policy: SessionPolicy)`
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
    expires_at: u64,
    max_calls: u32,
    calls_used: u32,
    max_value_per_call: Uint256,
    target_allow: Array<ContractAddress>,
    selector_allow: Array<felt252>,
}
```

---

## Events

* `SessionAdded(key_hash: felt252, expires_at: u64, max_calls: u32)`
* `SessionRevoked(key_hash: felt252)`
* `SessionUsed(key_hash: felt252, used: u32)`
* `GuardianAdded(addr: ContractAddress)`
* `GuardianRemoved(addr: ContractAddress)`
* `RecoveryProposed(new_owner: felt252, eta: u64, quorum: u8)`
* `RecoveryExecuted(new_owner: felt252)`
* `OwnerRotated(new_owner: felt252)`

---

## Errors

* `ERR_SESSION_EXPIRED`
* `ERR_POLICY_SELECTOR_DENIED`
* `ERR_POLICY_TARGET_DENIED`
* `ERR_VALUE_LIMIT_EXCEEDED`
* `ERR_GUARDIAN_QUORUM`
* `ERR_RECOVERY_NOT_READY`


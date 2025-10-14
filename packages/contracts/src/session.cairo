use core::array::Array;
use core::integer::u256;
use starknet::ContractAddress;

/// Canonical session configuration passed by the account owner.
///
/// * `pubkey` is the Stark curve public key for the session signer (felt252).
/// * `valid_after` / `valid_until` gate the validity window using block timestamps (u64).
/// * `max_calls` limits how many calls can be executed over the lifetime of the session (u32).
/// * `value_cap` bounds the maximum value per call in wei-like units (u256).
/// * `targets_len` mirrors the number of addresses contained in `targets`.
/// * `selectors_len` mirrors the number of function selectors contained in `selectors`.
#[derive(Drop, Serde)]
pub struct Session {
    pub pubkey: felt252,
    pub valid_after: u64,
    pub valid_until: u64,
    pub max_calls: u32,
    pub value_cap: u256,
    pub targets_len: u32,
    pub targets: Array<ContractAddress>,
    pub selectors_len: u32,
    pub selectors: Array<felt252>,
}

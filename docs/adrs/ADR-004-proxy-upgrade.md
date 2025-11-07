# ADR-004: Native Upgradeability (replace_class)

## Context
UA² Account may evolve post-hackathon. Cairo contracts require upgrade paths.

## Decision
Adopt Starknet’s native upgrade flow: mix OpenZeppelin’s `UpgradeableComponent` into `UA2Account`, gate `upgrade(new_class_hash)` with the account’s owner, and rely on the `replace_class` syscall to swap code in-place (no proxy contract).

## Alternatives
- Immutable implementation: safer, but un-upgradeable.  
- Custom proxy contracts: emulate delegatecalls with manual forwarders, but no Starknet fallback means high maintenance cost and duplicated entrypoints.

## Consequences
- Pros: Single contract address forever; governance upgrades declare a new class hash and call `upgrade`, preserving storage without extra admin contracts.  
- Cons: Same upgrade-caveats as EVM (layout compatibility, access control) and requires tooling/scripts that keep `UA2_ACCOUNT_ADDR` + class hashes in sync.

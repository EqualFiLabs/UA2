# ADR-004: Proxy Pattern for Upgradeability

## Context
UA² Account may evolve post-hackathon. Cairo contracts require upgrade paths.

## Decision
Deploy via **OpenZeppelin UUPS-style proxy** with separate admin.  
Implementation is declared + deployed; proxy points to implementation.

## Alternatives
- Immutable implementation: safer, but un-upgradeable.  
- Custom minimal proxy: less tooling support.

## Consequences
- Pros: Flexibility; future upgrades possible.  
- Cons: Adds admin trust assumption; mitigated by separation of roles.

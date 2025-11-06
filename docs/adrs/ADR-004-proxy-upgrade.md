# ADR-004: Proxy Pattern for Upgradeability

## Context
UA² Account may evolve post-hackathon. Cairo contracts require upgrade paths.

## Decision
Deploy via **OpenZeppelin UUPS-style proxy** with separate admin.  
`ua2proxy.cairo` in the repository implements the UUPS dispatcher: it stores the implementation class hash and admin, delegates calls, and exposes an `upgrade` entrypoint guarded by the admin.

## Alternatives
- Immutable implementation: safer, but un-upgradeable.  
- Custom minimal proxy: less tooling support.

## Consequences
- Pros: Flexibility; shipping upgrades only requires declaring a new implementation and calling `upgrade`.  
- Cons: Introduces an admin trust assumption for the proxy; mitigated by separation of roles and monitoring of upgrade events.

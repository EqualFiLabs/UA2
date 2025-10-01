# ADR-001: Base Account = OpenZeppelin AccountComponent

## Context
Starknet accounts are Cairo contracts implementing `__validate__` and `__execute__`.  
We need a secure, audited base for UA² Account.

## Decision
We inherit from **OpenZeppelin’s AccountComponent (Cairo 2.x)**.  
- Provides battle-tested `__validate__` and multicall plumbing.  
- Community standard for Starknet accounts.  
- Extensible for modular additions.

## Alternatives
- Custom base: rejected (too risky and redundant).  
- Argent/Braavos account fork: rejected (wallet-specific).

## Consequences
- Pros: Security and audit coverage; ecosystem familiarity.  
- Cons: Must track OZ Cairo upgrades; proxy pattern complexity.

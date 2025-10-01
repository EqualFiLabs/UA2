# ADR-002: Policy Storage = Arrays for allowlists

## Context
Session policies require allowlists for function selectors and target addresses.

## Decision
We store selectors and targets as **dynamic arrays** in v0.1.  
Validation loops check membership linearly.

## Alternatives
- Bitmaps or hashed sets: more gas-efficient, but adds complexity.  
- Off-chain bloom filters: not applicable for validation.

## Consequences
- Pros: Simplicity; easier for hackathon scope.  
- Cons: O(n) lookup cost; higher gas in worst case.  
- Mitigation: Document intent to upgrade to bitmaps in v0.2.

# ADR-003: SDK Foundation = starknet.js

## Context
SDK requires account abstraction, signing, and RPC provider integration.

## Decision
We build UA² SDK on **starknet.js** (v6+).  
- Mature ecosystem library.  
- Maintained by StarkWare and community.  
- Already supports PaymasterInterface.

## Alternatives
- starknet.py: useful but not ideal for browser SDK.  
- Custom RPC client: too heavy for hackathon scope.

## Consequences
- Pros: Standard; interop with starknet-react and wallets.  
- Cons: JS-only; Python/Rust wrappers deferred.

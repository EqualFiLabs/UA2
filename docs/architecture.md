# UA²-SDK: Architecture Overview

## High-Level Components

### On-chain (Cairo)
- **UA² Account** (inherits OpenZeppelin AccountComponent)
  - `SessionKeys` module
  - `Guardians` module
  - `KeyRotation` module
- **Storage Layout**
  - `owner_pubkey: felt252`
  - `guardians: LegacyMap<ContractAddress, bool>` + `guardian_count: u32` + `guardian_threshold: u8`
  - `recovery_delay: u64`
  - `recovery_active: bool`
  - `recovery_proposed_owner: felt252`
  - `recovery_eta: u64`
  - `recovery_confirms: LegacyMap<ContractAddress, bool>` + `recovery_confirm_count: u32`
  - `recovery_proposal_id: u64`
  - `recovery_guardian_last_confirm: LegacyMap<ContractAddress, u64>`
  - `session: Map<session_key_hash, SessionPolicy>`
  - `sessionTargetAllow: LegacyMap<(session_key_hash, ContractAddress), bool>`
  - `sessionSelectorAllow: LegacyMap<(session_key_hash, felt252), bool>`
  - `sessionNonce: Map<session_key_hash,u128>`

### Off-chain (TypeScript)
- **@ua2/core**
  - Wallet abstraction over starknet.js (Argent, Braavos, Cartridge, injected)
  - Session manager (create, revoke, list, use)
  - Paymaster adapter interface
- **@ua2/react**
  - Hooks for UI integration: `useAccount`, `useSessions`, `usePaymaster`
- **@ua2/paymasters**
  - Adapters for sponsor RPCs
- **@ua2/example**
  - Demo dApp + CLI

---

## Data Flows

### Deploy
1. User connects with wallet (Argent, Braavos, Cartridge).
2. SDK deploys UA² Account contract with `owner_pubkey`.

### Session Creation
1. SDK generates ephemeral ECDSA keypair.
2. UA² Account owner calls `addSession(key, policy)`.
3. Policy stored in contract; event emitted.

### Transaction with Session
1. User signs call with session key.
2. Contract’s `__validate__` enforces policy.
3. If allowed → execute; increment counters.

### Sponsored Tx
1. SDK wraps tx in Paymaster adapter.
2. Paymaster returns sponsored tx object.
3. Starknet node executes with provider covering fee.

### Recovery
1. Guardians propose new owner.
2. After delay, quorum executes recovery.
3. Owner rotated; event emitted.

---

## Trust Boundaries

- **On-chain enforcement:** Policies, guardians, rotation enforced in Cairo.
- **Off-chain helpers:** Key management, paymaster integration in SDK.
- **Wallet vendors:** Provide signing capabilities; not trusted with recovery or policies.
- **Paymasters:** Sponsor gas; not trusted with signing or recovery.


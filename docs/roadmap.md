# UA²-SDK • Roadmap
Status: Draft (Resolve Hackathon)

---

## v0.1 (Hackathon MVP)
- Cairo contracts: UA² Account with SessionKeys, Guardians, KeyRotation.
- TypeScript SDK: connect, session manager, paymaster adapters.
- Demo app: session create/use/revoke; paymaster flow; guardian recovery.
- Docs: RFC, Arch, Interfaces, Validation, Runbook, Test Plan, Threat Model, API, Demo Script.

---

## v0.2 (Post-hackathon hardening)
- Optimize allowlist storage (bitmaps/hashed sets).
- Expand test coverage with fuzz + property tests.
- Add default policy templates (ERC-20 only, NFT only).
- SDK: error typing and improved dev ergonomics.
- Proxy deployment via `ua2proxy.cairo` with runbook + env flag support.
- Avnu paymaster integration for Sepolia sponsorship.

---

## v0.3
- Implement `apply_session_usage` to synchronize on-chain counters with the SDK.
- WebAuthn session keys (passkeys).
- Guardian UX improvements: guardian list UI, guardian contract accounts.
- Multi-sig owner support (threshold m-of-n at owner level).
- More wallet connectors (mobile Argent/Braavos, WalletConnect).
- Additional paymaster adapters beyond Avnu (Infura sponsor, ecosystem partners).
- Further optimisation of session storage and calldata footprints.

---

## v0.4
- Formal verification of `__validate__`.
- Gas benchmarking and compression.
- SDK wrappers in Python/Rust.
- Deeper integration with Starknet ecosystem projects.

---

## Long-Term Vision
- UA² becomes the **standard AA patterns SDK** for Starknet.
- Adopted by wallets, games, DeFi protocols.
- Neutral, open-source infra for secure session keys, recovery, and gas sponsorship.
- Attracts contributors and maintainers beyond the hackathon.

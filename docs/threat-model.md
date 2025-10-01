# UA²-SDK • Threat Model
Status: Draft (Resolve Hackathon)

---

## Assets to Protect
- **Account ownership**: control of `owner_pubkey`.
- **Session policies**: integrity of expiry, allowlists, limits.
- **Guardian set**: integrity of quorum; protection against collusion.
- **Recovery flow**: safety against hostile takeover.
- **Paymaster flow**: prevention of gas griefing or arbitrary sponsorship.

---

## Assumptions
- Starknet L2 consensus and Cairo VM are secure.
- Wallets (Argent, Braavos, Cartridge) are not malicious, but may be buggy.
- Users may mishandle session keys (e.g., store in localStorage).
- Paymasters may censor or decline sponsorship; they cannot forge signatures.

---

## STRIDE Analysis

### Spoofing
- **Risk:** Fake session keys.  
- **Mitigation:** Contract checks signature vs registered session key hash; domain separation with chainId+accountAddr.

### Tampering
- **Risk:** Mutating policy storage.  
- **Mitigation:** Only owner can add sessions; events emitted for add/revoke.

### Repudiation
- **Risk:** No evidence of session use.  
- **Mitigation:** Emit `SessionUsed` with key hash and call count increment.

### Information Disclosure
- **Risk:** On-chain policy reveals allowed selectors/targets.  
- **Mitigation:** Acceptable in design; off-chain secret mgmt for private keys.

### Denial of Service
- **Risk:** Attacker floods session slots.  
- **Mitigation:** Per-owner only; contracts can enforce session count limits.

### Elevation of Privilege
- **Risk:** Guardian collusion or compromised quorum.  
- **Mitigation:** Timelock before execute; owner can cancel recovery before ETA.

---

## Additional Risks

- **Nonce replay:** Using old session signature repeatedly.  
  → Mitigation: `sessionNonce` increments in validation.

- **Paymaster abuse:** Malicious sponsor injects tx modifications.  
  → Mitigation: SDK only accepts sponsored txs that match preimage hash.

- **Upgrade risk:** Proxy admin compromise.  
  → Mitigation: Proxy admin separated from owner; pause switch and event logs.

---

## Residual Risks
- Social engineering: users may sign unsafe policies.  
- Guardian corruption: collusion > threshold is always a risk.  
- Paymaster reliance: external trust boundary.

---

## Threat Priorities
1. Unauthorized execution via session keys.  
2. Malicious or premature guardian recovery.  
3. Paymaster abuse altering call payloads.

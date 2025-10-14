# UA²-SDK • Demo Script
Status: Draft (Resolve Hackathon)

Goal: 6-minute live demo for judges

---

## 0:00 — Intro
- Explain problem: "AA is powerful but fragmented."
- Pitch: "I built UA²-SDK: session keys + guardians + paymasters behind one API."

---

## 0:30 — Connect & Deploy
- Open demo app.
- Connect wallet (Argent/Braavos).
- Deploy or attach UA² Account contract on Sepolia.
- Show owner address and empty session list.

---

## 1:30 — Create Session
- Create a session policy:
  - allow `transfer` on ERC20 test token,
  - cap 10 calls,
  - expire in 4 hours,
  - max 0.01 ETH per call.
- Show event in explorer: `SessionAdded`.

---

## 2:30 — Use Session
- Trigger ERC20 transfer (in-policy).
- Wallet popup does **not** appear (session signature used).
- Show explorer: `SessionUsed`.

---

## 3:30 — Policy Violation
- Try sending >0.01 ETH.
- Tx reverts with `ERR_VALUE_LIMIT_EXCEEDED`.

---

## 4:00 — Sponsored Tx
- Toggle “Gasless mode.”
- Same transfer runs via Paymaster adapter.
- Show explorer: tx covered by sponsor.

---

## 4:45 — Revoke
- Revoke session in UI.
- Retry transfer → fails with `ERR_SESSION_INACTIVE`.
- Show explorer: `SessionRevoked`.

---

## 5:15 — Recovery Flow
- Guardian account proposes recovery.
- Show recovery state and `eta`.
- Fast-forward (in hackathon build, use short delay).
- Execute recovery → owner rotates.
- Event: `RecoveryExecuted`.

---

## 6:00 — Wrap
- "I shipped contracts, the SDK, demo, tests, and docs. UA²-SDK makes Starknet AA usable today."
- Invite collaboration: "Wallets, dApps, games — you can adopt this tomorrow."

---

## Demo Checklist (commands & expected output)

| Step | Command | Expect |
| --- | --- | --- |
| Bootstrap env | `npm ci` | Installs workspaces without errors |
| Devnet control run | `npm run e2e:devnet` | `E2E (devnet): … ✓` summary |
| Sepolia sponsored run | `export $(grep -v '^#' .env.sepolia | xargs)`<br>`npm run e2e:sepolia` | `[paymaster] AVNU available …` and `UA² sepolia e2e PASS ✅` |
| Fallback drill | `PAYMASTER_URL=http://127.0.0.1:9999 npm run e2e:sepolia` | `[paymaster] AVNU unavailable…` log + successful completion |
| Front-end demo | `npm run dev --workspace @ua2/example` | Vite dev server prints local URL |

Print the checklist and tick each row live while narrating the expected output to judges.

---

## Appendix — Capturing the UI Screenshot
- Run `npm install` from the monorepo root to ensure dependencies are present.
- Start the Vite dev server with `npm run dev --workspace @ua2/example -- --host 0.0.0.0 --port 4173`.
- From another shell, capture the current dark theme state with `npx playwright@1.45.3 screenshot http://127.0.0.1:4173 docs/demo-dark-theme.png`.
- Commit the generated `docs/demo-dark-theme.png` so reviewers can verify the styling without rebuilding the demo locally.

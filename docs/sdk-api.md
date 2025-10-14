# UA²-SDK • TypeScript API Reference
Status: Draft (Resolve Hackathon)

---

## Install
```bash
npm install @ua2/core @ua2/react @ua2/paymasters
```

---

## UA² Core

### connect(options)

```ts
const ua = await UA2.connect({
  preferred: ['argent','braavos','cartridge'],
  fallback: true
});
```

Returns a `UA2Client` bound to chosen wallet provider.

---

### sessions.create(policy)

```ts
const sess = await ua.sessions.create({
  validAfter: Math.floor(Date.now() / 1000),
  validUntil: nowPlusHours(4),
  allow: {
    targets: [erc20.address],
    selectors: [erc20.interface.getFunction('transfer').selector],
  },
  limits: {
    maxCalls: 10,
    maxValuePerCall: toUint256('10000000000000000'), // 0.01 ETH
  },
  validAfter: Math.floor(Date.now() / 1000),
  validUntil: Math.floor(Date.now() / 1000) + 4 * 3600,
});

// `resolvePolicy` ensures validUntil > validAfter and normalizes Uint256 calldata.
```

---

### sessions.revoke(sessionId)

```ts
await ua.sessions.revoke(sess.id);
```

### sessions.use(sessionId)

```ts
const usage = await ua.sessions.use(sess.id);
usage.ensureAllowed({ to: erc20.address, selector: TRANSFER, calldata: [recipient, amount] });
```

Throws `SessionExpired` or `PolicyViolation` if the session is inactive, expired, or the call breaks the policy.

### sessions.guard()

```ts
const policy = UA2.sessions.guard({ maxCalls: 5, expiresInSeconds: 3600 })
  .targets([erc20.address])
  .selector(TRANSFER)
  .maxValue('10000000000000000')
  .build();

// Guard builder accepts legacy `expiresInSeconds`/`expiresAt` aliases but
// produces policies with `validAfter`/`validUntil` under the hood.
```

---

### withPaymaster(provider)

```ts
import { UA2 } from '@ua2/core';

const pm = UA2.paymasters.noop(); // devnet/local defaults
const runner = ua.withPaymaster(pm, { transport, ua2Address: account.address });

const tx = await runner.call(contract.address, contract.selector('doThing'), [arg1, arg2]);
```

For Sepolia sponsorship via AVNU, request an adapter and call it directly when constructing your transaction batch:

```ts
const avnu = UA2.paymasters.avnu({
  url: 'https://sepolia.paymaster.avnu.fi',
  apiKey: process.env.PAYMASTER_API_KEY,
  defaultGasToken: process.env.GAS_TOKEN, // required for `mode: "default"`
});

if (await avnu.isAvailable()) {
  const result = await avnu.sponsor(account, calls, 'sponsored');
  console.log('Sponsored hash', result.transaction_hash);
} else {
  console.warn('AVNU unavailable – fall back to UA2.paymasters.noop()');
}
```

---

## UA² React

### useAccount()

```ts
const { account, connect, disconnect } = useAccount();
```

### useSessions()

```ts
const { sessions, create, revoke, refresh } = useSessions();
```

### usePaymaster()

```ts
const { execute, call, sponsorName } = usePaymaster({
  ua2Address: account.address,
  transport,
  paymaster: UA2.paymasters.from('cartridge'),
});
```

---

## UA² Paymasters

### paymasters helpers

```ts
const noop = UA2.paymasters.noop();
const avnu = UA2.paymasters.avnu({ url, apiKey, defaultGasToken });
```

- `noop()` → returns the in-memory sponsor used for devnet/local runs. It simply echoes the transaction back.
- `avnu(opts)` → returns an [`AvnuPaymaster`](../packages/paymasters/src/avnu.ts) wired to AVNU's Starknet paymaster RPC.
  - `opts.url` (default `https://sepolia.paymaster.avnu.fi`)
  - `opts.apiKey` (optional HTTP header)
  - `opts.defaultGasToken` (ERC-20 felt, required when using `mode: "default"` token-fee flows)
  - Call `await avnu.isAvailable()` before attempting sponsorship.
  - Use `avnu.sponsor(account, calls, mode, gasToken)` with `mode` in `"sponsored" | "default"`.

`UA2.paymasters.from(id)` still supports legacy strings (e.g., `noop`, `cartridge`, `starknet-react:demo`, `avnu`). Devnet defaults to `noop`, while Sepolia demonstrations can switch to AVNU by exporting the paymaster env variables documented in the runbook.

---

## SDK Errors

* `UA2Error: ProviderUnavailable`
* `UA2Error: SessionExpired`
* `UA2Error: PolicyViolation(selector|target|value|calls)`
* `UA2Error: PaymasterDenied`
* `UA2.errors.mapContractError(error)` → helper that maps Cairo revert strings (`ERR_*`) to the classes above.

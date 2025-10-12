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
  allow: {
    targets: [erc20.address],
    selectors: [erc20.interface.getFunction('transfer').selector],
  },
  limits: {
    maxCalls: 10,
    maxValuePerCall: toUint256("10000000000000000") // 0.01 ETH
  },
  expiresAt: nowPlusHours(4),
});
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
```

---

### withPaymaster(provider)

```ts
const pm = UA2.paymasters.from('starknet-react:xyz');
const runner = ua.withPaymaster(pm, { transport, ua2Address: account.address });

const tx = await runner.call(contract.address, contract.selector('doThing'), [arg1, arg2]);
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

### interface Paymaster

```ts
export interface Paymaster {
  name: string;
  sponsor(tx: AccountTransaction): Promise<SponsoredTx>;
}
```

### Example: Cartridge Adapter

```ts
const pm = UA2.paymasters.from('cartridge');
await pm.sponsor(tx);
```

---

## SDK Errors

* `UA2Error: ProviderUnavailable`
* `UA2Error: SessionExpired`
* `UA2Error: PolicyViolation(selector|target|value|calls)`
* `UA2Error: PaymasterDenied`

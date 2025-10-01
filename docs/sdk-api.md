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

---

### withPaymaster(provider)

```ts
const pm = UA2.paymasters.from("starknet-react:xyz");

const tx = await ua.withPaymaster(pm).call(
  contract,
  "doThing",
  [arg1, arg2]
);
```

---

## UA² React

### useAccount()

```ts
const { account, connect, disconnect } = useAccount();
```

### useSessions()

```ts
const { sessions, create, revoke } = useSessions();
```

### usePaymaster()

```ts
const { sponsor, status } = usePaymaster("starknet-react:xyz");
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
const pm = UA2.paymasters.from("cartridge");
await pm.sponsor(tx);
```

---

## SDK Errors

* `UA2Error: ProviderUnavailable`
* `UA2Error: SessionExpired`
* `UA2Error: PolicyViolation(selector|target|value)`
* `UA2Error: PaymasterDenied`

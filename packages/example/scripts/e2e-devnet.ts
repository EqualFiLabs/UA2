// packages/example/scripts/e2e-devnet.ts
/* eslint-disable no-console */
import { execa } from "execa";
import assert from "node:assert/strict";

const RPC = process.env.RPC ?? "http://127.0.0.1:5050";
const ACCOUNT = process.env.ACCOUNT_NAME ?? "devnet";
const UA2_ADDR = process.env.UA2_ADDR; // 0x.. deployed UA2 account (impl or proxy)

if (!UA2_ADDR) {
  console.error("UA2_ADDR is required. Export UA2_ADDR=0x... then rerun.");
  process.exit(1);
}

type SncastOpts = { args: string[]; expectOk?: boolean; quiet?: boolean };

async function sncast({ args, expectOk = true, quiet = false }: SncastOpts) {
  const cmd = ["sncast", "--account", ACCOUNT, ...args, "--url", RPC];
  const p = execa(cmd[0], cmd.slice(1), { reject: false });
  let out = "";
  p.stdout?.on("data", (d) => (out += d.toString()));
  p.stderr?.on("data", (d) => (out += d.toString()));
  const { exitCode } = await p;
  if (!quiet) console.log(out.trim());
  if (expectOk && exitCode !== 0) {
    throw new Error(`sncast failed: ${cmd.join(" ")}` + `\n${out}`);
  }
  return { exitCode, out };
}

async function call(functionName: string, calldata?: string[]) {
  const args = ["call", "--address", UA2_ADDR!, "--function", functionName];
  if (calldata && calldata.length) args.push("--calldata", ...calldata);
  return sncast({ args });
}

async function invoke(functionName: string, calldata: string[], maxFeeFRI = "20000000000000000") {
  const args = [
    "invoke",
    "--address",
    UA2_ADDR!,
    "--function",
    functionName,
    "--calldata",
    ...calldata,
    "--max-fee",
    maxFeeFRI,
  ];
  return sncast({ args });
}

function hr(label: string) {
  console.log(`\n=== ${label} ===`);
}

(async () => {
  console.log(`RPC=${RPC}  ACCOUNT=${ACCOUNT}  UA2_ADDR=${UA2_ADDR}`);

  // 0) get owner (zero-arg view: DO NOT pass --calldata "")
  hr("owner");
  await call("get_owner");

  // 1) add a tight session: valid for ~8h,  max 1 call, tiny value cap,
  //    allow exactly one target+selector
  // NOTE: adjust to your real ABI order/types!
  // Example calldata layout:
  // [session_pubkey,
  //  valid_after, valid_until,
  //  max_calls, max_value_low, max_value_high,
  //  targets_len, <targets...>,
  //  selectors_len, <selectors...>]
  //
  // Use a throwaway felt for session key (dev only). Replace with real key if needed.
  const nowSec = Math.floor(Date.now() / 1000);
  const validAfter = String(nowSec);
  const validUntil = String(nowSec + 8 * 3600);

  // Example: policy allows calling MockERC20.transfer on address MOCK_ERC20
  const MOCK_ERC20 = process.env.MOCK_ERC20 ?? "0x0123"; // replace with your deployed mock or a real target
  const SELECTOR_TRANSFER =
    process.env.SELECTOR_TRANSFER ??
    "0x00a9059cbb000000000000000000000000000000000000000000000000000000"; // placeholder; use starkli selector if needed

  const SESSION_PUBKEY = process.env.SESSION_PUBKEY ?? "0x123"; // dev only
  const MAX_CALLS = "1";
  const MAX_VALUE_LOW = "0"; // Uint256 low
  const MAX_VALUE_HIGH = "0"; // Uint256 high (0 means “no value transfer allowed” in this sketch)

  hr("add_session");
  await invoke("add_session", [
    SESSION_PUBKEY,
    validAfter,
    validUntil,
    MAX_CALLS,
    MAX_VALUE_LOW,
    MAX_VALUE_HIGH,
    "1",
    MOCK_ERC20,
    "1",
    SELECTOR_TRANSFER,
  ]);

  // 2) in-policy call succeeds (whatever function your UA2 exposes to exercise Policy)
  // If your test target is external (e.g., ERC20.transfer), you'd invoke via the UA2 account’s multicall.
  // For illustration, we assume UA2 exposes a helper `try_transfer_mock(to, amount)` that forwards.
  hr("in-policy call should succeed");
  await invoke("try_transfer_mock", ["0xCAFE", "1"]); // adjust to your demo helper

  // 3) out-of-policy call reverts: wrong selector or target
  // Example: try transferFrom (selector not in allowlist) → expect nonzero exit
  const SELECTOR_TRANSFER_FROM =
    process.env.SELECTOR_TRANSFER_FROM ??
    "0x23b872dd00000000000000000000000000000000000000000000000000000000"; // placeholder
  hr("out-of-policy call should REVERT");
  const bad = await sncast({
    args: [
      "invoke",
      "--address",
      UA2_ADDR!,
      "--function",
      "try_transfer_from_mock",
      "--calldata",
      "0xDEAD", // from
      "0xBEEF", // to
      "2", // amount > cap
      "--max-fee",
      "20000000000000000",
    ],
    expectOk: false,
  });
  assert.notEqual(bad.exitCode, 0, "Expected out-of-policy invoke to fail");

  // 4) revoke → subsequent in-policy call must revert
  hr("revoke_session");
  await invoke("revoke_session", [SESSION_PUBKEY]);

  hr("in-policy call after revoke should REVERT");
  const afterRevoke = await sncast({
    args: [
      "invoke",
      "--address",
      UA2_ADDR!,
      "--function",
      "try_transfer_mock",
      "--calldata",
      "0xCAFE",
      "1",
      "--max-fee",
      "20000000000000000",
    ],
    expectOk: false,
  });
  assert.notEqual(afterRevoke.exitCode, 0, "Expected revoked session invoke to fail");

  console.log("\nE2E PASS ✅");
})().catch((err) => {
  console.error("\nE2E FAIL ❌");
  console.error(err?.stack ?? String(err));
  process.exit(1);
});

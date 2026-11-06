import assert from "node:assert/strict";
import test from "node:test";
import { resolveSolanaRpcUrl, solanaRpcFetch } from "../solanaRpcConfig";

test("static RPC configuration accepts public HTTPS and loopback, and rejects embedded credentials", () => {
  assert.equal(resolveSolanaRpcUrl(), "https://api.devnet.solana.com/");
  assert.equal(
    resolveSolanaRpcUrl("http://127.0.0.1:8899"),
    "http://127.0.0.1:8899/",
  );
  for (const url of [
    "http://example.com",
    "https://user:password@example.com",
    "https://example.com/#private",
  ]) {
    assert.throws(() => resolveSolanaRpcUrl(url));
  }
});

test("a rate-limited default public read can use the second public Devnet provider", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: calls.length === 1 ? 429 : 200 });
  }) as typeof fetch;
  try {
    const response = await solanaRpcFetch("https://api.devnet.solana.com/", {
      method: "POST",
      body: JSON.stringify({ method: "getGenesisHash" }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(calls, [
      "https://api.devnet.solana.com/",
      "https://solana-devnet.api.onfinality.io/public",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

test("a failed broadcast is returned once without provider failover or retry", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: 429 });
  }) as typeof fetch;
  try {
    const response = await solanaRpcFetch("https://api.devnet.solana.com/", {
      method: "POST",
      body: JSON.stringify({ method: "sendTransaction" }),
    });
    assert.equal(response.status, 429);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("custom RPC read retries preserve their configured endpoint", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response("{}", { status: calls.length === 1 ? 503 : 200 });
  }) as typeof fetch;
  try {
    await solanaRpcFetch("https://example.com/devnet", {
      method: "POST",
      body: JSON.stringify({ method: "getBalance" }),
    });
    assert.deepEqual(calls, [
      "https://example.com/devnet",
      "https://example.com/devnet",
    ]);
  } finally {
    globalThis.fetch = original;
  }
});

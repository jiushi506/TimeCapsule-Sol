const MIN_REQUEST_GAP_MS = 400;
// Space broadcasts without replaying a signed transaction after a failed response.
const MIN_SEND_REQUEST_GAP_MS = 1_100;
const MAX_RATE_LIMIT_RETRIES = 3;
const MAX_RETRY_AFTER_MS = 10_000;
const BASE_RETRY_DELAY_MS = 750;
const DEFAULT_PUBLIC_RPC = "https://api.devnet.solana.com/";
const PUBLIC_READ_FALLBACK = "https://solana-devnet.api.onfinality.io/public";

let requestTail: Promise<void> = Promise.resolve();
let nextRequestAt = 0;

function getRequestSignal(
  input: RequestInfo | URL,
  init?: RequestInit,
): AbortSignal | undefined {
  if (init?.signal) return init.signal;
  return typeof Request !== "undefined" && input instanceof Request
    ? input.signal
    : undefined;
}

function rpcMethods(body: BodyInit | null | undefined): string[] | null {
  if (typeof body !== "string") return null;
  try {
    const payload: unknown = JSON.parse(body);
    const requests = Array.isArray(payload) ? payload : [payload];
    if (
      !requests.length ||
      requests.some(
        (request) =>
          !request ||
          typeof request !== "object" ||
          typeof (request as { method?: unknown }).method !== "string",
      )
    )
      return null;
    return requests.map((request) => (request as { method: string }).method);
  } catch {
    return null;
  }
}

function retryAfterMs(response: Response): number {
  const value = response.headers.get("retry-after");
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0)
    return Math.min(seconds * 1_000, MAX_RETRY_AFTER_MS);
  const date = Date.parse(value);
  return Number.isFinite(date)
    ? Math.min(Math.max(date - Date.now(), 0), MAX_RETRY_AFTER_MS)
    : 0;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted)
    return Promise.reject(
      new DOMException("The operation was aborted.", "AbortError"),
    );
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Serialize app RPC traffic and retry transient failures only for reads. */
export function solanaRpcFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const methods = rpcMethods(init?.body);
  const canRetry = Boolean(
    methods?.length &&
    methods.every((method) =>
      /^(get[A-Z]|isBlockhashValid$|minimumLedgerSlot$)/.test(method),
    ),
  );
  const inputUrl =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const usesDefault = new URL(inputUrl).href === DEFAULT_PUBLIC_RPC;
  const signal = getRequestSignal(input, init);
  const scheduled = requestTail.then(async () => {
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted)
        throw new DOMException("The operation was aborted.", "AbortError");
      const waitForGap = Math.max(0, nextRequestAt - Date.now());
      if (waitForGap) await abortableDelay(waitForGap, signal);
      if (signal?.aborted)
        throw new DOMException("The operation was aborted.", "AbortError");
      const minimumGap = methods?.includes("sendTransaction")
        ? MIN_SEND_REQUEST_GAP_MS
        : MIN_REQUEST_GAP_MS;
      nextRequestAt = Date.now() + minimumGap;

      let response: Response;
      try {
        // Only public default reads can move to the second public Devnet provider.
        // A custom endpoint is preserved, and a broadcast is never replayed.
        const endpoint =
          canRetry && usesDefault && attempt % 2 === 1
            ? PUBLIC_READ_FALLBACK
            : input;
        response = await fetch(endpoint, init);
      } catch (cause) {
        if (!canRetry || attempt >= MAX_RATE_LIMIT_RETRIES || signal?.aborted)
          throw cause;
        await abortableDelay(BASE_RETRY_DELAY_MS * 2 ** attempt, signal);
        continue;
      }
      const shouldRetry =
        canRetry &&
        attempt < MAX_RATE_LIMIT_RETRIES &&
        (response.status === 429 || response.status >= 500);
      if (!shouldRetry) return response;

      const delay =
        retryAfterMs(response) || BASE_RETRY_DELAY_MS * 2 ** attempt;
      await response.body?.cancel().catch(() => {});
      await abortableDelay(delay, signal);
    }
  });
  requestTail = scheduled.then(
    () => undefined,
    () => undefined,
  );
  return scheduled;
}

/** A static website connects directly to a public, browser-compatible Devnet RPC. */
export function resolveSolanaRpcUrl(rawUrl?: string): string {
  const configured = (import.meta as { env?: Record<string, string> }).env
    ?.VITE_SOLANA_RPC_URL;
  const url = new URL(rawUrl || configured || "https://api.devnet.solana.com");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "Use a public HTTPS Devnet RPC URL without embedded credentials.",
    );
  }
  return url.toString();
}
export const SOLANA_DEVNET_RPC_URL = resolveSolanaRpcUrl();

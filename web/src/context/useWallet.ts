import { useCallback, useEffect, useRef, useState } from "react";
import {
  connectPhantomSolana,
  getPhantomSolanaProvider,
  solanaPublicKeyString,
  subscribePhantomSolana,
  type PhantomSolanaProvider,
} from "./solanaWalletUtils";
import { requestSolanaWallet } from "../services/solanaTransactionConfirmation";

export function useWallet() {
  const [owner, setOwner] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const provider = useRef<PhantomSolanaProvider | null>(null);
  const version = useRef(0);
  const unsubscribe = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      version.current++;
      unsubscribe.current?.();
    },
    [],
  );

  const connect = useCallback(async () => {
    if (connecting) return;
    const wallet = getPhantomSolanaProvider(
      window as unknown as Parameters<typeof getPhantomSolanaProvider>[0],
    );
    if (!wallet) {
      setError(
        "Install Phantom, then open this page in a browser with the extension enabled.",
      );
      return;
    }
    const attempt = ++version.current;
    setConnecting(true);
    setError("");
    try {
      const address = await requestSolanaWallet(wallet, () =>
        connectPhantomSolana(wallet),
      );
      if (attempt !== version.current) return;
      unsubscribe.current?.();
      provider.current = wallet;
      setOwner(address);
      unsubscribe.current = subscribePhantomSolana(wallet, {
        accountChanged: (key) => {
          version.current++;
          setOwner(solanaPublicKeyString(key) ?? "");
        },
        disconnect: () => {
          version.current++;
          setOwner("");
          provider.current = null;
        },
      });
    } catch (cause) {
      if (attempt === version.current)
        setError(
          cause instanceof Error ? cause.message : "Wallet connection failed.",
        );
    } finally {
      setConnecting(false);
    }
  }, [connecting]);

  const disconnect = useCallback(() => {
    version.current++;
    unsubscribe.current?.();
    unsubscribe.current = null;
    const wallet = provider.current;
    provider.current = null;
    setOwner("");
    setError("");
    void Promise.resolve()
      .then(() => wallet?.disconnect?.())
      .catch(() => {});
  }, []);
  return { owner, provider, connecting, error, connect, disconnect };
}

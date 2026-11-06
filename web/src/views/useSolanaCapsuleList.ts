import { useCallback, useEffect, useRef, useState } from "react";
import {
  fetchIndexedSolanaCapsules,
  type IndexedSolanaCapsuleMetadata,
} from "../services/solanaPublicCapsuleIndex";
import { formatSolanaError } from "../services/solanaCapsuleService";
export function useSolanaCapsuleList(
  scope: "owner" | "public",
  owner?: string | null,
) {
  const [capsules, setCapsules] = useState<IndexedSolanaCapsuleMetadata[]>([]);
  const [isLoading, setIsLoading] = useState(scope === "public" || !!owner);
  const [error, setError] = useState<string | null>(null);
  const [indexStatus, setIndexStatus] = useState<
    "unknown" | "available" | "unavailable"
  >("unknown");
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++request.current;
    setCapsules([]);
    setError(null);
    if (scope === "owner" && !owner) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const result = await fetchIndexedSolanaCapsules(
        scope === "owner" ? { ownerAddress: owner! } : {},
      );
      if (version === request.current) {
        setCapsules(result.capsules);
        setIndexStatus("available");
      }
    } catch (cause) {
      if (version === request.current) {
        setError(formatSolanaError(cause, "Could not read Solana accounts."));
        setIndexStatus("unavailable");
      }
    } finally {
      if (version === request.current) setIsLoading(false);
    }
  }, [scope, owner]);
  useEffect(() => {
    void refresh();
    return () => {
      request.current++;
    };
  }, [refresh]);
  return {
    capsules,
    isLoading,
    error,
    indexStatus,
    indexCoverage: "direct Solana RPC",
    refresh,
  };
}

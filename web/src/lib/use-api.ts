"use client";

// Loads data from the local data layer (src/data/repo.ts) for a component. Rebuilt for CP8b without
// the old login redirect: there is no account, so every failure is shown where it happened.

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "@/lib/api";

export type LoadState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiError }
  | { status: "ready"; data: T };

/**
 * Run `load`, re-running it when `key` changes or `reload` is called.
 *
 * @param load Starts the load; a rejection that is not an ApiError becomes "unexpected_error".
 * @param key Identifies what `load` loads; a new key starts a new load.
 * @returns The load's state and a `reload` function.
 */
export function useApiData<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<LoadState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (data) => {
        if (!cancelled) setState({ status: "ready", data });
      },
      (error: unknown) => {
        if (cancelled) return;
        const apiError =
          error instanceof ApiError
            ? error
            : new ApiError(0, "unexpected_error", "Something went wrong. Please try again.");
        setState({ status: "error", error: apiError });
      },
    );
    return () => {
      cancelled = true;
    };
    // `load` is recreated on every render; `key` identifies what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const reload = useCallback(() => {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);

  return { state, reload };
}

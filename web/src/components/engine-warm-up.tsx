"use client";

import { useEffect } from "react";
import { warmUp } from "@/lib/api";

/**
 * Starts the statement engine and loads pandas in the background as soon as the app opens, so the
 * first statement does not wait for them (CP8b item 4). Renders nothing and never blocks the page.
 *
 * @returns Nothing.
 */
export function EngineWarmUp() {
  useEffect(() => {
    void warmUp();
  }, []);
  return null;
}

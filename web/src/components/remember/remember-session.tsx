"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { noteRememberActivity, rememberView, startRemember, subscribeRemember } from "@/lib/remember";

/** Screens that show saved statements: while locked they send the person to unlock first. */
const DATA_ROUTES = ["/analysis-summary", "/overview", "/ledger", "/breakdown"];

/**
 * Starts "Remember on this device" once per page load (CP9c): opens the vault (writing nothing),
 * counts taps and keys as activity for the idle lock, and when it locks, or a data screen opens
 * while it is locked, goes to the unlock screen so no saved data stays on screen.
 *
 * @returns Nothing visible.
 */
export function RememberSession() {
  const router = useRouter();
  const pathname = usePathname();
  const lastPhase = useRef(rememberView().phase);

  useEffect(() => {
    void startRemember();
    const activity = () => noteRememberActivity();
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, []);

  useEffect(() => {
    const follow = () => {
      const phase = rememberView().phase;
      const onDataRoute = DATA_ROUTES.some((route) => (pathname ?? "").startsWith(route));
      const justLocked = lastPhase.current === "unlocked" && phase === "locked";
      lastPhase.current = phase;
      if (phase === "locked" && (justLocked || onDataRoute)) router.replace("/unlock");
    };
    follow();
    return subscribeRemember(follow);
  }, [pathname, router]);

  return null;
}

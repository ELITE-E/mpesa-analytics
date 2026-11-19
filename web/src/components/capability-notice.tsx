"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icon";
import { capabilities as copy, capabilityNames, verifiedOn } from "@/content/capabilities";
import { checkBrowser, type BrowserCheck } from "@/lib/capabilities";

/**
 * What the capability check found, in plain words (CP10a item 2): the missing capabilities by
 * name, or that the app runs memory-only; nothing when everything is there.
 *
 * @param props.result The check's result.
 * @returns The notice, or nothing.
 */
export function CapabilityNotice({ result }: { result: BrowserCheck }) {
  if (result.missing.length > 0) {
    return (
      <div role="alert" className="mx-4 mt-20 rounded-xl border border-hairline bg-surface-container-lowest p-4 space-y-2" data-capability-notice="">
        <div className="flex items-center gap-2">
          <Icon name="warning" size={18} className="text-error" />
          <p className="font-headline text-sm font-semibold text-on-surface">{copy.title}</p>
        </div>
        <p className="font-body text-xs text-on-surface-variant">{copy.body}</p>
        <ul className="list-disc pl-5 font-body text-xs text-on-surface">
          {result.missing.map((name) => (
            <li key={name}>{capabilityNames[name]}</li>
          ))}
        </ul>
        <p className="font-body text-xs text-on-surface-variant">
          {copy.advice} {verifiedOn}
        </p>
      </div>
    );
  }
  if (!result.storage) {
    return (
      <p role="status" className="mx-4 mt-20 rounded-lg bg-surface-container-low p-3 font-body text-xs text-on-surface" data-capability-notice="">
        {copy.memoryOnly}
      </p>
    );
  }
  return null;
}

/**
 * Runs the capability check once the page is in the browser and shows what it found.
 *
 * @returns The notice, or nothing.
 */
export function CapabilityCheck() {
  const [result, setResult] = useState<BrowserCheck | null>(null);
  useEffect(() => {
    const check = async () => setResult(checkBrowser());
    void check();
  }, []);
  return result ? <CapabilityNotice result={result} /> : null;
}

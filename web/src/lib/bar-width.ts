// Bar widths as classes rather than style attributes, so the CSP's style-src 'self' holds in the
// pre-rendered HTML (CP8b). globals.css asks Tailwind for every w-[0%] to w-[100%].

/**
 * The width class for a bar filling `percent` of its track, to the whole percent.
 *
 * @param percent The share, 0 to 100; null or undefined is an empty bar.
 * @returns A class such as "w-[37%]".
 */
export function barWidthClass(percent: number | null | undefined): string {
  const whole = Math.min(100, Math.max(0, Math.round(percent ?? 0)));
  return `w-[${whole}%]`;
}

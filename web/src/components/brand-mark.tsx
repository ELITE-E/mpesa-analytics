/**
 * The app's mark: the same three rising bars as public/icon.svg, drawn inline in the current text
 * colour on the badge its container paints, so each header keeps its own token pair. Decorative:
 * the name beside it is the accessible label.
 *
 * @param props.size Its width and height in px.
 * @param props.className Classes for the SVG.
 * @returns The SVG.
 */
export function BrandMark({ size, className = "" }: { size: number; className?: string }) {
  return (
    <svg
      data-brand-mark=""
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="96 128 320 304"
      fill="currentColor"
      className={`inline-block shrink-0 ${className}`}
    >
      <rect x="128" y="300" width="56" height="100" rx="8" />
      <rect x="228" y="236" width="56" height="164" rx="8" />
      <rect x="328" y="160" width="56" height="240" rx="8" />
    </svg>
  );
}

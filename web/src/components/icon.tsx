import { EXTRA_ICONS } from "@/components/icon-extra";
import { ICON_PATHS } from "@/components/icon-paths";

type IconProps = {
  /** Material Symbols name, e.g. "cloud_upload". */
  name: string;
  /** Size in px. */
  size: number;
  /** The filled glyph instead of the outlined one. */
  filled?: boolean;
  className?: string;
};

/** The Material Symbols pack's drawing box. */
const VIEW_BOX = "0 -960 960 960";

/**
 * A Material Symbols icon, decorative (aria-hidden), drawn as inline SVG in the current text
 * colour (CP8b). It replaced the icon font: no font is fetched and no style attribute is set, so the
 * CSP's style-src 'self' holds. Same props as before, so every caller is unchanged.
 *
 * @param props.name The icon's name.
 * @param props.size Its width and height in px.
 * @param props.filled Draw the filled glyph.
 * @param props.className Classes for the SVG.
 * @returns The SVG; an empty one for a name the pack does not hold.
 */
export function Icon({ name, size, filled = false, className = "" }: IconProps) {
  const extra = EXTRA_ICONS[name];
  const paths = ICON_PATHS[name] ?? extra?.paths;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox={extra?.viewBox ?? VIEW_BOX}
      fill="currentColor"
      className={`inline-block shrink-0 ${className}`}
    >
      {paths ? <path d={filled ? paths[1] : paths[0]} /> : null}
    </svg>
  );
}

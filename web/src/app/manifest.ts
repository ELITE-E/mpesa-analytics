import type { MetadataRoute } from "next";
import { APP_NAME } from "@/content/brand";

// A static export writes this once, at build time, to out/manifest.webmanifest.
export const dynamic = "force-static";

/**
 * The web manifest, named from brand.ts, in the palette's colours (primary #065f46 for the theme,
 * surface #f8fafc behind the splash). Its icons come from scripts/build_app_icons.mjs.
 *
 * @returns The manifest.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "Read your mobile-money statement in this browser and see where the money went.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#065f46",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

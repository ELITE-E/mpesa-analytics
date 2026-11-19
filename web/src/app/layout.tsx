import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { EngineWarmUp } from "@/components/engine-warm-up";
import { CapabilityCheck } from "@/components/capability-notice";
import { ServiceWorkerSetup } from "@/components/update-prompt";
import { RememberSession } from "@/components/remember/remember-session";
import "./globals.css";

// The same families and weights the Stitch screens load.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta-sans",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
});

export const metadata: Metadata = {
  title: "M-Pesa Analytics",
  description: "Turn your M-Pesa statement into a clear picture of your money.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * Every page is prerendered at build time (static export); the host's CSP allows its inline
 * scripts by hash (scripts/postbuild.mjs). Icons are inline SVG (components/icon.tsx), so no icon
 * font is fetched.
 */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plusJakartaSans.variable} ${jetBrainsMono.variable}`}
    >
      <body className="bg-surface font-body text-on-surface antialiased min-h-screen flex flex-col">
        <EngineWarmUp />
        <RememberSession />
        <CapabilityCheck />
        <ServiceWorkerSetup />
        {children}
      </body>
    </html>
  );
}

import path from "node:path";
import type { NextConfig } from "next";

// A static export (CP8b): plain files any static host can serve, with no server code. The
// statement engine runs in the browser, so there is no API to point at. Security headers, the CSP
// included, come from the host; scripts/postbuild.mjs writes them per route (out/_headers).
const nextConfig: NextConfig = {
  output: "export",
  // Each route is a page file (ledger.html served at /ledger), keeping the prototype's own URLs
  // (CP8b, ADR 0015); static hosts serve these with their usual clean URLs.
  trailingSlash: false,
  poweredByHeader: false,
  images: { unoptimized: true },
  // The data layer imports the engine client from pdf_reader/, one level above this app.
  turbopack: { root: path.join(import.meta.dirname, "..") },
};

export default nextConfig;

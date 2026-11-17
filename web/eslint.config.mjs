import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // ADR 0014: this config lints the app (src/, tests/) with ESLint 9. Everything else in web/ is
    // the repo's root ESLint 10's: the harness, the probe and the build scripts. public/ holds
    // vendored and generated files.
    "public/**",
    "harness/**",
    "probe/**",
    "scripts/**",
    "src/components/icon-paths.ts",
  ]),
]);

export default eslintConfig;

// Applies docs/CODING_STANDARDS.md to JS and TS. Inline callbacks are treated like Python
// lambdas: they cannot sensibly carry a contract, so only named functions need JSDoc.
import jsdoc from "eslint-plugin-jsdoc";
import tseslint from "typescript-eslint";

const SOURCE_FILES = ["engine/**/*.{js,mjs,ts}", "web/**/*.{js,mjs,ts}", "tools/**/*.{js,mjs,ts}"];
const BANNED_NAMES = [
  "data",
  "result",
  "temp",
  "tmp",
  "info",
  "item",
  "obj",
  "ref",
  "flag",
  "res",
  "ret",
  "val",
  "import_mpesa_statement",
];

export default [
  { ignores: ["web/public/vendor/**", "node_modules/**", ".cache/**", ".venv/**"] },
  {
    files: SOURCE_FILES,
    languageOptions: { parser: tseslint.parser, ecmaVersion: "latest", sourceType: "module" },
    plugins: { jsdoc, "@typescript-eslint": tseslint.plugin },
    rules: {
      "jsdoc/require-jsdoc": [
        "error",
        {
          require: {
            FunctionDeclaration: true,
            MethodDefinition: true,
            ClassDeclaration: true,
          },
          contexts: [
            "VariableDeclarator > ArrowFunctionExpression",
            "VariableDeclarator > FunctionExpression",
          ],
        },
      ],
      "jsdoc/require-param": "error",
      "jsdoc/require-returns": "error",
      "jsdoc/require-throws": "error",
      "max-params": ["error", 5],
      complexity: ["error", 10],
      "max-depth": ["error", 3],
      "no-empty": "error",
      "id-denylist": ["error", ...BANNED_NAMES],
      "id-length": [
        "error",
        { min: 2, exceptions: ["i", "j", "k", "x", "y", "_"], properties: "never" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Engine and bridge code handles statement data, so it must never reach the console.
    files: ["engine/**/*.{js,mjs,ts}"],
    rules: { "no-console": "error" },
  },
];

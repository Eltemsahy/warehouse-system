import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  { ignores: ["dist", "coverage", "node_modules", "apps/web-admin"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "error",
    },
  },
  // Plain Node scripts have no TypeScript to supply globals, so name the ones they use.
  // (typescript-eslint sets sourceType "module" for every file, so .cjs gets none for free.)
  { files: ["**/*.mjs"], languageOptions: { globals: { console: "readonly" } } },
  {
    files: ["**/*.cjs"],
    languageOptions: { globals: { module: "writable", require: "readonly" } },
  },
);

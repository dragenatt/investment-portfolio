import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A leading underscore is how this project says a binding is deliberately
    // unused: a handler that must keep its signature, a destructured field kept
    // for shape. Without this the only way to say it was a disable comment,
    // which silences more than it should (see use-debounce.ts, where one hid a
    // real "ref written during render").
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Playwright fixtures take a callback named `use`, which the React hooks
    // rule mistakes for a hook call in a non-component. It is a false positive:
    // there is no React in this directory at all.
    files: ["e2e/**/*.ts"],
    rules: { "react-hooks/rules-of-hooks": "off" },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".claude/**",
    "worker/**",
    "scripts/**",
  ]),
]);

export default eslintConfig;

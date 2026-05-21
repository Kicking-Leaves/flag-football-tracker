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
    // RouteRunnr-specific: app.jsx is the legacy CDN-based source tracker
    // (uses lucide-react globals from a <script> tag in app.html); it is not
    // part of the Next.js build. The mobile/ folder is a separate Expo project.
    "app.jsx",
    "mobile/**",
  ]),
]);

export default eslintConfig;

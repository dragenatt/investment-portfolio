import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// The service worker is registered as /sw.js?v=<this>, so each deploy installs a
// new worker that drops the previous build's saved files (C4). Vercel provides
// the commit; a local build gets a timestamp, which is also unique per build.
const buildVersion =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? `local-${Date.now().toString(36)}`;

const nextConfig: NextConfig = {
  reactCompiler: true,
  env: {
    NEXT_PUBLIC_BUILD_VERSION: buildVersion,
  },
  async headers() {
    return [
      {
        // The browser checks for a new worker on navigation; a cached copy of
        // the script would delay a fix, or a kill switch, by the cache lifetime.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

// Uploading source maps needs SENTRY_AUTH_TOKEN. Without it the upload is
// disabled rather than failing the build, so a deploy that has no Sentry
// secrets still builds exactly as before.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },
});

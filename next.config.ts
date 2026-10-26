import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The AI coach page became the companion page.
  redirects() {
    return [{ source: "/coach", destination: "/companion", permanent: true }];
  },
  // The service worker is always fetched fresh, so a new version of the app replaces it at once.
  headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;

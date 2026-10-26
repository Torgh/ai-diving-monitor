import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `bun run dev` is how the app is used: the route indicator in a corner sat on the phone's tab bar.
  // Compile and runtime errors still show.
  devIndicators: false,
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

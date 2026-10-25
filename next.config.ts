import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The AI coach page became the companion page.
  redirects() {
    return [{ source: "/coach", destination: "/companion", permanent: true }];
  },
};

export default nextConfig;

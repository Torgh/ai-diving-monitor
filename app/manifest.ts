import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "DiveDeck – your AI dive companion",
    short_name: "DiveDeck",
    description: "Data-driven debriefs of your dives, your progress over time, and preparation for the dives of your trips.",
    start_url: "/",
    display: "standalone",
    background_color: "#082f49",
    theme_color: "#0e7490",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}

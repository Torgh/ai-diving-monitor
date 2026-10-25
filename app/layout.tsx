import type { Metadata, Viewport } from "next";
import { Nav } from "@/components/Nav";
import { UnitsProvider } from "@/components/Units";
import "./globals.css";

export const metadata: Metadata = {
  title: "DiveDeck",
  description: "Your AI dive companion: data-driven debriefs of your dives and your progress over time.",
  icons: { icon: "/icon-small.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0e7490",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <UnitsProvider>
          <div className="app">
            <Nav />
            <main className="page">{children}</main>
          </div>
        </UnitsProvider>
      </body>
    </html>
  );
}

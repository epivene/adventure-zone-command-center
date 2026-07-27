import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { OfflineBanner } from "@/components/connectivity/offline-banner";

import "./globals.css";

export const metadata: Metadata = {
  title: "Adventure Zone Command Center",
  description: "Private booking and route-planning tools.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>
          <OfflineBanner />
          {children}
        </body>
      </html>
    </ClerkProvider>
  );
}

import type { Metadata, Viewport } from "next";

import { TamaguiProvider } from "@healthtracker/ui";
import { colorTokens } from "@healthtracker/ui/theme/tokens";

import { env } from "~/env";
import { TRPCReactProvider } from "~/trpc/react";

import "~/app/styles.css";

export const metadata: Metadata = {
  metadataBase: new URL(
    env.VERCEL_ENV === "production"
      ? "https://turbo.t3.gg"
      : "http://localhost:3000",
  ),
  title: "Health Tracker",
  description: "Your personal health record",
};

export const viewport: Viewport = {
  themeColor: [
    {
      media: "(prefers-color-scheme: light)",
      color: colorTokens.backgroundPrimary.light,
    },
    {
      media: "(prefers-color-scheme: dark)",
      color: colorTokens.backgroundPrimary.dark,
    },
  ],
};

export default function RootLayout(props: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <TamaguiProvider>
          <TRPCReactProvider>{props.children}</TRPCReactProvider>
        </TamaguiProvider>
      </body>
    </html>
  );
}

import { RootProvider } from "fumadocs-ui/provider/next";
import type { Metadata } from "next";
import "./global.css";
export const metadata: Metadata = {
  title: {
    default: "convex-plunk · Email delivery for Convex",
    template: "%s · convex-plunk",
  },
  description:
    "A persistent email queue for Convex and Plunk. Schedule messages, keep delivery records, and preserve recipient restrictions.",
};
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}

import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F9FB" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1622" },
  ],
};

export const metadata: Metadata = {
  title: "Dynamic Gift Creative Studio",
  description:
    "Dynamic Gift's internal creative ops studio — brand intelligence, content ideation, video briefs, ad copy, and creative generation for promotional products.",
  openGraph: {
    title: "Dynamic Gift Creative Studio",
    description:
      "Dynamic Gift's internal creative ops studio — brand intelligence, content ideation, video briefs, ad copy, and creative generation for promotional products.",
    images: ["/dynamic-gift-logo.png"],
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${nunito.variable} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange={false}
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";
import { Analytics } from "@vercel/analytics/next";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "Admin Dashboard",
  description: "Portfolio Admin Dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
          (function() {
            var theme = localStorage.getItem('admin-theme');
            // Mirror THEME_CLASS in theme-provider.tsx, including its migration of
            // the legacy 'dark' value to Dark2 — the palette lives on theme-*, so
            // adding a bare 'dark' here would paint light tokens under dark rules.
            var t = theme === 'dark1' ? 'theme-gh' : (theme === 'dark2' || theme === 'dark') ? 'theme-zinc' : '';
            if (t) document.documentElement.classList.add('dark', t);
          })();
        `,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans bg-background text-foreground`}
      >
        <ThemeProvider>{children}</ThemeProvider>
        <Analytics />
      </body>
    </html>
  );
}

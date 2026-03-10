import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var theme = localStorage.getItem('admin-theme');
            if (theme === 'dark') document.documentElement.classList.add('dark');
          })();
        `}} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans bg-background text-foreground`}>
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}

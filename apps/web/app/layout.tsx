import type { Metadata } from "next";
import "./globals.css";
import OnekoCat from "./components/OnekoCat";
import { Analytics } from '@vercel/analytics/next';

export const metadata: Metadata = {
  title: "Yatin Dora",
  description: "Yatin Dora - Full-Stack Developer. Building scalable web applications with React, Next.js, Node.js, TypeScript, and Go.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function() {
              var theme = localStorage.getItem('theme');
              if (!theme) {
                theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
              }
              document.documentElement.classList.add(theme);
            })();`,
          }}
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `html.dark { background-color: #0a0a0a; } html:not(.dark) { background-color: #ffffff; }`,
          }}
        />
      </head>
      <body>
        {children}
        <OnekoCat />
        <Analytics />
      </body>
    </html>
  );
}

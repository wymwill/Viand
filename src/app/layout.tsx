import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Viand — stop debating",
  description: "A Linq-powered restaurant picker for group chats.",
  icons: {
    icon: "/brand/viand-icon.png",
    apple: "/brand/viand-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

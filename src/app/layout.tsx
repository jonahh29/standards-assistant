import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import { getSessionUser, isAdmin } from "@/lib/supabase-session";
import { SignOutButton } from "./SignOutButton";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-heading",
  subsets: ["latin"],
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Standards Assistant",
  description: "Ask cited questions about Australian Standards PDFs",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getSessionUser();
  const admin = isAdmin(user);

  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-navy text-offwhite font-body">
        <nav className="flex items-center gap-6 border-b border-cyan/20 px-6 py-4 font-heading">
          <span className="flex items-center gap-2 text-lg font-medium tracking-tight">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-icon.svg" alt="ResiDraft" className="h-7 w-auto" />
            Standards Assistant
          </span>
          {user && (
            <>
              <Link href="/" className="text-sm text-offwhite/80 hover:text-cyan">
                Home
              </Link>
              {admin && (
                <Link
                  href="/upload"
                  className="text-sm text-offwhite/80 hover:text-cyan"
                >
                  Upload
                </Link>
              )}
              <Link
                href="/ask"
                className="text-sm text-offwhite/80 hover:text-cyan"
              >
                Ask
              </Link>
              <Link
                href="/comply"
                className="text-sm text-offwhite/80 hover:text-cyan"
              >
                Comply
              </Link>
              <span className="ml-auto flex items-center gap-3 font-body">
                <span className="text-sm text-offwhite/40">{user.email}</span>
                <SignOutButton />
              </span>
            </>
          )}
        </nav>
        <div className="flex flex-1 flex-col">{children}</div>
      </body>
    </html>
  );
}

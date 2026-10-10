import type { Metadata } from 'next';
import { preload } from 'react-dom';
import './fonts.css';
import './globals.css';

import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/toaster';

export const metadata: Metadata = {
  title: {
    default: 'VaultSpace',
    template: '%s | VaultSpace',
  },
  description: 'Secure Virtual Data Room — share confidential documents with confidence.',
  metadataBase: new URL(process.env['APP_URL'] ?? 'https://vaultspace.org'),
  openGraph: {
    type: 'website',
    siteName: 'VaultSpace',
    title: 'VaultSpace — Secure Virtual Data Room',
    description: 'Share confidential documents with confidence.',
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  preload('/fonts/inter-latin.woff2', {
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  });
  preload('/fonts/bricolage-latin.woff2', {
    as: 'font',
    type: 'font/woff2',
    crossOrigin: 'anonymous',
  });

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <a
            href="#main-content"
            className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[200] focus:rounded-md focus:bg-primary-600 focus:px-4 focus:py-2 focus:text-white focus:outline-none"
          >
            Skip to main content
          </a>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}

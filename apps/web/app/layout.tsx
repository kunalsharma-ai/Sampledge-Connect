import type { Metadata, Viewport } from 'next';
import { themeInitScript } from '@sampledge/ui';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Sampledge Connect', template: '%s · Sampledge Connect' },
  description: 'One Workspace. Every Conversation. Connected.',
  applicationName: 'Sampledge Connect',
  manifest: '/manifest.webmanifest',
  icons: { icon: '/icon.svg', apple: '/icon.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#080F1F' },
    { media: '(prefers-color-scheme: light)', color: '#F6F8FC' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="midnight-executive" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

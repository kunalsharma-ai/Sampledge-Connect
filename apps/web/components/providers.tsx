'use client';
import * as React from 'react';
import { MotionConfig } from 'motion/react';
import { ThemeProvider, ToastProvider, TooltipProvider } from '@sampledge/ui';
import { AuthProvider } from '@/lib/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  React.useEffect(() => {
    // PWA: cache the app shell so previously visited screens open offline.
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    }
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <TooltipProvider delayDuration={250}>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </TooltipProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}

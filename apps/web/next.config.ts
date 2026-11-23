import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// The API and call signalling share this site's address (issue #128): the gateway sends
// /api/** to the API and /rtc to the call server, so 'self' covers both. Separate addresses
// are only needed when a build points elsewhere (NEXT_PUBLIC_API_URL / NEXT_PUBLIC_RTC_URL).
/** ` http(s)://host` and ` ws(s)://host` for an absolute URL, or nothing for a path. */
const origins = (u: string | undefined) => {
  if (!u || !/^(https?|wss?):\/\//.test(u)) return { http: '', ws: '' };
  const o = new URL(u).origin;
  const http = o.replace(/^ws/, 'http');
  return { http: ` ${http}`, ws: ` ${http.replace(/^http/, 'ws')}` };
};
const api = origins(process.env.NEXT_PUBLIC_API_URL);
const rtc = origins(process.env.NEXT_PUBLIC_RTC_URL);
/**
 * Without the gateway (`pnpm dev`, CI) the API runs on its own port. Requests to /api/** are
 * then forwarded to it by this server, so the browser still sees one origin. Rewrites are
 * fixed at build time, so set API_PROXY_TARGET for `next build` (CI does).
 */
const apiProxy =
  process.env.API_PROXY_TARGET ??
  (process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:4000' : '');

/** Security headers. Messages are rendered as text, never HTML. */
const csp = [
  "default-src 'self'",
  // 'wasm-unsafe-eval' lets the browser compile WebAssembly (background blur), nothing else.
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'" +
    (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: blob:${api.http}`,
  `connect-src 'self'${api.http}${api.ws}${rtc.http}${rtc.ws}`,
  `media-src 'self' blob: mediastream:${api.http}`,
  "worker-src 'self'",
  // Jitsi Meet calls show the organization's own Jitsi server in a frame. Its address is saved
  // in Integrations (database), so it can't be listed here at build time; https is required.
  `frame-src 'self' https:${process.env.NODE_ENV === 'development' ? ' http://localhost:* http://127.0.0.1:*' : ''}`,
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const config: NextConfig = {
  reactStrictMode: true,
  // The Docker image (apps/web/Dockerfile) ships the self-contained server only.
  ...(process.env.NEXT_OUTPUT === 'standalone'
    ? {
        output: 'standalone' as const,
        outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
      }
    : {}),
  poweredByHeader: false,
  ...(apiProxy
    ? {
        async rewrites() {
          const target = apiProxy.replace(/\/+$/, '');
          return [{ source: '/api/:path*', destination: `${target}/api/:path*` }];
        },
      }
    : {}),
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            // `*` lets the Jitsi frame (only frames allowed by frame-src above) ask for the
            // camera and microphone; the browser still asks the person.
            value:
              'camera=*, microphone=*, display-capture=*, fullscreen=*, speaker-selection=*, geolocation=()',
          },
        ],
      },
      {
        // Jitsi calls offer SampConnect's photo backgrounds and draw them on a canvas, which
        // needs CORS on the images.
        source: '/backgrounds/:path*',
        headers: [{ key: 'Access-Control-Allow-Origin', value: '*' }],
      },
      {
        // A guest's link token is in the path: never send it to other sites.
        source: '/join/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
          { key: 'Cache-Control', value: 'no-store' },
        ],
      },
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ];
  },
};

export default config;

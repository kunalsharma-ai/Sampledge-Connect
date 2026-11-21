import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'SampConnect',
    short_name: 'SampConnect',
    description: 'One Workspace. Every Conversation. Connected.',
    start_url: '/app',
    scope: '/',
    display: 'standalone',
    background_color: '#080F1F',
    theme_color: '#080F1F',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}

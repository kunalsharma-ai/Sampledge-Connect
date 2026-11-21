import type { Metadata } from 'next';
import { PublicProfilePage } from '@/components/network/public-pages';

export const metadata: Metadata = { title: 'Profile · Sampledge Connect' };

export default async function Page({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  return <PublicProfilePage handle={decodeURIComponent(handle)} />;
}

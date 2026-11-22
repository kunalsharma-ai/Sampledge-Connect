import type { Metadata } from 'next';
import { CommunityLinkJoin } from '@/components/network/public-pages';

export const metadata: Metadata = {
  title: 'Join community · SampConnect',
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <CommunityLinkJoin token={token} />;
}

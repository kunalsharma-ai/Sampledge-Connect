import type { Metadata } from 'next';
import { NetworkInviteJoin } from '@/components/network/public-pages';

export const metadata: Metadata = {
  title: 'You’re invited · Sampledge Connect',
  robots: { index: false, follow: false },
};

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <NetworkInviteJoin token={token} />;
}

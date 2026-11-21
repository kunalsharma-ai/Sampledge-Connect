import type { Metadata } from 'next';
import { GuestJoin } from '@/components/guest/guest-join';

export const metadata: Metadata = {
  title: 'Join meeting',
  // The token in the URL is the guest's credential: keep the page out of search engines.
  robots: { index: false, follow: false },
};

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <GuestJoin token={token} />;
}

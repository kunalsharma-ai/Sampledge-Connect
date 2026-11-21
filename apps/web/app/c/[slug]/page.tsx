import type { Metadata } from 'next';
import { PublicCommunityPage } from '@/components/network/public-pages';

export const metadata: Metadata = { title: 'Community · SampConnect' };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicCommunityPage slug={slug} />;
}

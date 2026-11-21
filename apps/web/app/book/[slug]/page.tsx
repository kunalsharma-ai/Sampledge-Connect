import type { Metadata } from 'next';
import { PublicBooking } from '@/components/booking/public-booking';

export const metadata: Metadata = {
  title: 'Book a time',
  robots: { index: false, follow: false },
};

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <PublicBooking slug={slug} />;
}

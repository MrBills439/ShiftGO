import type { Metadata } from 'next';

// The invitation token is in the URL: never send it to another site as a referrer.
export const metadata: Metadata = { title: 'Accept your invitation · LeafRota', referrer: 'no-referrer' };

export default function AcceptInviteLayout({ children }: { children: React.ReactNode }) {
  return children;
}

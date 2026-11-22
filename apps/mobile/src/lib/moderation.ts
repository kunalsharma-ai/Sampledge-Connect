import type { ModerationActionKind, ModerationReport, NetworkInvite } from '@sampledge/contracts';

/** Labels and rules for reviewing SampConnect Network reports (same as the web). */
export const REASON_TEXT: Record<ModerationReport['reason'], string> = {
  spam: 'Spam',
  harassment: 'Harassment',
  impersonation: 'Impersonation',
  inappropriate: 'Inappropriate',
  other: 'Other',
};

export const TARGET_TEXT: Record<ModerationReport['targetType'], string> = {
  user: 'Person',
  status: 'Status update',
  community: 'Community',
  message: 'Message',
};

export const ACTION_TEXT: Record<
  ModerationActionKind,
  { label: string; done: string; confirm: string; danger: boolean }
> = {
  dismiss: {
    label: 'Dismiss',
    done: 'Dismissed',
    confirm: 'Close this report without action.',
    danger: false,
  },
  remove_content: {
    label: 'Remove content',
    done: 'Content removed',
    confirm: 'It disappears for everyone, on every device. Moderators keep the snapshot.',
    danger: true,
  },
  suspend_user: {
    label: 'Suspend person',
    done: 'Person suspended',
    confirm:
      'They’re signed out of SampConnect Network everywhere and hidden until you restore them. Their organization workspace isn’t affected.',
    danger: true,
  },
  suspend_community: {
    label: 'Suspend community',
    done: 'Community suspended',
    confirm:
      'The community and its public page disappear and its groups are archived until restored.',
    danger: true,
  },
  ban_from_community: {
    label: 'Ban from community',
    done: 'Banned from community',
    confirm: 'They’re removed from the community and its groups and can’t rejoin.',
    danger: true,
  },
};

/** What a platform operator or community moderator can do with this report now. */
export function actionsFor(
  r: ModerationReport,
  kind: 'platform' | 'community',
): ModerationActionKind[] {
  if (r.resolution) return [];
  const out: ModerationActionKind[] = [];
  if (
    r.targetState === 'active' &&
    (r.targetType === 'message' || (kind === 'platform' && r.targetType === 'status'))
  )
    out.push('remove_content');
  if (kind === 'platform') {
    if (r.subject && r.targetType !== 'community' && r.targetState !== 'suspended')
      out.push('suspend_user');
    if (r.community && r.targetType === 'community' && r.targetState !== 'suspended')
      out.push('suspend_community');
  } else if (r.subject && r.targetType === 'message') out.push('ban_from_community');
  out.push('dismiss');
  return out;
}

/** How an invite went out: by the server (email or text) or from your own phone. */
export function deliveryLabel(i: Pick<NetworkInvite, 'channel' | 'delivery'>): string | null {
  if (!i.delivery) return null;
  const what = i.channel === 'sms' ? 'Text' : 'Email';
  if (i.delivery === 'sent') return `${what} sent`;
  if (i.delivery === 'failed') return `${what} failed: share the link`;
  return i.channel === 'sms' ? 'Send it from your phone' : 'Email not set up: share the link';
}

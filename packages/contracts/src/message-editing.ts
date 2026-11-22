import { z } from 'zod';

/**
 * Message editing rules for one organization (docs/editing.md). Owners and admins set them in
 * Administration → Messages; they live in the database (tenant `messageEditing`), never in env.
 * A SampConnect super admin can also take editing away per role (permission `messages.edit`).
 */
export const EDIT_HISTORY_AUDIENCES = ['everyone', 'moderators'] as const;
export type EditHistoryAudience = (typeof EDIT_HISTORY_AUDIENCES)[number];

/** Choices offered for the time limit, in minutes. null = no limit. */
export const EDIT_WINDOW_CHOICES = [null, 5, 15, 60, 24 * 60, 7 * 24 * 60] as const;

export const MessageEditingPolicySchema = z.object({
  /** Off = nobody can edit their messages (deleting still works). */
  allowEditing: z.boolean().default(true),
  /** Minutes after sending during which a message can still be edited. null = any time. */
  editWindowMinutes: z
    .number()
    .int()
    .min(1)
    .max(30 * 24 * 60)
    .nullable()
    .default(null),
  /** Who can open a message's earlier versions. */
  historyVisibleTo: z.enum(EDIT_HISTORY_AUDIENCES).default('everyone'),
});
export type MessageEditingPolicy = z.infer<typeof MessageEditingPolicySchema>;
export type MessageEditingPolicyInput = z.input<typeof MessageEditingPolicySchema>;

export const DEFAULT_MESSAGE_EDITING_POLICY: MessageEditingPolicy = {
  allowEditing: true,
  editWindowMinutes: null,
  historyVisibleTo: 'everyone',
};

/** GET /v1/message-editing: the rules plus what they mean for the signed-in person. */
export interface MessageEditingState {
  policy: MessageEditingPolicy;
  /** The person's role may edit their own messages (super admin permission `messages.edit`). */
  canEditOwn: boolean;
  /** The person may change these rules (permission `messages.manage`). */
  canManage: boolean;
}

export const DEFAULT_MESSAGE_EDITING_STATE: MessageEditingState = {
  policy: DEFAULT_MESSAGE_EDITING_POLICY,
  canEditOwn: true,
  canManage: false,
};

/**
 * Why the person can't edit this message of theirs right now, or null when they can.
 * Clients use it to hide Edit; the server runs the same check.
 */
export function editBlockedReason(
  createdAt: string | Date,
  state: Pick<MessageEditingState, 'policy' | 'canEditOwn'>,
  now: number = Date.now(),
): string | null {
  if (!state.policy.allowEditing) return 'Your organization has turned off editing messages.';
  if (!state.canEditOwn) return 'Your role can’t edit messages in this organization.';
  const w = state.policy.editWindowMinutes;
  if (w != null && now - new Date(createdAt).getTime() > w * 60_000)
    return `Messages can only be edited for ${editWindowLabel(w)} after sending.`;
  return null;
}

/** Minutes left to edit (rounded up), or null when there's no limit. */
export function editMinutesLeft(
  createdAt: string | Date,
  policy: MessageEditingPolicy,
  now: number = Date.now(),
): number | null {
  const w = policy.editWindowMinutes;
  if (w == null) return null;
  return Math.max(0, Math.ceil((new Date(createdAt).getTime() + w * 60_000 - now) / 60_000));
}

export function editWindowLabel(minutes: number | null): string {
  if (minutes == null) return 'any time';
  if (minutes % (24 * 60) === 0) {
    const d = minutes / (24 * 60);
    return d === 1 ? '24 hours' : `${d} days`;
  }
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? '1 hour' : `${h} hours`;
  }
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

/** One version of a message's text. */
export interface MessageVersion {
  /** 1 = as first sent. */
  version: number;
  text: string;
  /** User ids mentioned in this version. */
  mentions: string[];
  /** When this text was written (sent, or the edit that produced it). */
  at: string;
  current: boolean;
}

/** GET /v1/messages/:id/edits: every version, oldest first; the last one is current. */
export interface MessageEditHistory {
  messageId: string;
  conversationId: string;
  versions: MessageVersion[];
}

import { z } from 'zod';
import { ClientIdSchema, ServerIdSchema } from './ids.js';
import { DeviceInfoSchema } from './auth.js';

/**
 * Sampledge Network: the cross-organization layer (Connect IDs, connections, follows,
 * statuses, communities). It lives in one reserved tenant, so organization data and
 * network data never share a query. See docs/network.md.
 */
export const NETWORK_TENANT_SLUG = 'sampledge-network';

/** Connect ID: what people type to find you, like a Teams ID or a Telegram username. */
export const ConnectHandleSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(30)
  .regex(
    /^[a-z][a-z0-9._]*[a-z0-9]$/,
    'start with a letter; letters, numbers, dots and underscores',
  );

const Email = z.string().trim().toLowerCase().email().max(254);
/** Phone numbers are compared as digits only, with an optional leading +. */
export const PhoneSchema = z
  .string()
  .trim()
  .transform((s) => s.replace(/[^\d+]/g, ''))
  .pipe(z.string().regex(/^\+?\d{7,15}$/, 'a phone number with country code'));

export const CIRCLES = ['business', 'friends'] as const;
export const CircleSchema = z.enum(CIRCLES);
export type Circle = z.infer<typeof CircleSchema>;

export const NetworkPrivacySchema = z.object({
  /** Others can find you by name. Your exact Connect ID always works unless requests are off. */
  discoverableByName: z.boolean(),
  /** Someone who types your exact email can find you. */
  findableByEmail: z.boolean(),
  /** Someone who types your exact phone number can find you. */
  findableByPhone: z.boolean(),
  /** 'public' profiles have a shareable page anyone can open, even without an account. */
  profileVisibility: z.enum(['public', 'network']),
  /** Who may send you connection requests. */
  allowRequestsFrom: z.enum(['everyone', 'nobody']),
  /** Whether people can follow you (followers see public and follower statuses). */
  allowFollowers: z.boolean(),
  /** Show your organization's name on your profile (work accounts). */
  showOrganization: z.boolean(),
});
export type NetworkPrivacy = z.infer<typeof NetworkPrivacySchema>;

export const DEFAULT_NETWORK_PRIVACY: NetworkPrivacy = {
  discoverableByName: true,
  findableByEmail: true,
  findableByPhone: false,
  profileVisibility: 'network',
  allowRequestsFrom: 'everyone',
  allowFollowers: true,
  showOrganization: true,
};

/** Public part of a profile: what search results and other people see. */
export interface NetworkPerson {
  userId: string;
  handle: string;
  displayName: string;
  headline: string;
  /** 'work': linked to an organization account. 'personal': a free personal account. */
  kind: 'work' | 'personal';
  /** Shown when the person allows it. */
  organizationName: string | null;
  avatarColor: string;
}

export type ConnectionState = 'none' | 'connected' | 'outgoing' | 'incoming';

export interface Relationship {
  connection: ConnectionState;
  /** Pending request id when outgoing or incoming. */
  requestId: string | null;
  circle: Circle | null;
  following: boolean;
  followsYou: boolean;
  blocked: boolean;
  canRequest: boolean;
  canFollow: boolean;
  canMessage: boolean;
}

export interface NetworkProfile extends NetworkPerson {
  bio: string;
  counts: { connections: number; followers: number; following: number };
  publicUrl: string | null;
}

export interface PersonWithRelationship {
  person: NetworkPerson;
  relationship: Relationship;
}

/** GET /v1/network/me: your own profile, private fields included. */
export interface MyNetworkProfile extends NetworkProfile {
  email: string | null;
  phone: string | null;
  privacy: NetworkPrivacy;
  /** The organization account this identity is linked to, if any. */
  home: { tenantName: string } | null;
}

export const UpdateNetworkProfileSchema = z.object({
  handle: ConnectHandleSchema.optional(),
  displayName: z.string().trim().min(1).max(80).optional(),
  headline: z.string().trim().max(120).optional(),
  bio: z.string().trim().max(600).optional(),
  phone: PhoneSchema.nullable().optional(),
  privacy: NetworkPrivacySchema.partial().optional(),
});
export type UpdateNetworkProfile = z.input<typeof UpdateNetworkProfileSchema>;

/** Work account → network: GET /v1/network/link (work token). */
export interface NetworkLinkStatus {
  allowed: boolean;
  /** Why not, in words, when allowed is false. */
  reason: string | null;
  linked: boolean;
  handle: string | null;
}

export const LinkNetworkRequestSchema = z.object({
  device: DeviceInfoSchema,
  /** Preferred Connect ID on first link; generated from your name when omitted. */
  handle: ConnectHandleSchema.optional(),
});

/** Free personal account (people who are not in any organization). */
export const NetworkSignupRequestSchema = z.object({
  displayName: z.string().trim().min(1).max(80),
  email: Email,
  password: z.string().min(12, 'at least 12 characters').max(256),
  handle: ConnectHandleSchema.optional(),
  /** From an invite link: the connection completes on signup. */
  inviteToken: z.string().min(16).max(128).optional(),
  /** Follow this person or community right after signup (from a public page). */
  follow: z.object({ type: z.enum(['user', 'community']), id: ServerIdSchema }).optional(),
  device: DeviceInfoSchema,
});
export type NetworkSignupRequest = z.input<typeof NetworkSignupRequestSchema>;

export const NetworkSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(120),
});

/** Every mutation carries an idempotency key so offline replays are safe. */
const Action = { clientActionId: ClientIdSchema };

export const SendConnectionRequestSchema = z.object({
  ...Action,
  toUserId: ServerIdSchema,
  circle: CircleSchema.default('business'),
  message: z.string().trim().max(300).default(''),
});
export type SendConnectionRequest = z.input<typeof SendConnectionRequestSchema>;

export const RespondConnectionRequestSchema = z.object({
  ...Action,
  accept: z.boolean(),
  /** Your circle for this person when accepting. */
  circle: CircleSchema.default('business'),
});

export const ActionOnlySchema = z.object(Action);
export const SetCircleSchema = z.object({ ...Action, circle: CircleSchema });

export interface ConnectionRequest {
  requestId: string;
  direction: 'incoming' | 'outgoing';
  person: NetworkPerson;
  message: string;
  circle: Circle;
  status: 'pending' | 'accepted' | 'declined' | 'cancelled';
  createdAt: string;
}

export interface Connection {
  person: NetworkPerson;
  circle: Circle;
  connectedAt: string;
}

export const REPORT_REASONS = [
  'spam',
  'harassment',
  'impersonation',
  'inappropriate',
  'other',
] as const;
export const ReportSchema = z.object({
  ...Action,
  targetType: z.enum(['user', 'status', 'community', 'message']),
  targetId: ServerIdSchema,
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000).default(''),
});

export const CreateNetworkInviteSchema = z
  .object({
    ...Action,
    channel: z.enum(['email', 'link', 'sms']),
    email: Email.optional(),
    phone: PhoneSchema.optional(),
    name: z.string().trim().max(80).optional(),
    circle: CircleSchema.default('business'),
  })
  .refine((r) => r.channel !== 'email' || !!r.email, { message: 'email required', path: ['email'] })
  .refine((r) => r.channel !== 'sms' || !!r.phone, { message: 'phone required', path: ['phone'] });
export type CreateNetworkInvite = z.input<typeof CreateNetworkInviteSchema>;

export interface NetworkInvite {
  inviteId: string;
  channel: 'email' | 'link' | 'sms';
  email: string | null;
  phone: string | null;
  name: string | null;
  url: string;
  /** For SMS: open this on a phone to send the text from your own number. */
  smsUrl: string | null;
  /** Email delivery: 'sent', 'not_configured' (no SMTP), 'failed', or null for links. */
  delivery: 'sent' | 'not_configured' | 'failed' | null;
  status: 'pending' | 'accepted' | 'expired';
  createdAt: string;
  expiresAt: string;
}

/** Public preview of an invite link (no account needed). */
export interface NetworkInvitePreview {
  inviter: NetworkPerson;
  valid: boolean;
}

// ─── Status updates ──────────────────────────────────────────────────────────

export const STATUS_BACKGROUNDS = ['ocean', 'violet', 'sunset', 'emerald', 'graphite'] as const;
export const STATUS_AUDIENCES = ['connections', 'followers', 'public', 'selected'] as const;
export const MAX_STATUS_HOURS = 24 * 7;

export const CreateStatusSchema = z
  .object({
    /** Also the status id key for idempotency. */
    clientStatusId: ClientIdSchema,
    kind: z.enum(['text', 'image', 'video']),
    text: z.string().trim().max(700).default(''),
    background: z.enum(STATUS_BACKGROUNDS).default('ocean'),
    /** A ready upload from POST /v1/network/status-media. */
    attachmentId: ServerIdSchema.nullable().default(null),
    /**
     * connections: your connections. followers: connections and followers.
     * public: anyone, including your public profile page. selected: only `userIds`.
     */
    audience: z.enum(STATUS_AUDIENCES).default('connections'),
    userIds: z.array(ServerIdSchema).max(500).default([]),
    /** 24 by default; 1 hour to 7 days. */
    expiresInHours: z.number().int().min(1).max(MAX_STATUS_HOURS).default(24),
    allowReplies: z.boolean().default(true),
  })
  .refine((s) => (s.kind === 'text' ? s.text.length > 0 : !!s.attachmentId), {
    message: 'a text status needs text; a photo or video status needs a file',
  })
  .refine((s) => s.audience !== 'selected' || s.userIds.length > 0, {
    message: 'choose at least one person',
    path: ['userIds'],
  });
export type CreateStatus = z.input<typeof CreateStatusSchema>;

export interface NetworkStatus {
  statusId: string;
  clientStatusId: string;
  author: NetworkPerson;
  kind: 'text' | 'image' | 'video';
  text: string;
  background: (typeof STATUS_BACKGROUNDS)[number];
  media: { attachmentId: string; mimeType: string; url: string; expiresAt: string } | null;
  audience: (typeof STATUS_AUDIENCES)[number];
  allowReplies: boolean;
  createdAt: string;
  expiresAt: string;
  viewedByMe: boolean;
  /** Only on your own statuses. */
  viewCount: number | null;
}

/** GET /v1/network/statuses: grouped by person, unseen first; yours first. */
export interface StatusFeed {
  mine: NetworkStatus[];
  people: { person: NetworkPerson; statuses: NetworkStatus[]; unseen: number }[];
}

export const StatusReplySchema = z.object({
  clientMessageId: ClientIdSchema,
  text: z.string().trim().min(1).max(2000),
});

export const StatusMediaUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  mimeType: z.string().regex(/^(image\/(png|jpeg|gif|webp)|video\/(mp4|webm|quicktime))$/i),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(64 * 1024 * 1024),
});

// ─── Communities ─────────────────────────────────────────────────────────────

export const CommunitySlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(40)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'lowercase letters, numbers and dashes');

export const COMMUNITY_ROLES = ['owner', 'admin', 'moderator', 'member'] as const;
export type CommunityRole = (typeof COMMUNITY_ROLES)[number];

export const CreateCommunitySchema = z.object({
  ...Action,
  name: z.string().trim().min(2).max(80),
  slug: CommunitySlugSchema.optional(),
  description: z.string().trim().max(1000).default(''),
  /** public: listed, has a shareable page. private: invite links or approval only. */
  visibility: z.enum(['public', 'private']).default('public'),
  /** open: anyone who can see it joins. approval: admins approve requests. */
  joinPolicy: z.enum(['open', 'approval']).default('open'),
  rules: z.string().trim().max(2000).default(''),
});
export type CreateCommunity = z.input<typeof CreateCommunitySchema>;

export const UpdateCommunitySchema = z.object({
  ...Action,
  name: z.string().trim().min(2).max(80).optional(),
  description: z.string().trim().max(1000).optional(),
  visibility: z.enum(['public', 'private']).optional(),
  joinPolicy: z.enum(['open', 'approval']).optional(),
  rules: z.string().trim().max(2000).optional(),
});

export const CreateCommunityGroupSchema = z.object({
  ...Action,
  name: z.string().trim().min(1).max(60),
  topic: z.string().trim().max(250).default(''),
  /** open: any community member can join. private: added by community admins. */
  access: z.enum(['open', 'private']).default('open'),
  /** Only admins and moderators post (an extra announcement channel). */
  announcementsOnly: z.boolean().default(false),
});

export const SetCommunityRoleSchema = z.object({
  ...Action,
  role: z.enum(['admin', 'moderator', 'member']),
});

export const CreateCommunityInviteLinkSchema = z.object({
  ...Action,
  expiresInDays: z.number().int().min(1).max(90).nullable().default(7),
  maxUses: z.number().int().min(1).max(10_000).nullable().default(null),
});

export const InviteToCommunitySchema = z.object({
  ...Action,
  userIds: z.array(ServerIdSchema).min(1).max(50),
});

export interface CommunityGroup {
  /** The group's conversation id (open it in Messages). */
  conversationId: string;
  name: string;
  topic: string;
  kind: 'announcements' | 'group';
  access: 'open' | 'private';
  announcementsOnly: boolean;
  memberCount: number;
  joined: boolean;
}

export interface Community {
  communityId: string;
  slug: string;
  name: string;
  description: string;
  rules: string;
  visibility: 'public' | 'private';
  joinPolicy: 'open' | 'approval';
  memberCount: number;
  followerCount: number;
  avatarColor: string;
  createdAt: string;
  myRole: CommunityRole | null;
  /** 'member', 'pending' (asked to join), 'invited' or null. */
  myStatus: 'member' | 'pending' | 'invited' | null;
  following: boolean;
  /** Visible to members only. */
  groups: CommunityGroup[];
  publicUrl: string | null;
}

export interface CommunityMember {
  person: NetworkPerson;
  role: CommunityRole;
  status: 'active' | 'pending' | 'invited' | 'banned';
  joinedAt: string;
}

export interface CommunityInviteLink {
  linkId: string;
  url: string;
  expiresAt: string | null;
  maxUses: number | null;
  uses: number;
  revoked: boolean;
}

/** Public page of a community (no account needed for public communities). */
export interface PublicCommunity {
  community: Omit<Community, 'groups' | 'myRole' | 'myStatus' | 'following'>;
  announcements: { text: string; at: string; author: string }[];
}

export interface PublicProfile {
  profile: NetworkProfile;
  statuses: NetworkStatus[];
}

// ─── Organization admin policy ───────────────────────────────────────────────

export const NetworkPolicySchema = z.object({
  /** Members may use Sampledge Network at all. */
  enabled: z.boolean(),
  /** anyone: connect with everyone. allowlist: only people whose email domain is listed. */
  connectWith: z.enum(['anyone', 'allowlist']),
  allowedDomains: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'a domain like example.com'),
    )
    .max(200),
  /** Members may connect with free personal accounts. */
  allowPersonalAccounts: z.boolean(),
  /** Members may create and join communities. */
  allowCommunities: z.boolean(),
  /** Members may post status updates. */
  allowStatus: z.boolean(),
});
export type NetworkPolicy = z.infer<typeof NetworkPolicySchema>;

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = {
  enabled: true,
  connectWith: 'anyone',
  allowedDomains: [],
  allowPersonalAccounts: true,
  allowCommunities: true,
  allowStatus: true,
};

/** GET /v1/admin/network: the policy plus a usage summary (no message content). */
export interface NetworkAdminView {
  policy: NetworkPolicy;
  linkedMembers: number;
  externalConnections: number;
}

/** Realtime: something in your network changed; refetch that part. Sent to all your devices. */
export interface NetworkChangedEvent {
  scope:
    | 'profile'
    | 'requests'
    | 'connections'
    | 'follows'
    | 'blocks'
    | 'statuses'
    | 'communities'
    | 'invites';
  id?: string;
}

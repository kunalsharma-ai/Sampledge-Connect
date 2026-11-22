import type { Ionicons } from '@expo/vector-icons';

export interface ModuleEntry {
  key: string;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** `available` modules work today. `planned` ones open an honest "not built yet" page. */
  status: 'available' | 'planned';
  href?: string;
  summary: string;
}

/** The fifteen product areas from the spec, in navigation order, with what the mobile app does today. */
export const MODULES: ModuleEntry[] = [
  {
    key: 'home',
    title: 'Home',
    icon: 'home-outline',
    status: 'available',
    href: '/',
    summary: 'Workspace overview, unread and queued counts.',
  },
  {
    key: 'messages',
    title: 'Messages',
    icon: 'chatbubbles-outline',
    status: 'available',
    href: '/messages',
    summary: 'Direct and group conversations, offline-first.',
  },
  {
    key: 'channels',
    title: 'Teams & Channels',
    icon: 'people-outline',
    status: 'available',
    href: '/messages?filter=channels',
    summary: 'Public and private channels you belong to.',
  },
  {
    key: 'projects',
    title: 'Projects',
    icon: 'briefcase-outline',
    status: 'planned',
    summary: 'Project-linked conversations connected to Sampledge study data.',
  },
  {
    key: 'inbox',
    title: 'Client Inbox',
    icon: 'mail-outline',
    status: 'available',
    href: '/inbox',
    summary:
      'Client conversations from Telegram, Teams, Slack, Google Chat, LINE and more in one inbox: replies, internal notes, owners, SLAs and linked records.',
  },
  {
    key: 'meetings',
    title: 'Meetings',
    icon: 'videocam-outline',
    status: 'available',
    href: '/meetings',
    summary:
      'Scheduled meetings with RSVP, suggested free times from working hours, reminders and Join. Guest invites by email are planned.',
  },
  {
    key: 'saved',
    title: 'Saved messages',
    icon: 'bookmark-outline',
    status: 'available',
    href: '/saved',
    summary:
      'Messages you saved for later from any conversation. Pinned messages show at the top of each conversation.',
  },
  {
    key: 'scheduled',
    title: 'Scheduled messages',
    icon: 'time-outline',
    status: 'available',
    href: '/scheduled',
    summary:
      'Messages you wrote to send later. The server sends them as you at the time you picked; send now, change the time or delete.',
  },
  {
    key: 'recordings',
    title: 'Recordings',
    icon: 'recording-outline',
    status: 'available',
    href: '/recordings',
    summary:
      'Voice and video messages, screen recordings and call recordings in your conversations. Retention and export settings for admins are planned on mobile.',
  },
  {
    key: 'files',
    title: 'Files',
    icon: 'folder-outline',
    status: 'available',
    href: '/files',
    summary:
      'Every file shared in your conversations, with search and filters by type. Works offline from the files saved on this phone.',
  },
  {
    key: 'tasks',
    title: 'Tasks & Approvals',
    icon: 'checkbox-outline',
    status: 'available',
    href: '/tasks',
    summary:
      'Turn a message into a task or an approval request. Assign people, set a due date, and decide approvals from your phone.',
  },
  {
    key: 'notifications',
    title: 'Notifications',
    icon: 'notifications-outline',
    status: 'planned',
    href: '/activity',
    summary: 'Mentions of you are in Activity. Push notifications and reply alerts are planned.',
  },
  {
    key: 'search',
    title: 'Universal Search',
    icon: 'search-outline',
    status: 'available',
    href: '/search',
    summary: 'Searches messages saved on this device (works offline).',
  },
  {
    key: 'ai',
    title: 'AI Assistant',
    icon: 'sparkles-outline',
    status: 'available',
    href: '/assistant',
    summary:
      'Ask about your conversations, search by meaning and get a status digest. Runs on your own server and only reads what you can read.',
  },
  {
    key: 'analytics',
    title: 'Analytics',
    icon: 'stats-chart-outline',
    status: 'planned',
    summary: 'Workspace and engagement insights.',
  },
  {
    key: 'integrations',
    title: 'Integrations',
    icon: 'extension-puzzle-outline',
    status: 'available',
    href: '/admin/integrations',
    summary:
      'Connection settings for email (SMTP), the call server and push, stored encrypted in the database and tested from here. Admins only. The seven Sampledge modules are planned.',
  },
  {
    key: 'branding',
    title: 'Branding',
    icon: 'color-palette-outline',
    status: 'available',
    href: '/admin/branding',
    summary:
      'Your organization’s name, logo, colors and sign-in message, stored in the database. Owners change them; everyone sees them.',
  },
  {
    key: 'admin',
    title: 'Administration',
    icon: 'shield-checkmark-outline',
    status: 'available',
    href: '/admin',
    summary:
      'For owners and admins: the organization at a glance, members and roles, two-step resets, every signed-in device, and the audit log.',
  },
  {
    key: 'platform',
    title: 'Super admin',
    icon: 'ribbon-outline',
    status: 'available',
    href: '/platform',
    summary:
      'For SampConnect platform admins only: every organization, plans and billing, suspensions, deletion, usage and health, platform admins and their audit log.',
  },
  {
    key: 'settings',
    title: 'Settings',
    icon: 'settings-outline',
    status: 'available',
    href: '/settings/appearance',
    summary: 'Themes, offline storage and account.',
  },
];

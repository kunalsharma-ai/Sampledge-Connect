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
    status: 'planned',
    href: '/inbox',
    summary: 'Unified inbox for external client channels (email, WhatsApp and others).',
  },
  {
    key: 'meetings',
    title: 'Meetings',
    icon: 'videocam-outline',
    status: 'planned',
    summary: 'Scheduling and joining calls.',
  },
  {
    key: 'files',
    title: 'Files',
    icon: 'folder-outline',
    status: 'planned',
    summary: 'Nextcloud-backed files and resumable attachment upload.',
  },
  {
    key: 'tasks',
    title: 'Tasks & Approvals',
    icon: 'checkbox-outline',
    status: 'planned',
    summary: 'Assignments and approval workflows.',
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
    status: 'planned',
    summary: 'Summaries and drafting help.',
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
    status: 'planned',
    summary: 'The seven Sampledge modules and third-party apps.',
  },
  {
    key: 'admin',
    title: 'Administration',
    icon: 'shield-checkmark-outline',
    status: 'planned',
    summary: 'Members, roles, retention and security policies.',
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

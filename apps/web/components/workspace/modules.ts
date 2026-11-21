import {
  Bell,
  Bookmark,
  Bot,
  CalendarClock,
  ChartNoAxesCombined,
  Clapperboard,
  CreditCard,
  CheckSquare,
  FolderKanban,
  FolderOpen,
  Hash,
  House,
  Inbox,
  Palette,
  MessagesSquare,
  Plug,
  Search,
  Settings,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';

export type ModuleId =
  | 'home'
  | 'messages'
  | 'channels'
  | 'projects'
  | 'client-inbox'
  | 'meetings'
  | 'recordings'
  | 'files'
  | 'tasks'
  | 'notifications'
  | 'saved'
  | 'search'
  | 'ai'
  | 'analytics'
  | 'integrations'
  | 'billing'
  | 'branding'
  | 'admin'
  | 'settings';

export interface ModuleDef {
  id: ModuleId;
  label: string;
  icon: LucideIcon;
  /** false = shown as Planned, not presented as functional. */
  built: boolean;
  phase?: string;
  adminOnly?: boolean;
}

/** The navigation modules from the product spec, honestly flagged. */
export const MODULES: ModuleDef[] = [
  { id: 'home', label: 'Home', icon: House, built: false, phase: 'Phase 1b' },
  { id: 'messages', label: 'Messages', icon: MessagesSquare, built: true },
  { id: 'channels', label: 'Teams & Channels', icon: Hash, built: true },
  { id: 'projects', label: 'Projects', icon: FolderKanban, built: true },
  { id: 'client-inbox', label: 'Client Inbox', icon: Inbox, built: false, phase: 'Phase 3' },
  { id: 'meetings', label: 'Meetings', icon: CalendarClock, built: true },
  { id: 'recordings', label: 'Recordings', icon: Clapperboard, built: true },
  { id: 'files', label: 'Files', icon: FolderOpen, built: false, phase: 'Phase 1b · Nextcloud' },
  { id: 'tasks', label: 'Tasks & Approvals', icon: CheckSquare, built: true },
  { id: 'notifications', label: 'Notifications', icon: Bell, built: true },
  { id: 'saved', label: 'Saved', icon: Bookmark, built: true },
  { id: 'search', label: 'Universal Search', icon: Search, built: true },
  { id: 'ai', label: 'AI Assistant', icon: Bot, built: true },
  {
    id: 'analytics',
    label: 'Analytics',
    icon: ChartNoAxesCombined,
    built: false,
    phase: 'Phase 4',
  },
  { id: 'integrations', label: 'Integrations', icon: Plug, built: true, adminOnly: true },
  { id: 'branding', label: 'Branding', icon: Palette, built: true, adminOnly: true },
  { id: 'billing', label: 'Billing', icon: CreditCard, built: true, adminOnly: true },
  { id: 'admin', label: 'Administration', icon: ShieldCheck, built: true, adminOnly: true },
  { id: 'settings', label: 'Settings', icon: Settings, built: true },
];

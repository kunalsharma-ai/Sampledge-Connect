'use client';
import { motion } from 'motion/react';
import { ChevronsLeft, ChevronsRight, LogOut } from 'lucide-react';
import { Avatar, Badge, Tooltip, cn } from '@sampledge/ui';
import { motion as tokens } from '@sampledge/design-tokens';
import { LogoMark } from '../brand';
import { OrgLogo } from '@/lib/org-branding';
import { MODULES, type ModuleId } from './modules';

export function NavRail({
  active,
  onSelect,
  expanded,
  onToggle,
  tenantName,
  userName,
  userAvatar,
  isAdmin,
  unreadTotal,
  notificationCount = 0,
  onSignOut,
}: {
  active: ModuleId;
  onSelect: (m: ModuleId) => void;
  expanded: boolean;
  onToggle: () => void;
  tenantName: string;
  userName: string;
  /** Profile photo URL, or null for initials. */
  userAvatar?: string | null;
  isAdmin: boolean;
  unreadTotal: number;
  notificationCount?: number;
  onSignOut: () => void;
}) {
  const modules = MODULES.filter((m) => !m.adminOnly || isAdmin);
  return (
    <motion.nav
      aria-label="Modules"
      animate={{ width: expanded ? 240 : 72 }}
      transition={tokens.spring.gentle}
      className="relative z-20 hidden h-full shrink-0 flex-col border-r border-border bg-surface-glass backdrop-blur-xl md:flex"
    >
      <div className="flex h-[60px] items-center gap-3 px-[18px]">
        <OrgLogo
          className="size-9 shrink-0 rounded-lg object-contain"
          fallback={<LogoMark className="size-9 shrink-0" />}
        />
        {expanded ? (
          <div className="min-w-0">
            <p className="truncate text-label text-text">{tenantName}</p>
            <p className="text-meta text-text-subtle">Workspace</p>
          </div>
        ) : null}
      </div>
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-2">
        <ul className="flex flex-col gap-0.5">
          {modules.map((m) => {
            const Icon = m.icon;
            const isActive = active === m.id;
            const count =
              m.id === 'messages' ? unreadTotal : m.id === 'notifications' ? notificationCount : 0;
            const item = (
              <button
                onClick={() => onSelect(m.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'group relative flex h-10 w-full items-center gap-3 rounded-md px-3 text-label transition-colors duration-[var(--sc-duration-fast)]',
                  isActive
                    ? 'bg-accent-soft text-text'
                    : 'text-text-muted hover:bg-surface-raised hover:text-text',
                )}
              >
                {isActive ? (
                  <motion.span
                    layoutId="nav-active"
                    className="absolute left-0 top-2 bottom-2 w-[3px] rounded-full bg-accent"
                    transition={tokens.spring.gentle}
                  />
                ) : null}
                <Icon
                  className={cn(
                    'size-[18px] shrink-0',
                    isActive && 'text-accent',
                    !m.built && 'opacity-60',
                  )}
                />
                {expanded ? (
                  <>
                    <span className={cn('flex-1 truncate text-left', !m.built && 'opacity-70')}>
                      {m.label}
                    </span>
                    {count > 0 ? (
                      <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-accent-fg">
                        {count > 99 ? '99+' : count}
                      </span>
                    ) : !m.built ? (
                      <Badge tone="planned" className="px-1.5 text-[10px]">
                        Planned
                      </Badge>
                    ) : null}
                  </>
                ) : count > 0 ? (
                  <span className="absolute right-2 top-2 size-2 rounded-full bg-accent" />
                ) : null}
              </button>
            );
            return (
              <li key={m.id}>
                {expanded ? (
                  item
                ) : (
                  <Tooltip content={m.built ? m.label : `${m.label} · Planned`}>{item}</Tooltip>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="flex flex-col gap-1 border-t border-border p-3">
        <div
          className={cn(
            'flex items-center gap-3 rounded-md px-1.5 py-1.5',
            expanded ? '' : 'justify-center',
          )}
        >
          <Avatar name={userName} src={userAvatar} size="sm" presence="online" />
          {expanded ? (
            <>
              <span className="min-w-0 flex-1 truncate text-label text-text">{userName}</span>
              <Tooltip content="Sign out">
                <button
                  onClick={onSignOut}
                  aria-label="Sign out"
                  className="rounded-sm p-1.5 text-text-subtle hover:bg-surface-raised hover:text-text"
                >
                  <LogOut className="size-4" />
                </button>
              </Tooltip>
            </>
          ) : null}
        </div>
        <button
          onClick={onToggle}
          aria-label={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
          className="flex h-8 items-center justify-center rounded-md text-text-subtle hover:bg-surface-raised hover:text-text"
        >
          {expanded ? <ChevronsLeft className="size-4" /> : <ChevronsRight className="size-4" />}
        </button>
      </div>
    </motion.nav>
  );
}

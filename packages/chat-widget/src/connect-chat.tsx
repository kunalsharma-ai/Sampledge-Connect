import * as React from 'react';
import { THEMES } from '@sampledge/design-tokens';
import {
  MODULE_CATALOG,
  type Message,
  type ModuleCardMetadata,
  type WidgetSession,
} from '@sampledge/contracts';
import { WidgetClient, type PendingMessage, type WidgetState } from './client.js';

export type WidgetTheme = keyof typeof THEMES;

export interface ConnectChatProps {
  /** Connect API base URL, e.g. https://connect.example.com */
  apiUrl: string;
  /** From your server: ConnectClient.createWidgetSession({ user, record }). */
  session: WidgetSession;
  /** Defaults to the record conversation the session was created for. */
  conversationId?: string;
  /** Called when the session can't be refreshed; return a fresh one from your server. */
  renewSession?: () => Promise<WidgetSession>;
  theme?: WidgetTheme;
  /** Header title; defaults to the conversation name. */
  title?: string;
  /** Link for "Open in Connect" (your Connect web URL). */
  connectWebUrl?: string;
  height?: number | string;
  className?: string;
  /** For tests and previews: storage for the outbox (default localStorage). */
  storage?: Storage | null;
}

/** Subscribe to the widget engine. Exported for hosts that want their own UI. */
export function useConnectChat(opts: {
  apiUrl: string;
  session: WidgetSession;
  conversationId?: string;
  renewSession?: () => Promise<WidgetSession>;
  storage?: Storage | null;
}) {
  const [client, setClient] = React.useState<WidgetClient | null>(null);
  const [state, setState] = React.useState<WidgetState | null>(null);
  const { apiUrl, session, conversationId, renewSession, storage } = opts;
  React.useEffect(() => {
    const c = new WidgetClient({ apiUrl, session, conversationId, renewSession, storage });
    setClient(c);
    const off = c.subscribe(setState);
    void c.start();
    return () => {
      off();
      c.dispose();
    };
    // A new session object (same user) must not tear down the widget; key on ids instead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiUrl, session.sessionId, conversationId]);
  return { client, state };
}

const TONE: Record<ModuleCardMetadata['tone'], keyof (typeof THEMES)['midnight-executive']['colors']> = {
  info: 'info',
  success: 'success',
  warning: 'warning',
  danger: 'danger',
};

function time(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * <ConnectChat>: a record's Connect conversation inside a Sampledge module page (a Samptrek
 * project, a SampBidX bid...). Self-contained styles (no CSS framework needed), the Connect
 * themes, live updates, and an outbox that keeps unsent messages through connection drops.
 */
export function ConnectChat(props: ConnectChatProps) {
  const { state, client } = useConnectChat(props);
  const colors = THEMES[props.theme ?? 'midnight-executive'].colors;
  const [draft, setDraft] = React.useState('');
  const listRef = React.useRef<HTMLDivElement>(null);
  const count = (state?.messages.length ?? 0) + (state?.pending.length ?? 0);
  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count]);

  const vars = {
    '--sc-bg': colors.bg,
    '--sc-surface': colors.surface,
    '--sc-raised': colors.surfaceRaised,
    '--sc-border': colors.border,
    '--sc-text': colors.text,
    '--sc-muted': colors.textMuted,
    '--sc-subtle': colors.textSubtle,
    '--sc-accent': colors.accent,
    '--sc-accent-fg': colors.accentFg,
    '--sc-accent-soft': colors.accentSoft,
    '--sc-bubble': colors.bubbleOther,
    '--sc-danger': colors.danger,
    '--sc-warning': colors.warning,
    '--sc-success': colors.success,
  } as React.CSSProperties;

  const status = state?.status ?? 'connecting';
  const statusLabel =
    status === 'online'
      ? 'Live'
      : status === 'offline'
        ? 'Offline: messages wait on this device'
        : status === 'expired'
          ? 'Session ended'
          : status === 'error'
            ? 'Unavailable'
            : 'Connecting…';
  const statusColor =
    status === 'online' ? colors.success : status === 'offline' || status === 'connecting' ? colors.warning : colors.danger;
  const name = (id: string) => state?.people.get(id)?.displayName ?? 'Someone';
  const submit = () => {
    if (!draft.trim() || !client) return;
    client.send(draft);
    setDraft('');
  };
  const title = props.title ?? state?.conversation?.name ?? 'Conversation';

  return (
    <section
      className={props.className}
      aria-label={`Chat: ${title}`}
      style={{
        ...vars,
        display: 'flex',
        flexDirection: 'column',
        height: props.height ?? 520,
        background: 'var(--sc-surface)',
        color: 'var(--sc-text)',
        border: '1px solid var(--sc-border)',
        borderRadius: 16,
        overflow: 'hidden',
        fontFamily: 'Inter, "Plus Jakarta Sans", system-ui, -apple-system, Segoe UI, sans-serif',
        fontSize: 14,
        lineHeight: 1.45,
        boxShadow: '0 12px 32px -16px rgba(0,0,0,.45)',
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 16px',
          borderBottom: '1px solid var(--sc-border)',
          background: 'var(--sc-raised)',
        }}
      >
        <span
          aria-hidden
          style={{
            width: 28,
            height: 28,
            borderRadius: 8,
            display: 'grid',
            placeItems: 'center',
            background: 'var(--sc-accent-soft)',
            color: 'var(--sc-accent)',
            fontWeight: 700,
          }}
        >
          #
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {title}
          </div>
          <div role="status" style={{ fontSize: 12, color: 'var(--sc-muted)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: statusColor }} />
            {statusLabel}
            {state?.conversation ? ` · ${state.conversation.memberIds.length} members` : ''}
          </div>
        </div>
        {props.connectWebUrl && state?.conversation ? (
          <a
            href={`${props.connectWebUrl.replace(/\/+$/, '')}/app?c=${state.conversation.conversationId}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 12, color: 'var(--sc-accent)', textDecoration: 'none', fontWeight: 600 }}
          >
            Open in Connect ↗
          </a>
        ) : null}
      </header>

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!state || (status === 'connecting' && !state.messages.length) ? (
          <p style={{ color: 'var(--sc-subtle)', margin: 'auto' }}>Loading conversation…</p>
        ) : state.error ? (
          <p role="alert" style={{ color: 'var(--sc-danger)', margin: 'auto', textAlign: 'center' }}>
            {state.error}
          </p>
        ) : state.messages.length === 0 && state.pending.length === 0 ? (
          <p style={{ color: 'var(--sc-subtle)', margin: 'auto', textAlign: 'center' }}>
            No messages yet. Start the discussion.
          </p>
        ) : null}
        {state?.messages.map((m) => (
          <MessageRow key={m.messageId} m={m} own={m.senderId === state.userId} name={name(m.senderId)} />
        ))}
        {state?.pending.map((p) => (
          <PendingRow key={p.clientMessageId} p={p} onRetry={() => client?.retry(p.clientMessageId)} onDiscard={() => client?.discard(p.clientMessageId)} />
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--sc-border)' }}
      >
        <textarea
          aria-label="Message"
          value={draft}
          disabled={!state || status === 'expired' || status === 'error'}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={1}
          placeholder={status === 'offline' ? 'Offline: your message will send when you reconnect' : 'Write a message…'}
          style={{
            flex: 1,
            resize: 'none',
            minHeight: 40,
            maxHeight: 120,
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid var(--sc-border)',
            background: 'var(--sc-bg)',
            color: 'var(--sc-text)',
            font: 'inherit',
            outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          style={{
            padding: '0 16px',
            borderRadius: 10,
            border: 0,
            background: 'var(--sc-accent)',
            color: 'var(--sc-accent-fg)',
            fontWeight: 600,
            cursor: draft.trim() ? 'pointer' : 'default',
            opacity: draft.trim() ? 1 : 0.5,
          }}
        >
          Send
        </button>
      </form>
    </section>
  );
}

function MessageRow({ m, own, name }: { m: Message; own: boolean; name: string }) {
  const card = m.metadata.module as ModuleCardMetadata | undefined;
  if (m.deletedAt)
    return <p style={{ color: 'var(--sc-subtle)', fontStyle: 'italic', margin: 0 }}>Message deleted</p>;
  if (card) return <ModuleCard card={card} text={m.content.text} at={m.createdAt} />;
  if (m.messageType === 'system')
    return (
      <p style={{ margin: 0, fontSize: 12.5, color: 'var(--sc-muted)', textAlign: 'center' }}>
        {m.content.text}
      </p>
    );
  return (
    <div style={{ alignSelf: own ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
      {!own ? <div style={{ fontSize: 12, color: 'var(--sc-muted)', marginBottom: 2 }}>{name}</div> : null}
      <div
        style={{
          padding: '8px 12px',
          borderRadius: 14,
          background: own ? 'var(--sc-accent)' : 'var(--sc-bubble)',
          color: own ? 'var(--sc-accent-fg)' : 'var(--sc-text)',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {m.content.text}
      </div>
      <div style={{ fontSize: 11, color: 'var(--sc-subtle)', marginTop: 2, textAlign: own ? 'right' : 'left' }}>
        {time(m.createdAt)}
        {own ? ' · Sent' : ''}
        {m.editedAt ? ' · edited' : ''}
      </div>
    </div>
  );
}

function ModuleCard({ card, text, at }: { card: ModuleCardMetadata; text: string; at: string }) {
  const color = `var(--sc-${TONE[card.tone] === 'info' ? 'accent' : TONE[card.tone]})`;
  const summary = text.includes(': ') ? text.slice(text.indexOf(': ') + 2) : text;
  return (
    <article
      style={{
        border: '1px solid var(--sc-border)',
        borderLeft: `3px solid ${color}`,
        borderRadius: 12,
        padding: '10px 12px',
        background: 'var(--sc-raised)',
      }}
    >
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, color: 'var(--sc-muted)' }}>
        <strong style={{ color }}>{card.eventLabel}</strong>
        <span>{MODULE_CATALOG[card.module].name}</span>
        {card.test ? <span style={{ color: 'var(--sc-warning)' }}>Test</span> : null}
        <span style={{ marginLeft: 'auto' }}>{time(at)}</span>
      </div>
      <div style={{ fontWeight: 600, marginTop: 2 }}>{card.record.title}</div>
      <div style={{ color: 'var(--sc-muted)' }}>{summary}</div>
      {card.facts.length ? (
        <dl style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px', margin: '6px 0 0', fontSize: 12.5 }}>
          {card.facts.map((f) => (
            <div key={f.label} style={{ display: 'flex', gap: 4 }}>
              <dt style={{ color: 'var(--sc-subtle)' }}>{f.label}</dt>
              <dd style={{ margin: 0 }}>
                {/^https?:\/\//.test(f.value) ? (
                  <a href={f.value} target="_blank" rel="noreferrer" style={{ color: 'var(--sc-accent)' }}>
                    Open link
                  </a>
                ) : (
                  f.value
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

function PendingRow({ p, onRetry, onDiscard }: { p: PendingMessage; onRetry: () => void; onDiscard: () => void }) {
  return (
    <div style={{ alignSelf: 'flex-end', maxWidth: '82%', opacity: p.state === 'failed' ? 1 : 0.75 }}>
      <div
        style={{
          padding: '8px 12px',
          borderRadius: 14,
          background: 'var(--sc-accent-soft)',
          color: 'var(--sc-text)',
          border: p.state === 'failed' ? '1px solid var(--sc-danger)' : '1px dashed var(--sc-accent)',
          whiteSpace: 'pre-wrap',
        }}
      >
        {p.text}
      </div>
      <div style={{ fontSize: 11, marginTop: 2, textAlign: 'right', color: p.state === 'failed' ? 'var(--sc-danger)' : 'var(--sc-subtle)' }}>
        {p.state === 'failed' ? (
          <>
            Not sent{p.error ? `: ${p.error}` : ''} ·{' '}
            <button type="button" onClick={onRetry} style={linkBtn}>
              Retry
            </button>{' '}
            ·{' '}
            <button type="button" onClick={onDiscard} style={linkBtn}>
              Discard
            </button>
          </>
        ) : p.state === 'sending' ? (
          'Sending…'
        ) : (
          'Queued: will send when connected'
        )}
      </div>
    </div>
  );
}

const linkBtn: React.CSSProperties = {
  background: 'none',
  border: 0,
  padding: 0,
  color: 'var(--sc-accent)',
  cursor: 'pointer',
  font: 'inherit',
};

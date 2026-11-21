import type { LocalStore } from '../db/store';
import type { ApiTransport, DirectoryUser } from './transport';

export interface SyncResult {
  rounds: number;
  changesApplied: number;
  evicted: number;
}

/**
 * Cursor-based pull sync. The cursor per conversation is the highest changeSequence
 * applied locally; the server returns every create/edit/delete after it. This is what
 * recovers anything missed while offline or while the socket was down: realtime events
 * are an optimisation and never move the cursor.
 */
export class SyncEngine {
  private inflight: Promise<SyncResult> | null = null;

  constructor(
    private readonly store: LocalStore,
    private readonly api: ApiTransport,
    private readonly opts: {
      limitPerConversation?: number;
      maxRounds?: number;
      /** Lays changes made on this device over the server's directory (your own profile). */
      overlay?: (users: DirectoryUser[]) => Promise<DirectoryUser[]>;
    } = {},
  ) {}

  /** Single-flight: concurrent callers share one run. */
  syncAll(): Promise<SyncResult> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async run(): Promise<SyncResult> {
    const maxRounds = this.opts.maxRounds ?? 25;
    let rounds = 0;
    let changesApplied = 0;
    let more = true;
    while (more && rounds < maxRounds) {
      rounds++;
      const cursors = await this.store.cursors();
      const res = await this.api.sync({
        cursors,
        limitPerConversation: this.opts.limitPerConversation ?? 200,
      });
      await this.store.upsertConversations(res.conversations);
      await this.store.purgeConversations(res.revokedConversationIds);
      more = false;
      for (const r of res.results) {
        await this.store.applyServerMessages(r.changes);
        await this.store.applyReceipts(r.receipts);
        await this.store.setCursor(r.conversationId, r.nextCursor);
        changesApplied += r.changes.length;
        if (r.hasMore) more = true;
      }
      // Conversations we just learned about (cursor 0) or that moved ahead need another pass.
      if (!more) {
        const asked = new Set(cursors.map((c) => c.conversationId));
        more = res.conversations.some(
          (c) => !asked.has(c.conversationId) && c.lastChangeSequence > 0,
        );
      }
    }
    const evicted = await this.store.enforceQuota();
    await this.refreshDirectory();
    await this.store.setSetting('sync.lastSuccessAt', new Date().toISOString());
    return { rounds, changesApplied, evicted };
  }

  /**
   * Caches the directory for the UI: names, the people picker and profile photos. Best effort:
   * guests have no directory access. The server's copy is kept as is, and what the screens read
   * is derived from it with your own unsent profile changes laid over (see `overlay`).
   */
  async refreshDirectory(): Promise<void> {
    try {
      const users = await this.api.listUsers();
      await this.store.setSetting('directory.server', JSON.stringify(users));
      await this.deriveDirectory(users);
    } catch {
      // keep whatever names we had
    }
  }

  /** Re-applies your queued profile changes to the cached directory (after an edit or a send). */
  async rederiveDirectory(): Promise<void> {
    const raw = await this.store.getSetting('directory.server');
    if (raw) await this.deriveDirectory(JSON.parse(raw) as DirectoryUser[]);
  }

  private async deriveDirectory(server: DirectoryUser[]): Promise<void> {
    const users = this.opts.overlay ? await this.opts.overlay(server) : server;
    const people = Object.fromEntries(users.map((u) => [u.userId, u.displayName]));
    await this.store.setSetting('people', JSON.stringify(people));
    await this.store.setSetting(
      'avatars',
      JSON.stringify(
        Object.fromEntries(users.filter((u) => u.avatarUrl).map((u) => [u.userId, u.avatarUrl])),
      ),
    );
    // Kept for the people picker and profile cards, so they work offline.
    await this.store.setSetting(
      'directory',
      JSON.stringify(
        users
          .filter((u) => u.status === 'active')
          .map(
            ({
              userId,
              displayName,
              email,
              role,
              title,
              avatarUrl,
              department,
              phone,
              bio,
              timeZone,
            }) => ({
              userId,
              displayName,
              email,
              role,
              title,
              avatarUrl: avatarUrl ?? null,
              department: department ?? null,
              phone: phone ?? null,
              bio: bio ?? null,
              timeZone: timeZone ?? null,
            }),
          ),
      ),
    );
  }
}

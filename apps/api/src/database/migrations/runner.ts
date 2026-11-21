import type { Db } from 'mongodb';
import { initialMigration } from './001-initial.js';
import { attachmentsMigration } from './002-attachments.js';
import { notificationsMigration } from './003-notifications.js';
import { callsMigration } from './004-calls.js';
import { meetingsMigration } from './005-meetings.js';
import { recordingsMigration } from './006-recordings.js';
import { guestsMigration } from './007-guests.js';
import { sampledgeModulesMigration } from './012-sampledge-modules.js';
import { integrationSettingsMigration } from './010-integration-settings.js';
import { bookmarksMigration } from './008-bookmarks.js';
import { scheduledMessagesMigration } from './020-scheduled-messages.js';
import { aiMigration } from './011-ai.js';
import { aiTranscriptsMigration } from './013-ai-transcripts.js';
import { billingMigration } from './021-billing.js';
import { meetingSeriesMigration } from './030-meeting-series.js';
import { launchIndexesMigration } from './031-launch-indexes.js';
import { bookingPagesMigration } from './032-booking-pages.js';
import { networkMigration } from './033-network.js';

export interface Migration {
  id: string;
  up(db: Db): Promise<void>;
}

/** Ordered list. Append only; never edit a migration that has shipped. */
export const MIGRATIONS: Migration[] = [
  initialMigration,
  attachmentsMigration,
  notificationsMigration,
  callsMigration,
  meetingsMigration,
  recordingsMigration,
  guestsMigration,
  integrationSettingsMigration,
  aiMigration,
  sampledgeModulesMigration,
  aiTranscriptsMigration,
  bookmarksMigration,
  scheduledMessagesMigration,
  billingMigration,
  meetingSeriesMigration,
  launchIndexesMigration,
  bookingPagesMigration,
  networkMigration,
];

/**
 * Applies pending migrations in order. A lock document prevents two API
 * replicas from migrating concurrently; migrations themselves are idempotent.
 */
export async function runMigrations(
  db: Db,
  log: (msg: string) => void = () => {},
): Promise<string[]> {
  const state = db.collection<{ _id: string; appliedAt?: Date; lockedAt?: Date }>('_migrations');
  const lockId = '__lock__';
  const staleBefore = new Date(Date.now() - 5 * 60_000);
  try {
    await state.updateOne(
      { _id: lockId, $or: [{ lockedAt: { $exists: false } }, { lockedAt: { $lt: staleBefore } }] },
      { $set: { lockedAt: new Date() } },
      { upsert: true },
    );
  } catch (e) {
    if ((e as { code?: number }).code === 11000)
      throw new Error('Another process is running migrations');
    throw e;
  }
  const applied: string[] = [];
  try {
    for (const m of MIGRATIONS) {
      if (await state.findOne({ _id: m.id })) continue;
      log(`Applying migration ${m.id}`);
      await m.up(db);
      await state.insertOne({ _id: m.id, appliedAt: new Date() });
      applied.push(m.id);
    }
  } finally {
    await state.deleteOne({ _id: lockId });
  }
  return applied;
}

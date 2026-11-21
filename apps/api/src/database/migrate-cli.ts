import { MongoClient } from 'mongodb';
import { loadConfig } from '../config/config.js';
import { runMigrations } from './migrations/runner.js';

const cfg = loadConfig();
const client = await MongoClient.connect(cfg.MONGO_URL);
try {
  const applied = await runMigrations(client.db(cfg.MONGO_DB), console.log);
  console.log(applied.length ? `Applied: ${applied.join(', ')}` : 'Database is up to date');
} finally {
  await client.close();
}

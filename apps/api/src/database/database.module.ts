import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { MongoClient, type Db } from 'mongodb';
import { APP_CONFIG, type AppConfig } from '../config/config.js';
import { runMigrations } from './migrations/runner.js';
import { TenantDb } from './tenant-db.js';

export const MONGO_CLIENT = Symbol('MONGO_CLIENT');
export const MONGO_DB = Symbol('MONGO_DB');

@Global()
@Module({
  providers: [
    {
      provide: MONGO_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (cfg: AppConfig) =>
        MongoClient.connect(cfg.MONGO_URL, { appName: 'sampledge-connect-api' }),
    },
    {
      provide: MONGO_DB,
      inject: [MONGO_CLIENT, APP_CONFIG],
      useFactory: (c: MongoClient, cfg: AppConfig) => c.db(cfg.MONGO_DB),
    },
    { provide: TenantDb, inject: [MONGO_DB], useFactory: (db: Db) => new TenantDb(db) },
  ],
  exports: [MONGO_CLIENT, MONGO_DB, TenantDb],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger('Database');
  constructor(
    @Inject(MONGO_CLIENT) private readonly client: MongoClient,
    @Inject(MONGO_DB) private readonly db: Db,
  ) {}
  async onModuleInit() {
    const applied = await runMigrations(this.db, (m) => this.logger.log(m));
    if (applied.length) this.logger.log(`Applied migrations: ${applied.join(', ')}`);
  }
  async onApplicationShutdown() {
    await this.client.close();
  }
}

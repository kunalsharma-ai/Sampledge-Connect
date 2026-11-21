import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { ApiExceptionFilter } from './common/errors.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuditService } from './audit/audit.service.js';
import { TokenService } from './auth/token.service.js';
import { SessionService } from './auth/session.service.js';
import { AuthService } from './auth/auth.service.js';
import { AuthController } from './auth/auth.controller.js';
import { DirectoryController } from './directory/directory.controller.js';
import { ConversationsService } from './conversations/conversations.service.js';
import {
  ConversationsController,
  MessagesController,
} from './conversations/conversations.controller.js';
import { MessagesService } from './messages/messages.service.js';
import { SyncService } from './sync/sync.service.js';
import { SyncController } from './sync/sync.controller.js';
import { RealtimePublisher } from './realtime/realtime.publisher.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { HealthController } from './health/health.controller.js';
import { AttachmentsController } from './attachments/attachments.controller.js';
import { AttachmentsService } from './attachments/attachments.service.js';
import { FILE_STORAGE, GridFsStorage } from './attachments/file-storage.js';
import { MONGO_DB } from './database/database.module.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import type { Db } from 'mongodb';

@Module({})
export class AppModule {
  static forRoot(cfg: AppConfig): DynamicModule {
    const configModule: DynamicModule = {
      module: class ConfigModule {},
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: cfg }],
      exports: [APP_CONFIG],
    };
    return {
      module: AppModule,
      imports: [configModule, DatabaseModule, RedisModule],
      controllers: [
        AuthController,
        DirectoryController,
        ConversationsController,
        MessagesController,
        SyncController,
        HealthController,
        AttachmentsController,
        NotificationsController,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        AuditService,
        TokenService,
        SessionService,
        AuthService,
        ConversationsService,
        MessagesService,
        SyncService,
        RealtimePublisher,
        RealtimeGateway,
        AttachmentsService,
        NotificationsService,
        {
          provide: FILE_STORAGE,
          inject: [MONGO_DB],
          useFactory: (db: Db) => new GridFsStorage(db),
        },
      ],
    };
  }
}

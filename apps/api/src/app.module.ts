import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from './config/config.js';
import { ApiExceptionFilter } from './common/errors.js';
import { DatabaseModule } from './database/database.module.js';
import { RedisModule } from './redis/redis.module.js';
import { AuditService } from './audit/audit.service.js';
import { RecordingsController } from './recordings/recordings.controller.js';
import { RecordingsService } from './recordings/recordings.service.js';
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
import { PushController } from './push/push.controller.js';
import { PushProviders } from './push/push-provider.js';
import { IntegrationSettingsModule } from './integration-settings/integration-settings.module.js';
import { CallsController } from './calls/calls.controller.js';
import { CallsService } from './calls/calls.service.js';
import { MeetingsController } from './meetings/meetings.controller.js';
import { GuestsController } from './meetings/guests.controller.js';
import { GuestsService } from './meetings/guests.service.js';
import { MailerService } from './mail/mailer.service.js';
import { MeetingsService } from './meetings/meetings.service.js';
import { WorkStore } from './integrations/collections.js';
import { ModuleSettingsService } from './integrations/module-settings.service.js';
import { RecordsService } from './integrations/records.service.js';
import { WebhooksService } from './integrations/webhooks.service.js';
import { ModuleActionsService } from './integrations/module-actions.service.js';
import { ModuleEventsService } from './integrations/module-events.service.js';
import { ModuleKeyGuard, ModuleKeysService } from './integrations/module-keys.service.js';
import { IntegrationApiController } from './integrations/integration-api.controller.js';
import { IntegrationsController } from './integrations/integrations.controller.js';
import { TasksService } from './work/tasks.service.js';
import { ApprovalsService } from './work/approvals.service.js';
import { ProjectsService } from './work/projects.service.js';
import { WorkController } from './work/work.controller.js';
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
      imports: [configModule, DatabaseModule, RedisModule, IntegrationSettingsModule],
      controllers: [
        AuthController,
        RecordingsController,
        DirectoryController,
        ConversationsController,
        MessagesController,
        SyncController,
        HealthController,
        AttachmentsController,
        NotificationsController,
        PushController,
        CallsController,
        MeetingsController,
        GuestsController,
        IntegrationApiController,
        IntegrationsController,
        WorkController,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        AuditService,
        RecordingsService,
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
        CallsService,
        MeetingsService,
        GuestsService,
        MailerService,
        WorkStore,
        ModuleSettingsService,
        RecordsService,
        WebhooksService,
        ModuleActionsService,
        ModuleEventsService,
        ModuleKeysService,
        ModuleKeyGuard,
        TasksService,
        ApprovalsService,
        ProjectsService,
        PushProviders,
        {
          provide: FILE_STORAGE,
          inject: [MONGO_DB],
          useFactory: (db: Db) => new GridFsStorage(db),
        },
      ],
    };
  }
}

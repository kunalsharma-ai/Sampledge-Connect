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
import { MfaService } from './auth/mfa.service.js';
import { AuthService } from './auth/auth.service.js';
import { AuthController } from './auth/auth.controller.js';
import { SsoController } from './auth/sso.controller.js';
import { SsoService } from './auth/sso.service.js';
import { BillingController, PlatformBillingController } from './billing/billing.controller.js';
import { BillingService } from './billing/billing.service.js';
import { BrandingController } from './branding/branding.controller.js';
import { BrandingService } from './branding/branding.service.js';
import { AdminController } from './admin/admin.controller.js';
import { AdminService } from './admin/admin.service.js';
import { PlatformAdmins } from './common/platform-admins.js';
import { DirectoryController } from './directory/directory.controller.js';
import { AvatarsController, ProfileController } from './directory/profile.controller.js';
import { ConversationsService } from './conversations/conversations.service.js';
import {
  ConversationsController,
  MessagesController,
} from './conversations/conversations.controller.js';
import { MessagesService } from './messages/messages.service.js';
import { SyncService } from './sync/sync.service.js';
import { SyncController } from './sync/sync.controller.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { RealtimeGateway } from './realtime/realtime.gateway.js';
import { HealthController } from './health/health.controller.js';
import { Metrics } from './health/metrics.js';
import { AttachmentsController } from './attachments/attachments.controller.js';
import { AttachmentsService } from './attachments/attachments.service.js';
import { FILE_STORAGE, GridFsStorage } from './attachments/file-storage.js';
import { NextcloudIntegration } from './attachments/nextcloud-integration.js';
import { RoutingStorage } from './attachments/routing-storage.js';
import { IntegrationSettingsService } from './integration-settings/integration-settings.service.js';
import { MONGO_DB } from './database/database.module.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { NotificationsService } from './notifications/notifications.service.js';
import { PushController } from './push/push.controller.js';
import { PushProviders } from './push/push-provider.js';
import { IntegrationSettingsModule } from './integration-settings/integration-settings.module.js';
import {
  PlatformIntegrationsController,
  TenantIntegrationsController,
} from './integration-settings/integration-settings.controller.js';
import { BookmarksController } from './bookmarks/bookmarks.controller.js';
import { BookmarksService } from './bookmarks/bookmarks.service.js';
import { SearchController } from './search/search.controller.js';
import { SearchService } from './search/search.service.js';
import { FilesController, FilesService } from './files/files.controller.js';
import { ScheduledMessagesController } from './scheduled/scheduled-messages.controller.js';
import { ScheduledMessagesService } from './scheduled/scheduled-messages.service.js';
import { CallsController } from './calls/calls.controller.js';
import { CallsService } from './calls/calls.service.js';
import { MeetingsController } from './meetings/meetings.controller.js';
import { GuestsController } from './meetings/guests.controller.js';
import { BookingPagesController, PublicBookingController } from './meetings/booking.controller.js';
import { BookingService } from './meetings/booking.service.js';
import { CaptionsService } from './calls/captions.service.js';
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
import { AiController } from './ai/ai.controller.js';
import { AiService } from './ai/ai.service.js';
import { AiIntegration } from './ai/ai-integration.js';
import { TranscriptsService } from './ai/transcripts.service.js';
import { AI_SETTINGS_SOURCE, SwappableSettingsSource } from './ai/settings.js';
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
      imports: [
        configModule,
        DatabaseModule,
        RedisModule,
        RealtimeModule,
        IntegrationSettingsModule,
      ],
      controllers: [
        TenantIntegrationsController,
        PlatformIntegrationsController,
        AuthController,
        SsoController,
        BillingController,
        PlatformBillingController,
        BrandingController,
        AdminController,
        RecordingsController,
        DirectoryController,
        ProfileController,
        AvatarsController,
        ConversationsController,
        MessagesController,
        SyncController,
        HealthController,
        AttachmentsController,
        NotificationsController,
        PushController,
        BookmarksController,
        SearchController,
        FilesController,
        ScheduledMessagesController,
        CallsController,
        MeetingsController,
        GuestsController,
        BookingPagesController,
        PublicBookingController,
        IntegrationApiController,
        IntegrationsController,
        WorkController,
        AiController,
      ],
      providers: [
        { provide: APP_FILTER, useClass: ApiExceptionFilter },
        { provide: Metrics, useValue: new Metrics() },
        AuditService,
        RecordingsService,
        TokenService,
        SessionService,
        AuthService,
        MfaService,
        SsoService,
        BillingService,
        BrandingService,
        AdminService,
        PlatformAdmins,
        ConversationsService,
        MessagesService,
        SyncService,
        RealtimeGateway,
        AttachmentsService,
        NotificationsService,
        BookmarksService,
        SearchService,
        FilesService,
        ScheduledMessagesService,
        CallsService,
        MeetingsService,
        GuestsService,
        BookingService,
        CaptionsService,
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
        AiService,
        AiIntegration,
        TranscriptsService,
        { provide: AI_SETTINGS_SOURCE, useValue: new SwappableSettingsSource() },
        PushProviders,
        NextcloudIntegration,
        {
          provide: FILE_STORAGE,
          inject: [MONGO_DB, IntegrationSettingsService],
          useFactory: (db: Db, settings: IntegrationSettingsService) =>
            new RoutingStorage(new GridFsStorage(db), settings),
        },
      ],
    };
  }
}

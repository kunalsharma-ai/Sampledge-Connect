import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import { IntegrationSettingsService } from './integration-settings.service.js';
import { CoreIntegrationHooks } from './core-providers.js';

/**
 * Global: any module can inject IntegrationSettingsService and register its providers.
 * The admin controllers live in AppModule because they need the auth guard's providers.
 */
@Global()
@Module({
  providers: [IntegrationSettingsService, AuditService, CoreIntegrationHooks],
  exports: [IntegrationSettingsService],
})
export class IntegrationSettingsModule {}

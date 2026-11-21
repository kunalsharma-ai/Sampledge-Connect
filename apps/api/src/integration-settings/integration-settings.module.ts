import { Global, Module } from '@nestjs/common';
import { AuditService } from '../audit/audit.service.js';
import {
  PlatformIntegrationsController,
  TenantIntegrationsController,
} from './integration-settings.controller.js';
import { IntegrationSettingsService } from './integration-settings.service.js';
import { CoreIntegrationHooks } from './core-providers.js';

/** Global: any module can inject IntegrationSettingsService and register its providers. */
@Global()
@Module({
  controllers: [TenantIntegrationsController, PlatformIntegrationsController],
  providers: [IntegrationSettingsService, AuditService, CoreIntegrationHooks],
  exports: [IntegrationSettingsService],
})
export class IntegrationSettingsModule {}

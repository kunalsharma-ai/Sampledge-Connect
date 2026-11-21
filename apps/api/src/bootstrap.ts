import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';
import { ModuleSettingsService } from './integrations/module-settings.service.js';

/** Builds the Nest application (used by main.ts and integration tests). */
export async function createApp(cfg: AppConfig): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(cfg), {
    logger:
      cfg.LOG_LEVEL === 'silent'
        ? false
        : cfg.LOG_LEVEL === 'error'
          ? ['error', 'fatal']
          : undefined,
    bodyParser: true,
    // Connector webhooks and signed module events are verified against the exact bytes (req.rawBody).
    rawBody: true,
  });
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    }),
  );
  app.useBodyParser('json', { limit: '256kb' });
  // LiveKit webhooks are verified against a hash of the exact bytes, so keep them raw.
  app.useBodyParser('raw', { type: 'application/webhook+json', limit: '64kb' });
  // WeChat webhooks are XML.
  app.useBodyParser('text', { type: ['text/xml', 'application/xml'], limit: '256kb' });
  // Chat widget origins are configured per module in the database (Integrations), not env.
  const moduleSettings = app.get(ModuleSettingsService);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin || cfg.corsOrigins.includes(origin)) return cb(null, true);
      moduleSettings.widgetOriginAllowed(origin).then(
        (ok) => cb(null, ok),
        () => cb(null, false),
      );
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Content-Length'],
    maxAge: 600,
  });
  app.useWebSocketAdapter(new RedisIoAdapter(app, cfg));
  app.enableShutdownHooks();
  return app;
}

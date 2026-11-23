import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { API_PREFIX } from '@sampledge/contracts';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config/config.js';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';
import { ModuleSettingsService } from './integrations/module-settings.service.js';
import { Metrics } from './health/metrics.js';

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
  app.use(app.get(Metrics).middleware);
  app.useBodyParser('json', { limit: '256kb' });
  // LiveKit webhooks are verified against a hash of the exact bytes, so keep them raw.
  app.useBodyParser('raw', { type: 'application/webhook+json', limit: '64kb' });
  // WeChat webhooks are XML.
  app.useBodyParser('text', { type: ['text/xml', 'application/xml'], limit: '256kb' });
  // Caption clips and call background images are read per route (common/raw-body.ts): a global
  // audio/* or image/* parser would swallow attachment uploads, which stream their body.
  // Every route lives under /api (issue #128): the gateway sends /api/** here and everything
  // else to the web app, on one address. So the web app and the API share an origin and need
  // no CORS. The one cross-origin caller is the Connect chat widget that organizations embed on
  // their own websites; its origins are configured per module in the database (Integrations).
  // Any other origin gets no CORS headers, so browsers block it.
  app.setGlobalPrefix(API_PREFIX.slice(1));
  const moduleSettings = app.get(ModuleSettingsService);
  app.enableCors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      moduleSettings.widgetOriginAllowed(origin).then(
        (ok) => cb(null, ok),
        () => cb(null, false),
      );
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Content-Length'],
    maxAge: 600,
  });
  app.useWebSocketAdapter(new RedisIoAdapter(app, cfg, moduleSettings));
  app.enableShutdownHooks();
  return app;
}

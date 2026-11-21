import { Logger } from '@nestjs/common';
import { loadConfig } from './config/config.js';
import { createApp } from './bootstrap.js';

const cfg = loadConfig();
const app = await createApp(cfg);
await app.listen(cfg.PORT, '0.0.0.0');
new Logger('Bootstrap').log(`SampConnect API listening on :${cfg.PORT} (${cfg.NODE_ENV})`);

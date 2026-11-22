import { Global, Module } from '@nestjs/common';
import { RealtimePublisher } from './realtime.publisher.js';

/**
 * Global: one RealtimePublisher for the whole app, so services in global modules
 * (integration settings) can emit live changes too.
 */
@Global()
@Module({ providers: [RealtimePublisher], exports: [RealtimePublisher] })
export class RealtimeModule {}

import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../common/errors.js';
import type { TenantContext } from '../common/tenant-context.js';
import { SessionService } from './session.service.js';
import { NetworkGate } from '../network/network-gate.js';

export type AuthedRequest = Request & { ctx?: TenantContext };

/** Requires a valid bearer access token; attaches the TenantContext to the request. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionService,
    private readonly network: NetworkGate,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new AppError('UNAUTHENTICATED', 'Missing bearer token');
    req.ctx = await this.sessions.resolve(header.slice(7));
    // Network sessions reach only network-safe routes (docs/network.md).
    await this.network.check(req.ctx, req.method, req.originalUrl ?? req.url);
    return true;
  }
}

/** Injects the authenticated TenantContext into a controller method. */
export const Ctx = createParamDecorator(
  (_data: unknown, context: ExecutionContext): TenantContext => {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    if (!req.ctx) throw new AppError('UNAUTHENTICATED', 'Not authenticated');
    return req.ctx;
  },
);

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

export type AuthedRequest = Request & { ctx?: TenantContext };

/** Requires a valid bearer access token; attaches the TenantContext to the request. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly sessions: SessionService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer '))
      throw new AppError('UNAUTHENTICATED', 'Missing bearer token');
    req.ctx = await this.sessions.resolve(header.slice(7));
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

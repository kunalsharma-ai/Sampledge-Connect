import { ERROR_CODES, type ApiError, type ErrorCode } from '@sampledge/contracts';
import { ArgumentsHost, Catch, HttpException, Logger, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError, z } from 'zod';

/** Domain error carrying a stable, shared error code. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
    readonly retryAfterMs?: number,
  ) {
    super(message);
  }
  get status(): number {
    return ERROR_CODES[this.code].status;
  }
}

export const forbidden = (msg = 'You do not have permission to do that') =>
  new AppError('FORBIDDEN', msg);
export const notFound = (what = 'Resource') => new AppError('NOT_FOUND', `${what} not found`);

export function toApiError(err: unknown): ApiError {
  if (err instanceof AppError) {
    return {
      code: err.code,
      message: err.message,
      ...(err.details !== undefined ? { details: err.details } : {}),
      ...(err.retryAfterMs !== undefined ? { retryAfterMs: err.retryAfterMs } : {}),
    };
  }
  if (err instanceof ZodError) {
    return {
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: z.flattenError(err),
    };
  }
  if (err instanceof HttpException) {
    const status = err.getStatus();
    const code: ErrorCode =
      status === 404
        ? 'NOT_FOUND'
        : status === 401
          ? 'UNAUTHENTICATED'
          : status === 403
            ? 'FORBIDDEN'
            : status === 413
              ? 'PAYLOAD_TOO_LARGE'
              : status < 500
                ? 'VALIDATION_FAILED'
                : 'INTERNAL';
    return { code, message: err.message };
  }
  return { code: 'INTERNAL', message: 'Internal server error' };
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ApiExceptionFilter');
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const body = toApiError(err);
    if (body.code === 'INTERNAL') this.logger.error(err instanceof Error ? err.stack : String(err));
    if (body.retryAfterMs) res.setHeader('Retry-After', Math.ceil(body.retryAfterMs / 1000));
    res.status(ERROR_CODES[body.code].status).json({ error: body });
  }
}

/** Parse untrusted input with a zod schema, throwing VALIDATION_FAILED. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  return schema.parse(input);
}

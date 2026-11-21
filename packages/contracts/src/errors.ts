import { z } from 'zod';

/**
 * Stable error codes shared by REST and Socket.IO acks.
 * `retryable` tells the offline queue whether to back off and retry
 * or move the message to `failed` for a manual decision.
 */
export const ERROR_CODES = {
  VALIDATION_FAILED: { status: 400, retryable: false },
  UNAUTHENTICATED: { status: 401, retryable: false },
  SESSION_EXPIRED: { status: 401, retryable: true }, // retry after refresh
  FORBIDDEN: { status: 403, retryable: false },
  NOT_FOUND: { status: 404, retryable: false },
  CONFLICT: { status: 409, retryable: false },
  RATE_LIMITED: { status: 429, retryable: true },
  INTERNAL: { status: 500, retryable: true },
  UNAVAILABLE: { status: 503, retryable: true },
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;

export const ApiErrorSchema = z.object({
  code: z.enum(Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]]),
  message: z.string(),
  details: z.unknown().optional(),
  /** Milliseconds; set with RATE_LIMITED. */
  retryAfterMs: z.number().int().nonnegative().optional(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export function isRetryable(code: ErrorCode): boolean {
  return ERROR_CODES[code].retryable;
}

/** Every Socket.IO ack has this envelope. */
export type Ack<T> = { ok: true; data: T } | { ok: false; error: ApiError };

import type { Request } from 'express';
import { AppError } from './errors.js';

/**
 * Reads a raw request body up to `limit` bytes, for the few routes that take binary uploads
 * (caption clips, call background images). Kept per route on purpose: a global raw parser for
 * audio/* or image/* would swallow attachment uploads, which stream their body.
 */
export async function readRawBody(req: Request, limit: number): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    req.resume();
    throw new AppError(
      'VALIDATION_FAILED',
      `The upload must be ${Math.round(limit / 1024)} KB or smaller`,
    );
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) {
      req.resume();
      throw new AppError(
        'VALIDATION_FAILED',
        `The upload must be ${Math.round(limit / 1024)} KB or smaller`,
      );
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

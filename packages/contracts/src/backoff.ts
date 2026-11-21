/**
 * Exponential backoff with "full jitter" (AWS Architecture Blog):
 *   delay = random(0, min(cap, base * 2^attempt))
 * Full jitter spreads reconnect storms after an outage better than
 * fixed exponential steps. A floor keeps tight loops from hammering.
 */
export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  floorMs?: number;
  random?: () => number;
}

export function backoffDelay(attempt: number, opts: BackoffOptions = {}): number {
  const base = opts.baseMs ?? 500;
  const cap = opts.capMs ?? 60_000;
  const floor = opts.floorMs ?? 250;
  const rand = opts.random ?? Math.random;
  const ceiling = Math.min(cap, base * 2 ** Math.max(0, Math.min(attempt, 30)));
  return Math.max(floor, Math.floor(rand() * ceiling));
}

import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';

const BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

/**
 * Prometheus metrics without extra dependencies. Labels stay low-cardinality:
 * the route pattern (`/v1/conversations/:id/messages`), never the raw URL.
 */
export class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly durations = new Map<string, { buckets: number[]; sum: number; count: number }>();
  private readonly loop = monitorEventLoopDelay({ resolution: 20 });
  readonly startedAt = Date.now();

  constructor() {
    this.loop.enable();
  }

  middleware = (req: Request, res: Response, next: NextFunction) => {
    const t0 = process.hrtime.bigint();
    res.on('finish', () => {
      const route = (req.route?.path as string | undefined) ?? 'unmatched';
      if (route.startsWith('/health')) return;
      const seconds = Number(process.hrtime.bigint() - t0) / 1e9;
      const status = `${Math.floor(res.statusCode / 100)}xx`;
      const rk = `${req.method}|${route}|${status}`;
      this.requests.set(rk, (this.requests.get(rk) ?? 0) + 1);
      const dk = `${req.method}|${route}`;
      const d = this.durations.get(dk) ?? { buckets: BUCKETS.map(() => 0), sum: 0, count: 0 };
      BUCKETS.forEach((b, i) => {
        if (seconds <= b) d.buckets[i]!++;
      });
      d.sum += seconds;
      d.count++;
      this.durations.set(dk, d);
    });
    next();
  };

  /** Requests and server errors since this instance started (super admin console health). */
  totals(): { requests: number; serverErrors: number } {
    let requests = 0;
    let serverErrors = 0;
    for (const [k, v] of this.requests) {
      requests += v;
      if (k.endsWith('|5xx')) serverErrors += v;
    }
    return { requests, serverErrors };
  }

  render(extra: Record<string, number>): string {
    const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const out: string[] = [];
    out.push('# HELP sc_http_requests_total HTTP requests by route and status class.');
    out.push('# TYPE sc_http_requests_total counter');
    for (const [k, v] of this.requests) {
      const [method, route, status] = k.split('|');
      out.push(
        `sc_http_requests_total{method="${method}",route="${esc(route!)}",status="${status}"} ${v}`,
      );
    }
    out.push('# HELP sc_http_request_duration_seconds HTTP request latency.');
    out.push('# TYPE sc_http_request_duration_seconds histogram');
    for (const [k, d] of this.durations) {
      const [method, route] = k.split('|');
      const l = `method="${method}",route="${esc(route!)}"`;
      BUCKETS.forEach((b, i) =>
        out.push(`sc_http_request_duration_seconds_bucket{${l},le="${b}"} ${d.buckets[i]}`),
      );
      out.push(`sc_http_request_duration_seconds_bucket{${l},le="+Inf"} ${d.count}`);
      out.push(`sc_http_request_duration_seconds_sum{${l}} ${d.sum}`);
      out.push(`sc_http_request_duration_seconds_count{${l}} ${d.count}`);
    }
    const mem = process.memoryUsage();
    const gauges: Record<string, [string, number]> = {
      sc_process_resident_memory_bytes: ['Resident memory.', mem.rss],
      sc_process_heap_used_bytes: ['V8 heap in use.', mem.heapUsed],
      sc_process_uptime_seconds: ['Seconds since start.', (Date.now() - this.startedAt) / 1000],
      sc_event_loop_delay_p99_seconds: [
        'Event loop delay, 99th percentile.',
        this.loop.percentile(99) / 1e9,
      ],
    };
    for (const [name, v] of Object.entries(extra)) gauges[name] = [name.replace(/_/g, ' '), v];
    for (const [name, [help, v]] of Object.entries(gauges)) {
      out.push(`# HELP ${name} ${help}`, `# TYPE ${name} gauge`, `${name} ${v}`);
    }
    return out.join('\n') + '\n';
  }
}

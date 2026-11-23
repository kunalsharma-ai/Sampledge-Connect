# Monitoring

## Health checks

| Endpoint                | Use                              | Healthy answer                                     |
| ----------------------- | -------------------------------- | -------------------------------------------------- |
| `GET /api/health/live`  | Liveness (restart the container) | `200 {"status":"ok"}`                              |
| `GET /api/health/ready` | Readiness (send traffic)         | `200` with `mongo` and `redis` `ok`; 503 otherwise |
| `GET /login` (web)      | Web liveness                     | `200`                                              |

The Docker images use these as `HEALTHCHECK`s. Point an external uptime monitor at
`https://connect.example.com/api/health/ready` and `https://connect.example.com/login` every minute.

## Metrics (Prometheus)

Set `METRICS_TOKEN` and scrape `GET /api/health/metrics` with `Authorization: Bearer <token>`.
Without the variable the endpoint answers 404. Each API replica reports its own numbers.

```yaml
scrape_configs:
  - job_name: sampledge-connect-api
    scheme: https
    metrics_path: /api/health/metrics
    authorization: { credentials: '<METRICS_TOKEN>' }
    static_configs: [{ targets: ['connect.example.com'] }]
```

| Metric                                                                                        | Type      | Meaning                                                         |
| --------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------- |
| `sc_http_requests_total`                                                                      | counter   | by `method`, `route` (pattern, not raw URL), `status` (2xx…5xx) |
| `sc_http_request_duration_seconds`                                                            | histogram | latency by `method` and `route`                                 |
| `sc_socket_connections`                                                                       | gauge     | open Socket.IO connections on this replica                      |
| `sc_mongo_up`, `sc_redis_up`                                                                  | gauge     | 1 when the dependency answers a ping                            |
| `sc_event_loop_delay_p99_seconds`                                                             | gauge     | Node event loop delay; high = the API is CPU-bound              |
| `sc_process_resident_memory_bytes`, `sc_process_heap_used_bytes`, `sc_process_uptime_seconds` | gauge     | process health                                                  |

## Alerts to start with

| Alert                | Expression (PromQL)                                                                                  | For |
| -------------------- | ---------------------------------------------------------------------------------------------------- | --- |
| API down             | `up{job="sampledge-connect-api"} == 0`                                                               | 2m  |
| Dependency down      | `sc_mongo_up == 0 or sc_redis_up == 0`                                                               | 1m  |
| Server errors        | `sum(rate(sc_http_requests_total{status="5xx"}[5m])) / sum(rate(sc_http_requests_total[5m])) > 0.01` | 10m |
| Slow API             | `histogram_quantile(0.95, sum by (le) (rate(sc_http_request_duration_seconds_bucket[5m]))) > 0.5`    | 10m |
| Event loop saturated | `sc_event_loop_delay_p99_seconds > 0.2`                                                              | 5m  |
| Memory growth        | `sc_process_resident_memory_bytes > 1.5e9`                                                           | 30m |
| Connections dropped  | `sum(sc_socket_connections) < 0.5 * sum(sc_socket_connections offset 10m)` (business hours)          | 5m  |

Also alert on disk space (Mongo volume and recordings spool above 80%) and certificate expiry
from your host monitoring.

## Logs

The API logs to stdout (Nest logger; level from `LOG_LEVEL`, default `info`). Collect with
`docker compose logs`, Loki/Promtail, or your platform's collector. Unexpected errors are
logged with a stack trace by the exception filter; client errors (4xx) are not logged.
Request bodies aren't logged, so message text, passwords and tokens don't reach the logs;
integration secrets are stored encrypted and never returned by the API.

## In the product

- **Administration → Overview** shows failing integrations and the latest security events.
- **Administration → Audit log** records every admin and security action and exports to CSV.
- **Integrations → Sampledge modules → Logs** shows inbound events and outbound actions.
- **Sync Center** (web) shows each device's queue and sync state for support calls.

## Load testing

`apps/api/scripts/load-test.mjs` measures send acknowledgements, fan-out to every connected
device, and history/sync latency against a running API. Run it against staging, never
production data. See [launch-readiness.md](launch-readiness.md).

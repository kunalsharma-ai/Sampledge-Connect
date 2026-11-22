# Analytics

The Analytics module shows how SampConnect is used over the last 7, 30 or 90 days.

- **Who sees what:** owners and admins switch between **Organization** and **Just me**.
  Everyone else sees their own activity only. `GET /v1/analytics?scope=org` returns 403 for
  members.
- **What is counted:**
  - Messages: text messages, excluding deleted messages and system notices.
  - Active people: in the organization view, people who sent a message. In your own view, this
    tile counts the conversations you posted in.
  - Files shared, time in calls (ended calls; your own time on the call in your view), and
    meetings scheduled in the period.
  - Tasks created and completed, approvals decided, and the median time from request to
    decision.
  - Each tile compares with the period before.
- **Charts:**
  - Messages per day, with a hover tooltip and a table view.
  - A weekday × hour heatmap in your time zone.
  - Share by channels, groups and direct messages.
  - Busiest conversations and most active people (organization view only).
- **Privacy:** direct messages are never named. They are counted together as "Direct messages".
- **API:** `GET /v1/analytics?range=7d|30d|90d&scope=org|me&tz=<IANA zone>` returns an
  `AnalyticsResponse` (see `packages/contracts/src/analytics.ts`). Each query is capped at 5
  seconds of database time. Migration `041-analytics` adds indexes for time ranges.
- **Sync:** analytics are computed on request. The screen refreshes every minute while open and
  on reconnect. The last result for each range and view is kept on the device, so it still
  shows, with its time, when you are offline.

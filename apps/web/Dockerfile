# syntax=docker/dockerfile:1.7
# Build from the repository root:
#   docker build -f apps/web/Dockerfile -t sampledge-web .
# The browser reaches the API at /api and call signalling at /rtc on the same address (the
# gateway routes them), so the image works on any domain with the defaults below. Only set
# NEXT_PUBLIC_API_URL / NEXT_PUBLIC_RTC_URL to point a build at another address; they are
# compiled into the browser bundle, so they are build arguments.
FROM node:26.13.1-alpine AS base
RUN npm install -g pnpm@12.21.0
WORKDIR /repo

FROM base AS build
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_RTC_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_RTC_URL=$NEXT_PUBLIC_RTC_URL \
    NEXT_OUTPUT=standalone \
    NEXT_TELEMETRY_DISABLED=1
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages packages
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @sampledge/web...
COPY apps/web apps/web
RUN pnpm --filter @sampledge/web... build

FROM node:26.13.1-alpine AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /repo/apps/web/.next/standalone ./
COPY --from=build --chown=app:app /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=app:app /repo/apps/web/public ./apps/web/public
USER app
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/login >/dev/null || exit 1
CMD ["node", "apps/web/server.js"]

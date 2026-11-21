# syntax=docker/dockerfile:1.7
# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:26.13.1-alpine AS base
RUN npm install -g pnpm@12.21.0
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @sampledge/api...
COPY packages/contracts packages/contracts
COPY apps/api apps/api
RUN pnpm --filter @sampledge/api... build \
 && pnpm --filter @sampledge/api deploy --prod --legacy /out

FROM node:26.13.1-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Fonts for PDF minutes and chat exports in non-Latin scripts (Hindi and other Indic scripts,
# Chinese, Japanese, Korean, Arabic, Hebrew, Thai). Latin, Greek and Cyrillic are bundled in
# assets/fonts. Build with --build-arg PDF_FONTS= to leave them out (about 120 MB).
ARG PDF_FONTS="font-noto font-noto-cjk font-noto-arabic font-noto-hebrew font-noto-devanagari font-noto-bengali font-noto-gujarati font-noto-gurmukhi font-noto-tamil font-noto-telugu font-noto-kannada font-noto-malayalam font-noto-thai"
RUN if [ -n "$PDF_FONTS" ]; then apk add --no-cache $PDF_FONTS; fi
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /out ./
USER app
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s CMD wget -qO- http://127.0.0.1:4000/health/live || exit 1
CMD ["node", "dist/main.js"]

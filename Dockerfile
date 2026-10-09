# AI Talk Self-hosted image
# Build: docker build -t aitalk-selfhosted .     Run: docker/docker-compose.yml (docker compose up -d in the install folder)
# Built without any NEXT_PUBLIC_* values, so nothing environment-specific is baked into the browser bundle (.dockerignore drops .env*)

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=1 NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
# 4 GB heap is enough for the build; more can exhaust an 8 GB Docker VM
# Page data collection imports server modules during the build — background jobs are switched off so they do not look for a database,
#   and the edition is set as at run time so Cloud-only settings are not reported missing
RUN npx prisma generate && AITALK_BACKGROUND_JOBS=off AITALK_EDITION=selfhosted \
    NODE_OPTIONS=--max-old-space-size=4096 npm run build

FROM node:22-bookworm-slim
WORKDIR /app
# Edition = Self-hosted · files = volume /data/files (can be changed in settings)
# CHECKPOINT_DISABLE stops Prisma tooling from checking checkpoint.prisma.io for updates (offline installs)
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 CHECKPOINT_DISABLE=1 AITALK_EDITION=selfhosted FILE_STORE_DIR=/data/files PORT=3000
# tini as PID 1 — docker stop reaches the whole process group, also during start checks and migrations
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app /app
# A named volume takes the owner of this folder (node = 1000) when it is first mounted
RUN mkdir -p /data/files /app/tmp && chown -R node:node /data /app/tmp
USER node
EXPOSE 3000
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/app/docker/entrypoint.sh"]

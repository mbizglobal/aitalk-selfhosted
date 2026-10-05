#!/bin/sh
# Start: the server starts only after the start checks pass (settings → database → pgvector → migrations)
set -e
cd /app
node_modules/.bin/tsx docker/start-checks.ts
exec node_modules/.bin/tsx server.ts

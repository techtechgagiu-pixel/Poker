#!/usr/bin/env bash
# Build, upload static files to R2, apply D1 migrations and deploy the Worker.
# Usage: scripts/deploy.sh [production|staging]
set -euo pipefail
ENV=${1:-production}
cd "$(dirname "$0")/.."
npm test
npm run build
if [ "$ENV" = staging ]; then
  scripts/upload-static.sh remi-static-staging
  npx wrangler d1 migrations apply remi-staging --remote --env staging
  npx wrangler deploy --env staging
else
  scripts/upload-static.sh remi-static
  npx wrangler d1 migrations apply remi-production --remote
  npx wrangler deploy
fi

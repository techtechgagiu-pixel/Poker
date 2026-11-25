#!/usr/bin/env bash
# Upload dist/ to the R2 static bucket. Usage: ./scripts/upload-static.sh [remi-static|remi-static-staging]
set -euo pipefail
BUCKET=${1:-remi-static}
cd "$(dirname "$0")/.."
find dist -type f ! -name '_headers' | while read -r f; do
  key=${f#dist/}
  npx wrangler r2 object put "$BUCKET/$key" --file "$f" --remote >/dev/null
  echo "uploaded $key"
done

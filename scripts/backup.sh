#!/usr/bin/env bash
# Nightly OpenSearch snapshot into the repository volume.
#
#   ./scripts/backup.sh              # take a snapshot
#   ./scripts/backup.sh --register   # one-time repository setup
#
# The snapshot path must be listed in opensearch.yml as `path.repo`, or set
# OPENSEARCH_SNAPSHOT_DIR and mount it into the opensearch container.
set -euo pipefail

OPENSEARCH_URL="${OPENSEARCH_URL:-http://localhost:9200}"
REPO="${OPENSEARCH_SNAPSHOT_REPO:-memory-snapshots}"
SNAPSHOT_DIR="${OPENSEARCH_SNAPSHOT_DIR:-/usr/share/opensearch/snapshots}"
KEEP="${OPENSEARCH_SNAPSHOT_KEEP:-14}"

api() {
  local method="$1" path="$2" body="${3:-}"
  if [ -n "$body" ]; then
    curl -fsS -X "$method" "$OPENSEARCH_URL$path" -H 'Content-Type: application/json' -d "$body"
  else
    curl -fsS -X "$method" "$OPENSEARCH_URL$path"
  fi
}

if [ "${1:-}" = "--register" ]; then
  api PUT "/_snapshot/$REPO" "{\"type\":\"fs\",\"settings\":{\"location\":\"$SNAPSHOT_DIR\",\"compress\":true}}"
  echo "registered repository $REPO -> $SNAPSHOT_DIR"
  exit 0
fi

name="memory-$(date -u +%Y%m%d-%H%M%S)"
api PUT "/_snapshot/$REPO/$name?wait_for_completion=true" \
  '{"indices":"memories,projects","include_global_state":false}' >/dev/null
echo "snapshot $name created"

# Retention: drop everything past the newest $KEEP.
mapfile -t old < <(
  api GET "/_snapshot/$REPO/_all" \
    | grep -o '"snapshot":"[^"]*"' | cut -d'"' -f4 | sort | head -n "-$KEEP"
)
for snap in "${old[@]:-}"; do
  [ -z "$snap" ] && continue
  api DELETE "/_snapshot/$REPO/$snap" >/dev/null && echo "pruned $snap"
done

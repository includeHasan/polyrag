#!/usr/bin/env bash
# ============================================================================
# Tear down RAG platform infrastructure. Stops containers; does NOT remove
# volumes (use podman-down.sh --volumes to also remove them).
# ============================================================================
set -euo pipefail

REMOVE_VOLUMES=false
if [[ "${1:-}" == "--volumes" || "${1:-}" == "-v" ]]; then
  REMOVE_VOLUMES=true
fi

CONTAINERS=(rag-qdrant rag-postgres rag-redis rag-elasticsearch rag-minio)

for c in "${CONTAINERS[@]}"; do
  if podman ps -a --format '{{.Names}}' | grep -q "^${c}$"; then
    echo "==> Stopping $c"
    podman stop "$c" 2>/dev/null || true
    echo "==> Removing $c"
    podman rm "$c" 2>/dev/null || true
  else
    echo "    $c not present, skipping"
  fi
done

if $REMOVE_VOLUMES; then
  for v in rag-qdrant-data rag-postgres-data rag-redis-data rag-elasticsearch-data rag-minio-data; do
    if podman volume exists "$v" 2>/dev/null; then
      echo "==> Removing volume $v"
      podman volume rm "$v" 2>/dev/null || true
    fi
  done
fi

echo "==> Done."

#!/usr/bin/env bash
# ============================================================================
# Bring up RAG platform infrastructure with podman.
# Creates a `rag-platform` pod with shared network, then individual containers.
# ============================================================================
set -euo pipefail

POD_NAME="rag-platform"
NETWORK_NAME="rag-platform"

echo "==> Creating podman network '$NETWORK_NAME' (if missing)"
if ! podman network exists "$NETWORK_NAME" 2>/dev/null; then
  podman network create "$NETWORK_NAME"
else
  echo "    (already exists)"
fi

# ---- 1. Qdrant (vector DB) ----
if ! podman ps -a --format '{{.Names}}' | grep -q '^rag-qdrant$'; then
  echo "==> Starting Qdrant (rag-qdrant)"
  podman run -d \
    --name rag-qdrant \
    --network "$NETWORK_NAME" \
    -p 6333:6333 \
    -p 6334:6334 \
    -v rag-qdrant-data:/qdrant/storage:z \
    docker.io/qdrant/qdrant:latest
else
  echo "==> Qdrant (rag-qdrant) already exists, starting if not running"
  podman start rag-qdrant 2>/dev/null || true
fi

# ---- 2. Postgres ----
if ! podman ps -a --format '{{.Names}}' | grep -q '^rag-postgres$'; then
  echo "==> Starting Postgres (rag-postgres)"
  podman run -d \
    --name rag-postgres \
    --network "$NETWORK_NAME" \
    -p 5432:5432 \
    -e POSTGRES_USER=rag \
    -e POSTGRES_PASSWORD=rag \
    -e POSTGRES_DB=rag \
    -v rag-postgres-data:/var/lib/postgresql/data:z \
    docker.io/library/postgres:16-alpine
else
  echo "==> Postgres (rag-postgres) already exists, starting if not running"
  podman start rag-postgres 2>/dev/null || true
fi

# ---- 3. Redis ----
if ! podman ps -a --format '{{.Names}}' | grep -q '^rag-redis$'; then
  echo "==> Starting Redis (rag-redis)"
  podman run -d \
    --name rag-redis \
    --network "$NETWORK_NAME" \
    -p 6379:6379 \
    -v rag-redis-data:/data:z \
    docker.io/library/redis:7-alpine \
    redis-server --appendonly yes
else
  echo "==> Redis (rag-redis) already exists, starting if not running"
  podman start rag-redis 2>/dev/null || true
fi

# ---- 4. Elasticsearch ----
if ! podman ps -a --format '{{.Names}}' | grep -q '^rag-elasticsearch$'; then
  echo "==> Starting Elasticsearch (rag-elasticsearch)"
  podman run -d \
    --name rag-elasticsearch \
    --network "$NETWORK_NAME" \
    -p 9200:9200 \
    -e discovery.type=single-node \
    -e xpack.security.enabled=false \
    -e ES_JAVA_OPTS="-Xms512m -Xmx512m" \
    -v rag-elasticsearch-data:/usr/share/elasticsearch/data:z \
    docker.io/library/elasticsearch:8.13.0
else
  echo "==> Elasticsearch (rag-elasticsearch) already exists, starting if not running"
  podman start rag-elasticsearch 2>/dev/null || true
fi

# ---- 5. MinIO (S3-compatible) ----
if ! podman ps -a --format '{{.Names}}' | grep -q '^rag-minio$'; then
  echo "==> Starting MinIO (rag-minio)"
  podman run -d \
    --name rag-minio \
    --network "$NETWORK_NAME" \
    -p 9000:9000 \
    -p 9001:9001 \
    -e MINIO_ROOT_USER=minioadmin \
    -e MINIO_ROOT_PASSWORD=minioadmin \
    -v rag-minio-data:/data:z \
    docker.io/minio/minio:latest \
    server /data --console-address ":9001"
else
  echo "==> MinIO (rag-minio) already exists, starting if not running"
  podman start rag-minio 2>/dev/null || true
fi

echo ""
echo "==> Waiting for services to become healthy..."
sleep 3

echo ""
echo "==> Status:"
podman ps --filter "network=$NETWORK_NAME" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

echo ""
echo "==> Health check:"
for url in \
  "http://localhost:6333/healthz|Qdrant" \
  "http://localhost:9200/_cluster/health?wait_for_status=yellow&timeout=5s|Elasticsearch" \
  "http://localhost:9000/minio/health/live|MinIO" \
; do
  endpoint="${url%|*}"
  name="${url##*|}"
  status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$endpoint" 2>/dev/null || echo "down")
  echo "    $name: HTTP $status"
done

# Redis ping
redis_ok=$(podman exec rag-redis redis-cli ping 2>/dev/null || echo "ERR")
echo "    Redis: $redis_ok"

# Postgres ping
pg_ok=$(podman exec rag-postgres pg_isready -U rag 2>/dev/null || echo "ERR")
echo "    Postgres: $pg_ok"

echo ""
echo "==> Infrastructure is up."
echo "    MinIO console:  http://localhost:9001  (minioadmin / minioadmin)"
echo "    Run 'npm run dev' to start the API on :3000"

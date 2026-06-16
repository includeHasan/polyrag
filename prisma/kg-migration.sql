-- Phase 4: Knowledge Graph tables (entities, entity_mentions, entity_relations).
-- Applied non-destructively — does NOT touch pre-existing tables.

CREATE TABLE IF NOT EXISTS "entities" (
    "id" UUID NOT NULL,
    "tenantId" UUID,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "documentId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "entity_mentions" (
    "id" UUID NOT NULL,
    "entityId" UUID NOT NULL,
    "chunkId" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "context" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "entity_mentions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "entity_relations" (
    "id" UUID NOT NULL,
    "fromEntityId" UUID NOT NULL,
    "toEntityId" UUID NOT NULL,
    "relation" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "documentId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entity_relations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "entities_name_idx" ON "entities"("name");
CREATE INDEX IF NOT EXISTS "entities_tenantId_idx" ON "entities"("tenantId");
CREATE INDEX IF NOT EXISTS "entities_type_idx" ON "entities"("type");
CREATE INDEX IF NOT EXISTS "entities_documentId_idx" ON "entities"("documentId");

CREATE INDEX IF NOT EXISTS "entity_mentions_entityId_idx" ON "entity_mentions"("entityId");
CREATE INDEX IF NOT EXISTS "entity_mentions_chunkId_idx" ON "entity_mentions"("chunkId");

CREATE INDEX IF NOT EXISTS "entity_relations_fromEntityId_idx" ON "entity_relations"("fromEntityId");
CREATE INDEX IF NOT EXISTS "entity_relations_toEntityId_idx" ON "entity_relations"("toEntityId");
CREATE INDEX IF NOT EXISTS "entity_relations_relation_idx" ON "entity_relations"("relation");
CREATE INDEX IF NOT EXISTS "entity_relations_documentId_idx" ON "entity_relations"("documentId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_mentions_entityId_fkey') THEN
        ALTER TABLE "entity_mentions" ADD CONSTRAINT "entity_mentions_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_relations_fromEntityId_fkey') THEN
        ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_fromEntityId_fkey" FOREIGN KEY ("fromEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_relations_toEntityId_fkey') THEN
        ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_toEntityId_fkey" FOREIGN KEY ("toEntityId") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;

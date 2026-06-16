/**
 * Compose prisma/schema.prisma from prisma/models/*.prisma.
 *
 * Usage: npm run prisma:build
 *
 * Prisma does not natively support multiple .prisma files, so we maintain
 * logically-grouped model files as the source of truth and concatenate them
 * with the datasource + generator blocks into the canonical schema.prisma.
 */
import { readFile, writeFile, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODELS_DIR = join(__dirname, "models");
const OUT_FILE = join(__dirname, "schema.prisma");

const HEADER = `// ============================================================================
// GENERATED FILE — DO NOT EDIT.
// Source: prisma/models/*.prisma (concatenated by prisma/build.ts).
// To regenerate: npm run prisma:build
// ============================================================================

generator client {
  provider = "prisma-client-js"
  output   = "../node_modules/.prisma/client"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

`;

async function main() {
  const files = (await readdir(MODELS_DIR))
    .filter((f) => f.endsWith(".prisma"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No .prisma files found in ${MODELS_DIR}`);
  }

  const parts: string[] = [];
  for (const f of files) {
    const content = await readFile(join(MODELS_DIR, f), "utf-8");
    parts.push(`// ---- ${f} ----\n\n${content.trim()}\n`);
  }

  const composed = HEADER + parts.join("\n");
  await writeFile(OUT_FILE, composed, "utf-8");
  console.log(`Wrote ${OUT_FILE} from ${files.length} model files: ${files.join(", ")}`);
}

main().catch((err) => {
  console.error("prisma:build failed:", err);
  process.exit(1);
});

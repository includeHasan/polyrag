/**
 * S3-compatible object storage (AWS S3 or MinIO).
 *
 * The S3Client is created lazily via `getS3()`. Configuration supports
 * MinIO out of the box (`forcePathStyle: true` + custom `endpoint`).
 *
 * Helper API:
 *   - `getS3()`         — lazy S3Client
 *   - `ensureBucket()`  — create the configured bucket if missing
 *   - `putObject(key, body, contentType?)`
 *   - `getObject(key)`  — returns the raw `GetObjectCommandOutput` body stream
 *   - `deleteObject(key)`
 *   - `objectExists(key)`
 */
import {
  S3Client,
  HeadBucketCommand,
  CreateBucketCommand,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  NotFound,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { env } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { RagError } from "../shared/errors.js";

let s3: S3Client | undefined;

/**
 * Build (or return) the shared S3Client. Compatible with MinIO when
 * `S3_FORCE_PATH_STYLE=true` and `S3_ENDPOINT` points at it.
 */
export function getS3(): S3Client {
  if (s3) return s3;

  s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY,
      secretAccessKey: env.S3_SECRET_KEY,
    },
  });

  logger.info(
    {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
    },
    "S3 client created",
  );

  return s3;
}

/**
 * Create the configured bucket if it does not already exist. Idempotent.
 */
export async function ensureBucket(bucket: string = env.S3_BUCKET): Promise<void> {
  const client = getS3();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    logger.debug({ bucket }, "S3 bucket exists");
  } catch (cause) {
    // NotFound OR NoSuchBucket — try to create.
    const code = (cause as { name?: string; $metadata?: { httpStatusCode?: number } })?.name;
    const status = (cause as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    if (code !== "NotFound" && code !== "NoSuchBucket" && status !== 404) {
      // Unknown error — re-throw wrapped.
      throw new RagError(
        "S3_HEAD_BUCKET_ERROR",
        `HeadBucket failed for ${bucket}: ${(cause as Error).message ?? String(cause)}`,
        cause,
      );
    }
    try {
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
      logger.info({ bucket }, "S3 bucket created");
    } catch (createErr) {
      throw new RagError(
        "S3_CREATE_BUCKET_ERROR",
        `CreateBucket failed for ${bucket}: ${(createErr as Error).message ?? String(createErr)}`,
        createErr,
      );
    }
  }
}

/**
 * Upload an object. `body` may be a string, Buffer, or a `Readable` stream.
 * Returns the etag on success.
 */
export async function putObject(
  key: string,
  body: PutObjectCommandInput["Body"],
  contentType?: string,
  bucket: string = env.S3_BUCKET,
): Promise<string> {
  try {
    const res = await getS3().send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    return res.ETag ?? "";
  } catch (cause) {
    throw new RagError(
      "S3_PUT_ERROR",
      `PutObject failed for ${bucket}/${key}: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/**
 * Download an object. Returns the full `GetObjectCommandOutput` so callers
 * can stream the `Body` and read `ContentType` / `ContentLength`.
 */
export async function getObject(key: string, bucket: string = env.S3_BUCKET) {
  try {
    return await getS3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  } catch (cause) {
    throw new RagError(
      "S3_GET_ERROR",
      `GetObject failed for ${bucket}/${key}: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/** Delete an object. No error if the object does not exist. */
export async function deleteObject(key: string, bucket: string = env.S3_BUCKET): Promise<void> {
  try {
    await getS3().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } catch (cause) {
    throw new RagError(
      "S3_DELETE_ERROR",
      `DeleteObject failed for ${bucket}/${key}: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/** Return `true` iff the object exists. */
export async function objectExists(key: string, bucket: string = env.S3_BUCKET): Promise<boolean> {
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (cause) {
    if (
      cause instanceof NotFound ||
      (cause as { name?: string })?.name === "NotFound" ||
      (cause as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === 404
    ) {
      return false;
    }
    throw new RagError(
      "S3_HEAD_OBJECT_ERROR",
      `HeadObject failed for ${bucket}/${key}: ${(cause as Error).message ?? String(cause)}`,
      cause,
    );
  }
}

/**
 * Web connector. Fetches a URL, strips scripts/styles via `cheerio`, and
 * returns the visible text as a single Document with `source: "url"`.
 */
import * as cheerio from "cheerio";
import { v4 as uuidv4 } from "uuid";
import { IngestionError } from "@/core/shared/errors.js";
import { logger } from "@/core/shared/logger.js";
import type { Document } from "@/core/shared/types.js";
import { BaseConnector, type BaseConnectorOptions } from "./base.js";

export class WebConnector extends BaseConnector {
  readonly kind = "url" as const;

  constructor(opts: BaseConnectorOptions) {
    super(opts);
    if (!opts.request.url) {
      throw new IngestionError("WebConnector requires request.url");
    }
  }

  async connect(): Promise<void> {
    /* nothing to open; we fetch on `load()`. */
  }

  async load(): Promise<Document[]> {
    const url = this.request.url!;

    let res: Response;
    try {
      res = await fetch(url, {
        headers: { "user-agent": "advanced-rag-platform/0.1 (+ingest)" },
        redirect: "follow",
      });
    } catch (err) {
      this.wrap(`fetch ${url}`, err);
    }

    if (!res.ok) {
      throw new IngestionError(
        `fetch ${url} returned HTTP ${res.status} ${res.statusText}`,
      );
    }

    const html = await res.text();
    const $ = cheerio.load(html);

    // Drop non-content nodes before extracting text.
    $("script, style, noscript, iframe, header nav, footer nav, aside").remove();

    const title =
      $("title").first().text().trim() ||
      $('meta[property="og:title"]').attr("content")?.trim() ||
      url;

    // `text()` collapses whitespace by default; normalize afterwards.
    const content = $("body").text().replace(/\s+/g, " ").trim();

    const doc: Document = {
      id: uuidv4(),
      source: "url",
      uri: url,
      title,
      content,
      metadata: {
        format: "html",
        url,
        contentType: res.headers.get("content-type") ?? undefined,
        fetchedAt: new Date().toISOString(),
      },
    };

    logger.info(
      { documentId: doc.id, url, chars: content.length, status: res.status },
      "loaded URL",
    );
    return [doc];
  }
}

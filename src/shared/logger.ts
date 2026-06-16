/**
 * Centralized logger (pino). Single import point for the whole app.
 */
import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  level,
  base: { service: "advanced-rag-platform" },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l", ignore: "pid,hostname,service" },
        },
      }
    : {}),
});

export type Logger = typeof logger;

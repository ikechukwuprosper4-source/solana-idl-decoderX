import "dotenv/config";
import Redis from "ioredis";
import { createApp } from "./app";
import { IdlRegistryService } from "./services/idlRegistry";
import { IdlDecoderService } from "./services/decoder";
import { TransactionFetcherService } from "./services/transactionFetcher";
import { logger } from "./utils/logger";

const PORT = parseInt(process.env.PORT || "3000", 10);
const REDIS_URL = process.env.REDIS_URL;

async function bootstrap(): Promise<void> {
  // ── Redis (optional) ───────────────────────────────────────────────────────
  let redisClient: Redis | null = null;

  if (REDIS_URL) {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    try {
      await redisClient.connect();
      logger.info("Connected to Redis", { url: REDIS_URL.replace(/:\/\/.*@/, "://*@") });
    } catch (err) {
      logger.warn("Redis connection failed; falling back to in-memory store", {
        error: (err as Error).message,
      });
      redisClient = null;
    }
  } else {
    logger.info("REDIS_URL not set; using in-memory store (data resets on restart)");
  }

  // ── Services ───────────────────────────────────────────────────────────────
  const registry = new IdlRegistryService(redisClient);
  await registry.initialize();

  const decoder = new IdlDecoderService();
  const fetcher = new TransactionFetcherService();

  // ── App ────────────────────────────────────────────────────────────────────
  const app = createApp(registry, decoder, fetcher);

  const server = app.listen(PORT, () => {
    logger.info(`🚀 Solana IDL Decoder API started`, {
      port: PORT,
      env: process.env.NODE_ENV || "development",
      programs: registry.count(),
    });
  });

  // ── Graceful Shutdown ──────────────────────────────────────────────────────
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    server.close(async () => {
      if (redisClient) await redisClient.quit();
      logger.info("Server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { error: err.message, stack: err.stack });
    process.exit(1);
  });
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason });
    process.exit(1);
  });
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});

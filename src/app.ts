import express, { Application } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import morgan from "morgan";
import rateLimit from "express-rate-limit";

import { IdlRegistryService } from "./services/idlRegistry";
import { IdlDecoderService } from "./services/decoder";
import { TransactionFetcherService } from "./services/transactionFetcher";
import { createHealthRouter } from "./routes/health";
import { createProgramsRouter } from "./routes/programs";
import { createDecodeRouter } from "./routes/decode";
import { errorHandler, notFound } from "./middleware/errorHandler";

export function createApp(
  registry: IdlRegistryService,
  decoder: IdlDecoderService,
  fetcher: TransactionFetcherService
): Application {
  const app = express();

  // ── Security & General Middleware ──────────────────────────────────────────
  app.use(helmet());
  app.use(
    cors({
      origin: process.env.CORS_ORIGIN || "*",
      methods: ["GET", "POST", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(compression());
  app.use(express.json({ limit: "2mb" }));

  if (process.env.NODE_ENV !== "test") {
    app.use(
      morgan(process.env.NODE_ENV === "production" ? "combined" : "dev")
    );
  }

  // ── Rate Limiting ──────────────────────────────────────────────────────────
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX || "200"),
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      success: false,
      error: "Too Many Requests",
      message: "Rate limit exceeded. Please try again later.",
      timestamp: new Date().toISOString(),
    },
  });
  app.use("/api", limiter);

  // ── Routes ─────────────────────────────────────────────────────────────────
  app.use("/health", createHealthRouter(registry));
  app.use("/api/programs", createProgramsRouter(registry, decoder));
  app.use("/api/decode", createDecodeRouter(registry, decoder, fetcher));

  // ── 404 & Error Handler ────────────────────────────────────────────────────
  app.use(notFound);
  app.use(errorHandler);

  return app;
}

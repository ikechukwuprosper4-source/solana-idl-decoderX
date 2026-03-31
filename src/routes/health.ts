import { Router, Request, Response } from "express";
import { IdlRegistryService } from "../services/idlRegistry";

export function createHealthRouter(registry: IdlRegistryService): Router {
  const router = Router();
  const startedAt = new Date().toISOString();

  /**
   * GET /health
   * Basic liveness check — used by Docker health checks and load balancers
   */
  router.get("/", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "solana-idl-decoder",
      version: process.env.npm_package_version || "1.0.0",
      uptime: process.uptime(),
      startedAt,
      timestamp: new Date().toISOString(),
    });
  });

  /**
   * GET /health/ready
   * Readiness check — confirms the registry is loaded
   */
  router.get("/ready", (_req: Request, res: Response) => {
    const programCount = registry.count();
    res.json({
      status: "ready",
      registeredPrograms: programCount,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}

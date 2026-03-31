import { Router, Request, Response } from "express";
import { IdlRegistryService } from "../services/idlRegistry";
import { IdlDecoderService } from "../services/decoder";
import { validate, registerIdlSchema } from "../middleware/validate";
import {
  asyncHandler,
  createHttpError,
} from "../middleware/errorHandler";
import { ApiResponse, PaginatedResponse } from "../types";
import { Idl } from "@coral-xyz/anchor";

export function createProgramsRouter(
  registry: IdlRegistryService,
  decoder: IdlDecoderService
): Router {
  const router = Router();

  /**
   * GET /api/programs
   * List all registered programs
   */
  router.get(
    "/",
    asyncHandler(async (req: Request, res: Response) => {
      const programs = registry.list();
      const response: PaginatedResponse<(typeof programs)[0]> = {
        success: true,
        data: programs,
        total: programs.length,
        page: 1,
        limit: programs.length,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    })
  );

  /**
   * GET /api/programs/:programId
   * Get full IDL and metadata for a program
   */
  router.get(
    "/:programId",
    asyncHandler(async (req: Request, res: Response) => {
      const { programId } = req.params;
      const program = registry.get(programId);

      if (!program) {
        throw createHttpError(
          404,
          `No IDL registered for program: ${programId}`
        );
      }

      const response: ApiResponse = {
        success: true,
        data: program,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    })
  );

  /**
   * GET /api/programs/:programId/discriminators
   * List all instruction discriminators for a program
   */
  router.get(
    "/:programId/discriminators",
    asyncHandler(async (req: Request, res: Response) => {
      const { programId } = req.params;
      const program = registry.get(programId);

      if (!program) {
        throw createHttpError(
          404,
          `No IDL registered for program: ${programId}`
        );
      }

      const discriminators = decoder.listDiscriminators(program.idl);
      const response: ApiResponse = {
        success: true,
        data: {
          programId,
          programName: program.idl.name,
          discriminators,
        },
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    })
  );

  /**
   * POST /api/programs
   * Register a new IDL (or update an existing one)
   */
  router.post(
    "/",
    validate(registerIdlSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { programId, idl } = req.body as {
        programId: string;
        idl: Idl;
      };

      // Validate IDL structure before registering
      const issues = decoder.validateIdl(idl);
      if (issues.length > 0) {
        throw createHttpError(400, `Invalid IDL: ${issues.join("; ")}`);
      }

      const program = await registry.register(programId, idl);

      const response: ApiResponse = {
        success: true,
        message: `IDL registered for program ${programId}`,
        data: {
          programId: program.programId,
          name: program.name,
          instructionCount: idl.instructions.length,
          registeredAt: program.registeredAt,
          updatedAt: program.updatedAt,
        },
        timestamp: new Date().toISOString(),
      };
      res.status(201).json(response);
    })
  );

  /**
   * DELETE /api/programs/:programId
   * Remove a program's IDL from the registry
   */
  router.delete(
    "/:programId",
    asyncHandler(async (req: Request, res: Response) => {
      const { programId } = req.params;
      const removed = await registry.remove(programId);

      if (!removed) {
        throw createHttpError(
          404,
          `No IDL registered for program: ${programId}`
        );
      }

      const response: ApiResponse = {
        success: true,
        message: `IDL removed for program ${programId}`,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    })
  );

  return router;
}

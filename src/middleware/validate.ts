import { Request, Response, NextFunction } from "express";
import { z, ZodSchema } from "zod";
import { ApiResponse } from "../types";

/** Wraps a Zod schema into an Express middleware that validates req.body */
export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(
        (e) => `${e.path.join(".")}: ${e.message}`
      );
      const response: ApiResponse = {
        success: false,
        error: "Validation failed",
        message: errors.join("; "),
        timestamp: new Date().toISOString(),
      };
      res.status(400).json(response);
      return;
    }
    req.body = result.data;
    next();
  };
}

// ─── Schemas ───────────────────────────────────────────────────────────────────

export const registerIdlSchema = z.object({
  programId: z
    .string()
    .min(32)
    .max(44)
    .describe("Base-58 Solana program address"),
  idl: z
    .object({
      version: z.string(),
      name: z.string().min(1),
      instructions: z.array(
        z.object({
          name: z.string(),
          accounts: z.array(z.object({ name: z.string() }).passthrough()),
          args: z.array(z.object({ name: z.string() }).passthrough()),
        })
      ),
    })
    .passthrough()
    .describe("Anchor IDL JSON object"),
});

export const decodeInstructionSchema = z.object({
  programId: z.string().min(32).max(44),
  data: z.string().min(1).describe("Base-58 or base-64 encoded instruction data"),
  encoding: z.enum(["base58", "base64"]).default("base58"),
  accounts: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Ordered list of account public keys from the instruction"),
});

export const decodeTransactionSchema = z.object({
  signature: z.string().optional(),
  rawTransaction: z.string().optional(),
  encoding: z.enum(["base58", "base64"]).default("base64"),
  cluster: z
    .enum(["mainnet-beta", "devnet", "testnet"])
    .default("mainnet-beta"),
}).refine(
  (data) => data.signature || data.rawTransaction,
  { message: "Either 'signature' or 'rawTransaction' must be provided" }
);

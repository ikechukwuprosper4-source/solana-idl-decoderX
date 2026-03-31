import { Router, Request, Response } from "express";
import { IdlRegistryService } from "../services/idlRegistry";
import { IdlDecoderService } from "../services/decoder";
import { TransactionFetcherService } from "../services/transactionFetcher";
import {
  validate,
  decodeInstructionSchema,
  decodeTransactionSchema,
} from "../middleware/validate";
import { asyncHandler, createHttpError } from "../middleware/errorHandler";
import {
  ApiResponse,
  DecodedInstruction,
  DecodeTransactionResponse,
} from "../types";
import { logger } from "../utils/logger";

export function createDecodeRouter(
  registry: IdlRegistryService,
  decoder: IdlDecoderService,
  fetcher: TransactionFetcherService
): Router {
  const router = Router();

  /**
   * POST /api/decode/instruction
   *
   * Decode a single Solana instruction using its registered IDL.
   *
   * Body:
   *   programId  – Base-58 program address
   *   data       – Base-58 or base-64 encoded instruction data
   *   encoding   – "base58" | "base64" (default: "base58")
   *   accounts   – Ordered array of account public keys
   */
  router.post(
    "/instruction",
    validate(decodeInstructionSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { programId, data, encoding, accounts } = req.body as {
        programId: string;
        data: string;
        encoding: "base58" | "base64";
        accounts: string[];
      };

      const program = registry.get(programId);
      if (!program) {
        throw createHttpError(
          404,
          `No IDL registered for program ${programId}. ` +
            `Register it first via POST /api/programs`
        );
      }

      const decoded = decoder.decodeInstruction(
        programId,
        program.idl,
        data,
        encoding,
        accounts
      );

      const response: ApiResponse<DecodedInstruction> = {
        success: true,
        data: decoded,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    })
  );

  /**
   * POST /api/decode/transaction
   *
   * Decode all instructions in a transaction, either by:
   *   - `signature` (fetches live from RPC), or
   *   - `rawTransaction` (base-64 encoded serialized transaction)
   *
   * Instructions whose programs have no registered IDL are returned
   * with instructionName = "unknown" and raw data preserved.
   */
  router.post(
    "/transaction",
    validate(decodeTransactionSchema),
    asyncHandler(async (req: Request, res: Response) => {
      const { signature, rawTransaction, cluster } = req.body as {
        signature?: string;
        rawTransaction?: string;
        cluster: "mainnet-beta" | "devnet" | "testnet";
      };

      // ── Fetch / parse tx ─────────────────────────────────────────────────────
      let txInfo;
      if (signature) {
        txInfo = await fetcher.fetchBySignature(signature, cluster);
      } else {
        txInfo = fetcher.parseRawTransaction(rawTransaction!);
      }

      // ── Decode each instruction ───────────────────────────────────────────────
      const decodedInstructions: DecodedInstruction[] = [];
      const decodedInner: DecodedInstruction[] = [];
      const errors: string[] = [];

      const decodeList = async (
        list: typeof txInfo.instructions,
        target: DecodedInstruction[]
      ) => {
        for (const ix of list) {
          const program = registry.get(ix.programId);
          if (!program) {
            target.push({
              programId: ix.programId,
              programName: null,
              instructionName: "unknown",
              discriminator: "0x" + Buffer.from(
                require("bs58").decode(ix.data).slice(0, 8)
              ).toString("hex"),
              accounts: ix.accounts.map((pk, i) => ({
                name: `account_${i}`,
                pubkey: pk,
                isSigner: false,
                isWritable: false,
              })),
              args: [],
              raw: ix.data,
            });
            continue;
          }

          try {
            const decoded = decoder.decodeInstruction(
              ix.programId,
              program.idl,
              ix.data,
              "base58",
              ix.accounts
            );
            target.push(decoded);
          } catch (err) {
            const msg = `Failed to decode instruction for ${ix.programId}: ${(err as Error).message}`;
            errors.push(msg);
            logger.warn(msg);
            target.push({
              programId: ix.programId,
              programName: program.idl.name,
              instructionName: "decode_error",
              discriminator: "",
              accounts: ix.accounts.map((pk, i) => ({
                name: `account_${i}`,
                pubkey: pk,
                isSigner: false,
                isWritable: false,
              })),
              args: [],
              raw: ix.data,
            });
          }
        }
      };

      await decodeList(txInfo.instructions, decodedInstructions);
      await decodeList(txInfo.innerInstructions, decodedInner);

      const result: DecodeTransactionResponse = {
        signature: txInfo.signature,
        slot: txInfo.slot,
        blockTime: txInfo.blockTime,
        instructions: decodedInstructions,
        innerInstructions: decodedInner,
        errors,
      };

      const response: ApiResponse<DecodeTransactionResponse> = {
        success: true,
        data: result,
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    })
  );

  /**
   * POST /api/decode/discriminator
   *
   * Compute the Anchor discriminator for an instruction name
   * (sha256("global:<name>")[0..8])
   */
  router.post(
    "/discriminator",
    asyncHandler(async (req: Request, res: Response) => {
      const { name } = req.body as { name?: string };
      if (!name || typeof name !== "string") {
        throw createHttpError(400, "Body must include { name: string }");
      }

      const discriminator = decoder.computeDiscriminator(name);

      const response: ApiResponse = {
        success: true,
        data: {
          instructionName: name,
          discriminator: `0x${discriminator}`,
          bytes: Array.from(Buffer.from(discriminator, "hex")),
        },
        timestamp: new Date().toISOString(),
      };
      res.json(response);
    })
  );

  return router;
}

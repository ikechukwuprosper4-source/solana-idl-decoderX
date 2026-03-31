import { Idl } from "@coral-xyz/anchor";
import { RegisteredProgram } from "../types";
import { logger } from "../utils/logger";

const REDIS_KEY_PREFIX = "idl:";
const REDIS_INDEX_KEY = "idl:_index";

/**
 * IDL Registry Service
 *
 * Manages storage and retrieval of Anchor IDL definitions.
 * Uses an in-memory map as primary store with optional Redis persistence.
 */
export class IdlRegistryService {
  private store: Map<string, RegisteredProgram> = new Map();
  private redis: import("ioredis").Redis | null = null;

  constructor(redisClient: import("ioredis").Redis | null) {
    this.redis = redisClient;
  }

  /** Load all programs from Redis into memory on startup */
  async initialize(): Promise<void> {
    if (!this.redis) {
      logger.info("Running IdlRegistry in memory-only mode (no Redis)");
      this._seedDefaults();
      return;
    }

    try {
      const ids = await this.redis.smembers(REDIS_INDEX_KEY);
      for (const programId of ids) {
        const raw = await this.redis.get(`${REDIS_KEY_PREFIX}${programId}`);
        if (raw) {
          const program: RegisteredProgram = JSON.parse(raw);
          this.store.set(programId, program);
        }
      }
      logger.info(`IdlRegistry loaded ${this.store.size} programs from Redis`);
    } catch (err) {
      logger.warn("Failed to load from Redis, continuing in memory mode", { err });
    }

    this._seedDefaults();
  }

  /** Register or update an IDL for a program */
  async register(programId: string, idl: Idl): Promise<RegisteredProgram> {
    const existing = this.store.get(programId);
    const now = new Date().toISOString();

    const program: RegisteredProgram = {
      programId,
      idl,
      name: idl.name,
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: now,
    };

    this.store.set(programId, program);

    if (this.redis) {
      await this.redis.set(
        `${REDIS_KEY_PREFIX}${programId}`,
        JSON.stringify(program)
      );
      await this.redis.sadd(REDIS_INDEX_KEY, programId);
    }

    logger.info("Registered IDL", { programId, name: idl.name });
    return program;
  }

  /** Get a registered program by its program ID */
  get(programId: string): RegisteredProgram | undefined {
    return this.store.get(programId);
  }

  /** List all registered programs (metadata only, no full IDL) */
  list(): Pick<RegisteredProgram, "programId" | "name" | "registeredAt" | "updatedAt">[] {
    return Array.from(this.store.values()).map(({ programId, name, registeredAt, updatedAt }) => ({
      programId,
      name,
      registeredAt,
      updatedAt,
    }));
  }

  /** Remove a program's IDL */
  async remove(programId: string): Promise<boolean> {
    const had = this.store.delete(programId);
    if (had && this.redis) {
      await this.redis.del(`${REDIS_KEY_PREFIX}${programId}`);
      await this.redis.srem(REDIS_INDEX_KEY, programId);
    }
    return had;
  }

  /** Total number of registered programs */
  count(): number {
    return this.store.size;
  }

  /** Seed well-known program IDLs so the API works out of the box */
  private _seedDefaults(): void {
    const tokenSwapIdl: Idl = {
      version: "0.1.0",
      name: "token_swap",
      instructions: [
        {
          name: "initialize",
          accounts: [
            { name: "tokenSwap", isMut: true, isSigner: false },
            { name: "authority", isMut: false, isSigner: false },
            { name: "tokenA", isMut: false, isSigner: false },
            { name: "tokenB", isMut: false, isSigner: false },
            { name: "pool", isMut: true, isSigner: false },
            { name: "feeAccount", isMut: false, isSigner: false },
            { name: "destination", isMut: true, isSigner: false },
            { name: "tokenProgram", isMut: false, isSigner: false },
          ],
          args: [
            { name: "nonce", type: "u8" },
            { name: "tradeFeeNumerator", type: "u64" },
            { name: "tradeFeeDenominator", type: "u64" },
            { name: "ownerTradeFeeNumerator", type: "u64" },
            { name: "ownerTradeFeeDenominator", type: "u64" },
            { name: "hostFeeNumerator", type: "u64" },
            { name: "hostFeeDenominator", type: "u64" },
            { name: "curveType", type: "u8" },
          ],
        },
        {
          name: "swap",
          accounts: [
            { name: "tokenSwap", isMut: false, isSigner: false },
            { name: "authority", isMut: false, isSigner: false },
            { name: "userTransferAuthority", isMut: false, isSigner: true },
            { name: "source", isMut: true, isSigner: false },
            { name: "swapSource", isMut: true, isSigner: false },
            { name: "swapDestination", isMut: true, isSigner: false },
            { name: "destination", isMut: true, isSigner: false },
            { name: "poolMint", isMut: true, isSigner: false },
            { name: "poolFee", isMut: true, isSigner: false },
            { name: "tokenProgram", isMut: false, isSigner: false },
          ],
          args: [
            { name: "amountIn", type: "u64" },
            { name: "minimumAmountOut", type: "u64" },
          ],
        },
        {
          name: "depositAllTokenTypes",
          accounts: [
            { name: "tokenSwap", isMut: false, isSigner: false },
            { name: "authority", isMut: false, isSigner: false },
            { name: "userTransferAuthority", isMut: false, isSigner: true },
            { name: "sourceA", isMut: true, isSigner: false },
            { name: "sourceB", isMut: true, isSigner: false },
            { name: "tokenA", isMut: true, isSigner: false },
            { name: "tokenB", isMut: true, isSigner: false },
            { name: "poolMint", isMut: true, isSigner: false },
            { name: "destination", isMut: true, isSigner: false },
            { name: "tokenProgram", isMut: false, isSigner: false },
          ],
          args: [
            { name: "poolTokenAmount", type: "u64" },
            { name: "maximumTokenAAmount", type: "u64" },
            { name: "maximumTokenBAmount", type: "u64" },
          ],
        },
        {
          name: "withdrawAllTokenTypes",
          accounts: [
            { name: "tokenSwap", isMut: false, isSigner: false },
            { name: "authority", isMut: false, isSigner: false },
            { name: "userTransferAuthority", isMut: false, isSigner: true },
            { name: "poolMint", isMut: true, isSigner: false },
            { name: "sourcePoolAccount", isMut: true, isSigner: false },
            { name: "fromA", isMut: true, isSigner: false },
            { name: "fromB", isMut: true, isSigner: false },
            { name: "userAccountA", isMut: true, isSigner: false },
            { name: "userAccountB", isMut: true, isSigner: false },
            { name: "feeAccount", isMut: true, isSigner: false },
            { name: "tokenProgram", isMut: false, isSigner: false },
          ],
          args: [
            { name: "poolTokenAmount", type: "u64" },
            { name: "minimumTokenAAmount", type: "u64" },
            { name: "minimumTokenBAmount", type: "u64" },
          ],
        },
      ],
      accounts: [],
      types: [],
      errors: [],
    };

    // Example counter program IDL
    const counterIdl: Idl = {
      version: "0.1.0",
      name: "counter",
      instructions: [
        {
          name: "initialize",
          accounts: [
            { name: "counter", isMut: true, isSigner: false },
            { name: "user", isMut: true, isSigner: true },
            { name: "systemProgram", isMut: false, isSigner: false },
          ],
          args: [],
        },
        {
          name: "increment",
          accounts: [
            { name: "counter", isMut: true, isSigner: false },
            { name: "user", isMut: false, isSigner: true },
          ],
          args: [{ name: "amount", type: "u64" }],
        },
        {
          name: "decrement",
          accounts: [
            { name: "counter", isMut: true, isSigner: false },
            { name: "user", isMut: false, isSigner: true },
          ],
          args: [{ name: "amount", type: "u64" }],
        },
        {
          name: "reset",
          accounts: [
            { name: "counter", isMut: true, isSigner: false },
            { name: "user", isMut: false, isSigner: true },
          ],
          args: [],
        },
      ],
      accounts: [
        {
          name: "Counter",
          type: {
            kind: "struct",
            fields: [
              { name: "authority", type: "publicKey" },
              { name: "count", type: "u64" },
            ],
          },
        },
      ],
      types: [],
      errors: [
        { code: 6000, name: "Unauthorized", msg: "You are not authorized to perform this action." },
        { code: 6001, name: "Overflow", msg: "Counter overflow." },
      ],
    };

    if (!this.store.has("SWAPpA5gevt1D7QWy3RjuMVtFJkohgE6pHNCSVZ3pMMM")) {
      this.register("SWAPpA5gevt1D7QWy3RjuMVtFJkohgE6pHNCSVZ3pMMM", tokenSwapIdl).catch(() => {});
    }
    if (!this.store.has("Counter111111111111111111111111111111111111")) {
      this.register("Counter111111111111111111111111111111111111", counterIdl).catch(() => {});
    }
  }
}

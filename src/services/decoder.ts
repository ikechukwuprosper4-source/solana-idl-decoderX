import { BorshInstructionCoder, Idl } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  DecodedAccount,
  DecodedArgument,
  DecodedInstruction,
  IdlType,
} from "../types";
import { logger } from "../utils/logger";

/**
 * IDL Decoder Service
 *
 * Decodes raw Solana instruction data into human-readable form
 * using Anchor's BorshInstructionCoder and a registered IDL.
 */
export class IdlDecoderService {
  /**
   * Decode a single instruction's data buffer using the provided IDL.
   *
   * Anchor's 8-byte discriminator is derived from:
   *   sha256("global:<instruction_name>")[0..8]
   */
  decodeInstruction(
    programId: string,
    idl: Idl,
    dataEncoded: string,
    encoding: "base58" | "base64" = "base58",
    accountPubkeys: string[] = []
  ): DecodedInstruction {
    // ── 1. Decode raw bytes ────────────────────────────────────────────────────
    const dataBytes = this._decodeBytes(dataEncoded, encoding);
    const discriminatorHex = Buffer.from(dataBytes.slice(0, 8)).toString("hex");

    // ── 2. Decode via Anchor coder ─────────────────────────────────────────────
    const coder = new BorshInstructionCoder(idl);
    const decoded = coder.decode(Buffer.from(dataBytes), "hex");

    if (!decoded) {
      throw new Error(
        `No instruction matched discriminator 0x${discriminatorHex} in IDL "${idl.name}". ` +
        `Ensure the correct IDL is registered for program ${programId}.`
      );
    }

    // ── 3. Map accounts ────────────────────────────────────────────────────────
    const idlInstruction = idl.instructions.find(
      (ix) => ix.name === decoded.name
    );

    const accounts: DecodedAccount[] = (idlInstruction?.accounts ?? []).map(
      (acc, idx) => ({
        name: acc.name,
        pubkey: accountPubkeys[idx] ?? `<account[${idx}]>`,
        isSigner: (acc as { isSigner?: boolean }).isSigner ?? false,
        isWritable: (acc as { isMut?: boolean }).isMut ?? false,
      })
    );

    // ── 4. Serialize args ──────────────────────────────────────────────────────
    const args: DecodedArgument[] = [];
    if (decoded.data && typeof decoded.data === "object") {
      const idlArgs = idlInstruction?.args ?? [];
      for (const [key, value] of Object.entries(
        decoded.data as Record<string, unknown>
      )) {
        const idlArg = idlArgs.find((a) => a.name === key);
        args.push({
          name: key,
          type: idlArg ? this._typeToString(idlArg.type as IdlType) : "unknown",
          value: this._serializeValue(value),
        });
      }
    }

    return {
      programId,
      programName: idl.name,
      instructionName: decoded.name,
      discriminator: `0x${discriminatorHex}`,
      accounts,
      args,
      raw: dataEncoded,
    };
  }

  /** Format an IDL type definition into a readable string */
  _typeToString(type: IdlType): string {
    if (typeof type === "string") return type;
    if ("vec" in type) return `Vec<${this._typeToString(type.vec)}>`;
    if ("array" in type)
      return `[${this._typeToString(type.array[0])}; ${type.array[1]}]`;
    if ("option" in type) return `Option<${this._typeToString(type.option)}>`;
    if ("defined" in type) return type.defined;
    return "unknown";
  }

  /** Decode bytes from base58 or base64 */
  _decodeBytes(encoded: string, encoding: "base58" | "base64"): Uint8Array {
    if (encoding === "base64") {
      return Uint8Array.from(Buffer.from(encoded, "base64"));
    }
    try {
      return bs58.decode(encoded);
    } catch {
      // Fallback: try base64 if base58 fails
      return Uint8Array.from(Buffer.from(encoded, "base64"));
    }
  }

  /** Serialize BN, PublicKey, and other Anchor types to plain JS */
  _serializeValue(value: unknown): unknown {
    if (value === null || value === undefined) return value;

    // BN (big number from @coral-xyz/anchor)
    if (
      value !== null &&
      typeof value === "object" &&
      "toNumber" in value &&
      typeof (value as { toNumber: unknown }).toNumber === "function"
    ) {
      try {
        const n = (value as { toNumber: () => number }).toNumber();
        return n;
      } catch {
        return (value as { toString: () => string }).toString();
      }
    }

    // PublicKey
    try {
      if (value instanceof PublicKey) return value.toBase58();
    } catch {}

    // Buffer / Uint8Array
    if (Buffer.isBuffer(value)) return value.toString("hex");
    if (value instanceof Uint8Array)
      return Buffer.from(value).toString("hex");

    // Array
    if (Array.isArray(value)) return value.map((v) => this._serializeValue(v));

    // Plain object (structs)
    if (typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        result[k] = this._serializeValue(v);
      }
      return result;
    }

    return value;
  }

  /** Validate that a string is a valid base-58 Solana public key */
  isValidPublicKey(key: string): boolean {
    try {
      new PublicKey(key);
      return true;
    } catch {
      return false;
    }
  }

  /** Derive the 8-byte Anchor discriminator for an instruction name */
  computeDiscriminator(instructionName: string): string {
    const { createHash } = require("crypto");
    const hash = createHash("sha256")
      .update(`global:${instructionName}`)
      .digest();
    return Buffer.from(hash.slice(0, 8)).toString("hex");
  }

  /** List all discriminators in an IDL */
  listDiscriminators(idl: Idl): { instruction: string; discriminator: string }[] {
    return idl.instructions.map((ix) => ({
      instruction: ix.name,
      discriminator: `0x${this.computeDiscriminator(ix.name)}`,
    }));
  }

  /** Validate IDL shape — returns list of issues found */
  validateIdl(idl: unknown): string[] {
    const issues: string[] = [];
    if (!idl || typeof idl !== "object") {
      issues.push("IDL must be a JSON object");
      return issues;
    }
    const obj = idl as Record<string, unknown>;
    if (typeof obj.version !== "string")
      issues.push("Missing required field: version (string)");
    if (typeof obj.name !== "string")
      issues.push("Missing required field: name (string)");
    if (!Array.isArray(obj.instructions))
      issues.push("Missing required field: instructions (array)");
    else {
      obj.instructions.forEach((ix: unknown, i: number) => {
        if (!ix || typeof ix !== "object") {
          issues.push(`instructions[${i}] must be an object`);
          return;
        }
        const ixObj = ix as Record<string, unknown>;
        if (typeof ixObj.name !== "string")
          issues.push(`instructions[${i}].name must be a string`);
        if (!Array.isArray(ixObj.accounts))
          issues.push(`instructions[${i}].accounts must be an array`);
        if (!Array.isArray(ixObj.args))
          issues.push(`instructions[${i}].args must be an array`);
      });
    }
    return issues;
  }
}

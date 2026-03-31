import {
  Connection,
  ParsedTransactionWithMeta,
  PublicKey,
  VersionedTransactionResponse,
  Message,
  VersionedMessage,
} from "@solana/web3.js";
import { logger } from "../utils/logger";

const RPC_ENDPOINTS: Record<string, string> = {
  "mainnet-beta": process.env.MAINNET_RPC_URL || "https://api.mainnet-beta.solana.com",
  devnet: process.env.DEVNET_RPC_URL || "https://api.devnet.solana.com",
  testnet: process.env.TESTNET_RPC_URL || "https://api.testnet.solana.com",
};

export interface RawInstruction {
  programId: string;
  data: string;         // base58 encoded
  accounts: string[];   // ordered pubkeys
}

export interface ParsedTxInfo {
  signature: string | null;
  slot: number | null;
  blockTime: number | null;
  instructions: RawInstruction[];
  innerInstructions: RawInstruction[];
}

/**
 * Fetches a transaction from a Solana cluster and extracts
 * raw instruction data ready for IDL decoding.
 */
export class TransactionFetcherService {
  private connections: Map<string, Connection> = new Map();

  private getConnection(
    cluster: "mainnet-beta" | "devnet" | "testnet" = "mainnet-beta"
  ): Connection {
    if (!this.connections.has(cluster)) {
      this.connections.set(
        cluster,
        new Connection(RPC_ENDPOINTS[cluster], "confirmed")
      );
    }
    return this.connections.get(cluster)!;
  }

  /** Fetch a transaction by signature and extract instructions */
  async fetchBySignature(
    signature: string,
    cluster: "mainnet-beta" | "devnet" | "testnet" = "mainnet-beta"
  ): Promise<ParsedTxInfo> {
    const connection = this.getConnection(cluster);

    logger.info("Fetching transaction", { signature, cluster });

    const tx = await connection.getTransaction(signature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      throw new Error(`Transaction not found: ${signature}`);
    }

    return this._parseTx(signature, tx);
  }

  /** Parse a base64-encoded raw transaction */
  parseRawTransaction(rawBase64: string): ParsedTxInfo {
    const { VersionedTransaction } = require("@solana/web3.js");
    const bytes = Buffer.from(rawBase64, "base64");
    const tx = VersionedTransaction.deserialize(bytes);
    const msg = tx.message;

    const accountKeys: string[] = msg.staticAccountKeys.map((k: PublicKey) =>
      k.toBase58()
    );

    // Add lookup table accounts if present
    if (msg.addressTableLookups && msg.addressTableLookups.length > 0) {
      logger.warn(
        "Transaction uses address lookup tables; full account resolution requires on-chain fetch"
      );
    }

    const instructions: RawInstruction[] = msg.compiledInstructions.map(
      (ix: { programIdIndex: number; data: Uint8Array; accountKeyIndexes: number[] }) => ({
        programId: accountKeys[ix.programIdIndex] ?? `<programId[${ix.programIdIndex}]>`,
        data: require("bs58").encode(ix.data),
        accounts: ix.accountKeyIndexes.map(
          (idx: number) => accountKeys[idx] ?? `<account[${idx}]>`
        ),
      })
    );

    return {
      signature: null,
      slot: null,
      blockTime: null,
      instructions,
      innerInstructions: [],
    };
  }

  private _parseTx(
    signature: string,
    tx: VersionedTransactionResponse
  ): ParsedTxInfo {
    const msg = tx.transaction.message;
    const accountKeys = this._resolveAccountKeys(msg, tx);

    const instructions: RawInstruction[] = msg.compiledInstructions.map(
      (ix) => ({
        programId: accountKeys[ix.programIdIndex] ?? `<prog[${ix.programIdIndex}]>`,
        data: require("bs58").encode(ix.data),
        accounts: ix.accountKeyIndexes.map(
          (idx) => accountKeys[idx] ?? `<acc[${idx}]>`
        ),
      })
    );

    const innerInstructions: RawInstruction[] = [];
    for (const inner of tx.meta?.innerInstructions ?? []) {
      for (const ix of inner.instructions) {
        if ("data" in ix && typeof ix.data === "string") {
          innerInstructions.push({
            programId: accountKeys[(ix as { programIdIndex: number }).programIdIndex] ?? "",
            data: ix.data,
            accounts: ((ix as { accounts: number[] }).accounts ?? []).map(
              (idx) => accountKeys[idx] ?? ""
            ),
          });
        }
      }
    }

    return {
      signature,
      slot: tx.slot ?? null,
      blockTime: tx.blockTime ?? null,
      instructions,
      innerInstructions,
    };
  }

  private _resolveAccountKeys(
    msg: VersionedMessage,
    tx: VersionedTransactionResponse
  ): string[] {
    const keys = msg.staticAccountKeys.map((k) => k.toBase58());

    // Append resolved lookup table accounts if available in meta
    const loadedAddresses = tx.meta?.loadedAddresses;
    if (loadedAddresses) {
      keys.push(
        ...(loadedAddresses.writable ?? []).map((k) =>
          typeof k === "string" ? k : k.toBase58()
        )
      );
      keys.push(
        ...(loadedAddresses.readonly ?? []).map((k) =>
          typeof k === "string" ? k : k.toBase58()
        )
      );
    }

    return keys;
  }
}

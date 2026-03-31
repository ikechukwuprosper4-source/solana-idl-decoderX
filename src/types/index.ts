import { Idl } from "@coral-xyz/anchor";

// ─── IDL Registry ──────────────────────────────────────────────────────────────

export interface RegisteredProgram {
  programId: string;
  idl: Idl;
  name: string;
  registeredAt: string;
  updatedAt: string;
}

// ─── Instruction Decoding ──────────────────────────────────────────────────────

export interface DecodedArgument {
  name: string;
  type: string;
  value: unknown;
}

export interface DecodedInstruction {
  programId: string;
  programName: string | null;
  instructionName: string;
  discriminator: string;
  accounts: DecodedAccount[];
  args: DecodedArgument[];
  raw: string;
}

export interface DecodedAccount {
  name: string;
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface DecodeInstructionRequest {
  programId: string;
  data: string; // base58 or base64 encoded instruction data
  encoding?: "base58" | "base64";
  accounts?: string[]; // ordered list of account pubkeys
}

export interface DecodeTransactionRequest {
  signature?: string;          // fetch from RPC
  rawTransaction?: string;     // base64 encoded raw tx
  encoding?: "base58" | "base64";
  cluster?: "mainnet-beta" | "devnet" | "testnet";
}

export interface DecodeTransactionResponse {
  signature: string | null;
  slot: number | null;
  blockTime: number | null;
  instructions: DecodedInstruction[];
  innerInstructions: DecodedInstruction[];
  errors: string[];
}

// ─── API Responses ─────────────────────────────────────────────────────────────

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  total: number;
  page: number;
  limit: number;
}

// ─── IDL Types ─────────────────────────────────────────────────────────────────

export type IdlType =
  | "bool"
  | "u8" | "i8"
  | "u16" | "i16"
  | "u32" | "i32"
  | "u64" | "i64"
  | "u128" | "i128"
  | "f32" | "f64"
  | "bytes"
  | "string"
  | "publicKey"
  | { vec: IdlType }
  | { array: [IdlType, number] }
  | { option: IdlType }
  | { defined: string };

export interface IdlField {
  name: string;
  type: IdlType;
}

export interface IdlInstructionArg extends IdlField {}

import { Pool } from 'pg';
import { logger } from '../utils/logger';
import { DecodedInstruction } from '../types';

export class DatabaseService {
  private pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@db:5432/indexer',
    });
  }

  async initialize() {
    const client = await this.pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS instructions (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          signature TEXT,
          slot BIGINT,
          block_time BIGINT,
          program_id TEXT NOT NULL,
          program_name TEXT,
          instruction_name TEXT NOT NULL,
          args JSONB,
          accounts JSONB,
          raw_data TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS idx_program_id ON instructions(program_id);
        CREATE INDEX IF NOT EXISTS idx_instruction_name ON instructions(instruction_name);
        CREATE INDEX IF NOT EXISTS idx_signature ON instructions(signature);
      `);
      logger.info('Database initialized');
    } finally {
      client.release();
    }
  }

  async saveInstruction(ix: DecodedInstruction, meta: { signature?: string | null, slot?: number | null, blockTime?: number | null }) {
    const query = `
      INSERT INTO instructions (signature, slot, block_time, program_id, program_name, instruction_name, args, accounts, raw_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    const values = [
      meta.signature,
      meta.slot,
      meta.blockTime,
      ix.programId,
      ix.programName,
      ix.instructionName,
      JSON.stringify(ix.args),
      JSON.stringify(ix.accounts),
      ix.raw,
    ];
    await this.pool.query(query, values);
  }

  async getInstructions(programId?: string, limit = 50) {
    let query = 'SELECT * FROM instructions';
    const params = [];
    if (programId) {
      query += ' WHERE program_id = $1';
      params.push(programId);
    }
    query += ' ORDER BY created_at DESC LIMIT $' + (params.length + 1);
    params.push(limit);
    const res = await this.pool.query(query, params);
    return res.rows;
  }
}

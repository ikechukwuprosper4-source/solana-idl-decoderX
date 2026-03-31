import { Connection, PublicKey } from '@solana/web3.js';
import { IdlRegistryService } from './idlRegistry';
import { IdlDecoderService } from './decoder';
import { TransactionFetcherService } from './transactionFetcher';
import { DatabaseService } from './database';
import { logger } from '../utils/logger';

export class IndexerService {
  private activePrograms: Set<string> = new Set();
  private connection: Connection;
  private interval: NodeJS.Timeout | null = null;

  constructor(
    private registry: IdlRegistryService,
    private decoder: IdlDecoderService,
    private fetcher: TransactionFetcherService,
    private db: DatabaseService
  ) {
    this.connection = new Connection(process.env.MAINNET_RPC_URL || 'https://api.mainnet-beta.solana.com');
  }

  async start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.tick(), 30000); // Check every 30s
    logger.info('Indexer service started');
  }

  async stop() {
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
  }

  async watch(programId: string) {
    this.activePrograms.add(programId);
    logger.info(`Started watching program ${programId}`);
  }

  private async tick() {
    for (const programId of this.activePrograms) {
      try {
        await this.indexRecent(programId);
      } catch (err) {
        logger.error(`Error indexing ${programId}: ${(err as Error).message}`);
      }
    }
  }

  private async indexRecent(programId: string) {
    const pubkey = new PublicKey(programId);
    const signatures = await this.connection.getSignaturesForAddress(pubkey, { limit: 10 });

    for (const sigInfo of signatures) {
      const tx = await this.fetcher.fetchBySignature(sigInfo.signature);
      const program = this.registry.get(programId);
      if (!program) continue;

      for (const ix of tx.instructions) {
        if (ix.programId === programId) {
          try {
            const decoded = this.decoder.decodeInstruction(
              programId,
              program.idl,
              ix.data,
              'base58',
              ix.accounts
            );
            await this.db.saveInstruction(decoded, {
              signature: sigInfo.signature,
              slot: tx.slot,
              blockTime: tx.blockTime
            });
          } catch (e) {
            // Log but continue
          }
        }
      }
    }
  }
}

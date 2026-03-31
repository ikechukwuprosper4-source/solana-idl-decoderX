import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import morgan from 'morgan';
import Redis from 'ioredis';
import { IdlRegistryService } from './services/idlRegistry';
import { IdlDecoderService } from './services/decoder';
import { TransactionFetcherService } from './services/transactionFetcher';
import { DatabaseService } from './services/database';
import { IndexerService } from './services/indexer';
import { createDecodeRouter } from './routes/decode';
import { createProgramsRouter } from './routes/programs';
import { createHealthRouter } from './routes/health';
import { logger } from './utils/logger';
import { errorHandler } from './middleware/errorHandler';

const app: Express = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json());
app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));

// Services
const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL) : null;
const registry = new IdlRegistryService(redis);
const decoder = new IdlDecoderService();
const fetcher = new TransactionFetcherService();
const db = new DatabaseService();
const indexer = new IndexerService(registry, decoder, fetcher, db);

// Routes
app.use('/api/health', createHealthRouter());
app.use('/api/programs', createProgramsRouter(registry));
app.use('/api/decode', createDecodeRouter(registry, decoder, fetcher));

// New Indexing Query API
app.get('/api/indexer/instructions', async (req, res) => {
  const { programId, limit } = req.query;
  const data = await db.getInstructions(programId as string, parseInt(limit as string) || 50);
  res.json({ success: true, data });
});

// Watch a program for indexing
app.post('/api/indexer/watch', async (req, res) => {
  const { programId } = req.body;
  await indexer.watch(programId);
  res.json({ success: true, message: `Now indexing ${programId}` });
});

app.use(errorHandler);

async function start() {
  await db.initialize();
  await registry.initialize();
  await indexer.start();
  app.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', err);
  process.exit(1);
});

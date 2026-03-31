# Solana IDL Decoder API

A production-grade REST API for decoding Solana program instructions using [Anchor](https://www.anchor-lang.com/) IDL definitions. Register any Anchor IDL, then decode raw instruction data — or full on-chain transactions — into human-readable JSON.

```
POST /api/decode/instruction   →  { instructionName: "swap", args: [{ name: "amountIn", value: 1000000 }], ... }
```

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Quick Start](#quick-start)
- [Docker Compose](#docker-compose)
- [API Reference](#api-reference)
- [Request & Response Examples](#request--response-examples)
- [IDL Registration](#idl-registration)
- [How Decoding Works](#how-decoding-works)
- [Configuration](#configuration)
- [Development](#development)
- [Testing](#testing)
- [Project Structure](#project-structure)

---

## Features

- ✅ **Correct Anchor IDL decoding** — Uses `BorshInstructionCoder` from `@coral-xyz/anchor` to decode the 8-byte discriminator and Borsh-encoded arguments
- ✅ **Full REST API** — CRUD for IDL registry + instruction and transaction decoding
- ✅ **Live transaction fetching** — Decode by signature (mainnet/devnet/testnet) or raw base-64 serialized tx
- ✅ **Redis persistence** — IDL registry survives restarts; gracefully falls back to in-memory
- ✅ **Production Docker Compose** — Multi-stage Dockerfile, non-root user, health checks
- ✅ **Input validation** — Zod schemas on every endpoint
- ✅ **Rate limiting, CORS, Helmet** — Secure by default
- ✅ **25+ tests** — Integration and unit coverage

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Express API (Port 3000)             │
│                                                         │
│  GET  /health                    → liveness check       │
│  GET  /health/ready              → readiness check      │
│                                                         │
│  GET    /api/programs            → list IDLs            │
│  POST   /api/programs            → register IDL         │
│  GET    /api/programs/:id        → get IDL              │
│  GET    /api/programs/:id/discriminators                 │
│  DELETE /api/programs/:id        → remove IDL           │
│                                                         │
│  POST /api/decode/instruction    → decode single ix     │
│  POST /api/decode/transaction    → decode full tx       │
│  POST /api/decode/discriminator  → compute discriminator│
└─────────────────────────────────────────────────────────┘
          │                           │
          ▼                           ▼
  ┌──────────────┐          ┌─────────────────────┐
  │ IdlRegistry  │          │  IdlDecoderService   │
  │ (Redis /     │          │  BorshInstructionCoder│
  │  in-memory)  │          │  + type serializer   │
  └──────────────┘          └─────────────────────┘
                                      │
                             ┌────────────────┐
                             │ TransactionFetcher│
                             │ @solana/web3.js  │
                             └────────────────┘
```

---

## Quick Start

### Without Docker

```bash
# 1. Clone and install
git clone https://github.com/your-handle/solana-idl-decoder
cd solana-idl-decoder
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env — REDIS_URL is optional; omit for in-memory mode

# 3. Run in development
npm run dev

# API is now live at http://localhost:3000
```

### Verify it's running

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "service": "solana-idl-decoder",
  "version": "1.0.0",
  "uptime": 3.14,
  "startedAt": "2025-01-01T00:00:00.000Z",
  "timestamp": "2025-01-01T00:00:03.140Z"
}
```

---

## Docker Compose

The recommended way to run in production.

```bash
# 1. Build and start API + Redis
docker compose up --build -d

# 2. Check logs
docker compose logs -f api

# 3. Verify health
curl http://localhost:3000/health/ready

# 4. Stop
docker compose down
```

**Services started:**

| Service | Image            | Port  | Description                       |
|---------|------------------|-------|-----------------------------------|
| `api`   | built locally    | 3000  | Solana IDL Decoder REST API        |
| `redis` | redis:7-alpine   | —     | IDL persistence (internal only)    |

**Development mode** (hot-reload with source mount):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

**Environment variables** (set in a `.env` file or shell):

```bash
PORT=3000
MAINNET_RPC_URL=https://your-rpc-provider.com
REDIS_URL=redis://localhost:6379
CORS_ORIGIN=https://your-frontend.com
RATE_LIMIT_MAX=200
```

---

## API Reference

### Health

| Method | Path            | Description               |
|--------|-----------------|---------------------------|
| GET    | `/health`       | Liveness — always returns `ok` |
| GET    | `/health/ready` | Readiness — confirms registry loaded |

---

### Programs (IDL Registry)

| Method | Path                              | Description                    |
|--------|-----------------------------------|--------------------------------|
| GET    | `/api/programs`                   | List all registered programs   |
| POST   | `/api/programs`                   | Register or update an IDL      |
| GET    | `/api/programs/:programId`        | Get full IDL + metadata        |
| GET    | `/api/programs/:programId/discriminators` | List all discriminators |
| DELETE | `/api/programs/:programId`        | Remove a program's IDL         |

---

### Decode

| Method | Path                          | Description                                        |
|--------|-------------------------------|----------------------------------------------------|
| POST   | `/api/decode/instruction`     | Decode a single raw instruction                    |
| POST   | `/api/decode/transaction`     | Decode all instructions in a transaction           |
| POST   | `/api/decode/discriminator`   | Compute Anchor discriminator for an instruction name |

---

## Request & Response Examples

### 1. Register an IDL

```bash
curl -X POST http://localhost:3000/api/programs \
  -H "Content-Type: application/json" \
  -d @- << 'EOF'
{
  "programId": "Counter111111111111111111111111111111111111",
  "idl": {
    "version": "0.1.0",
    "name": "counter",
    "instructions": [
      {
        "name": "increment",
        "accounts": [
          { "name": "counter", "isMut": true,  "isSigner": false },
          { "name": "user",    "isMut": false, "isSigner": true  }
        ],
        "args": [
          { "name": "amount", "type": "u64" }
        ]
      }
    ],
    "accounts": [],
    "types": [],
    "errors": []
  }
}
EOF
```

**Response `201`:**
```json
{
  "success": true,
  "message": "IDL registered for program Counter111111111111111111111111111111111111",
  "data": {
    "programId": "Counter111111111111111111111111111111111111",
    "name": "counter",
    "instructionCount": 1,
    "registeredAt": "2025-01-01T00:00:00.000Z",
    "updatedAt": "2025-01-01T00:00:00.000Z"
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

### 2. Decode an Instruction

Instruction data is the **base-58 or base-64 encoded bytes** of a compiled Solana instruction. The first 8 bytes are the Anchor discriminator.

```bash
curl -X POST http://localhost:3000/api/decode/instruction \
  -H "Content-Type: application/json" \
  -d '{
    "programId": "Counter111111111111111111111111111111111111",
    "data": "<base64-encoded-instruction-data>",
    "encoding": "base64",
    "accounts": [
      "CouNterAccount111111111111111111111111111111",
      "UserPubkey1111111111111111111111111111111111"
    ]
  }'
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "programId": "Counter111111111111111111111111111111111111",
    "programName": "counter",
    "instructionName": "increment",
    "discriminator": "0x3a7d9f2b1c8e4f6a",
    "accounts": [
      {
        "name": "counter",
        "pubkey": "CouNterAccount111111111111111111111111111111",
        "isSigner": false,
        "isWritable": true
      },
      {
        "name": "user",
        "pubkey": "UserPubkey1111111111111111111111111111111111",
        "isSigner": true,
        "isWritable": false
      }
    ],
    "args": [
      {
        "name": "amount",
        "type": "u64",
        "value": 1000000
      }
    ],
    "raw": "<base64-encoded-instruction-data>"
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

### 3. Decode a Live Transaction

Fetch a transaction by signature and decode all instructions whose programs have a registered IDL. Instructions from unregistered programs are included with `instructionName: "unknown"`.

```bash
curl -X POST http://localhost:3000/api/decode/transaction \
  -H "Content-Type: application/json" \
  -d '{
    "signature": "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLQfHLVnK3sAEkVKyy...",
    "cluster": "mainnet-beta"
  }'
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "signature": "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnb...",
    "slot": 290123456,
    "blockTime": 1720000000,
    "instructions": [
      {
        "programId": "SWAPpA5gevt1D7QWy3RjuMVtFJkohgE6pHNCSVZ3pMMM",
        "programName": "token_swap",
        "instructionName": "swap",
        "discriminator": "0xf8c69e91e17587c8",
        "accounts": [
          { "name": "tokenSwap",            "pubkey": "...", "isSigner": false, "isWritable": false },
          { "name": "authority",            "pubkey": "...", "isSigner": false, "isWritable": false },
          { "name": "userTransferAuthority","pubkey": "...", "isSigner": true,  "isWritable": false },
          { "name": "source",               "pubkey": "...", "isSigner": false, "isWritable": true  },
          { "name": "swapSource",           "pubkey": "...", "isSigner": false, "isWritable": true  },
          { "name": "swapDestination",      "pubkey": "...", "isSigner": false, "isWritable": true  },
          { "name": "destination",          "pubkey": "...", "isSigner": false, "isWritable": true  },
          { "name": "poolMint",             "pubkey": "...", "isSigner": false, "isWritable": true  },
          { "name": "poolFee",              "pubkey": "...", "isSigner": false, "isWritable": true  },
          { "name": "tokenProgram",         "pubkey": "...", "isSigner": false, "isWritable": false }
        ],
        "args": [
          { "name": "amountIn",         "type": "u64", "value": 1000000   },
          { "name": "minimumAmountOut", "type": "u64", "value": 980000    }
        ],
        "raw": "..."
      }
    ],
    "innerInstructions": [],
    "errors": []
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

### 4. Decode a Raw (Unsigned) Transaction

For client-side simulation — pass a base-64 encoded `VersionedTransaction`:

```bash
curl -X POST http://localhost:3000/api/decode/transaction \
  -H "Content-Type: application/json" \
  -d '{
    "rawTransaction": "AQAAAAAAAAAAAAAAAAAAAAAAAAAA...",
    "encoding": "base64"
  }'
```

---

### 5. Compute a Discriminator

```bash
curl -X POST http://localhost:3000/api/decode/discriminator \
  -H "Content-Type: application/json" \
  -d '{ "name": "initialize" }'
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "instructionName": "initialize",
    "discriminator": "0xafaf6d1f0d989bed",
    "bytes": [175, 175, 109, 31, 13, 152, 155, 237]
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

### 6. List Registered Programs

```bash
curl http://localhost:3000/api/programs
```

**Response `200`:**
```json
{
  "success": true,
  "data": [
    {
      "programId": "SWAPpA5gevt1D7QWy3RjuMVtFJkohgE6pHNCSVZ3pMMM",
      "name": "token_swap",
      "registeredAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    },
    {
      "programId": "Counter111111111111111111111111111111111111",
      "name": "counter",
      "registeredAt": "2025-01-01T00:00:00.000Z",
      "updatedAt": "2025-01-01T00:00:00.000Z"
    }
  ],
  "total": 2,
  "page": 1,
  "limit": 2,
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

### 7. Get All Discriminators for a Program

```bash
curl http://localhost:3000/api/programs/Counter111111111111111111111111111111111111/discriminators
```

**Response `200`:**
```json
{
  "success": true,
  "data": {
    "programId": "Counter111111111111111111111111111111111111",
    "programName": "counter",
    "discriminators": [
      { "instruction": "initialize", "discriminator": "0xafaf6d1f0d989bed" },
      { "instruction": "increment",  "discriminator": "0x3a7d9f2b1c8e4f6a" },
      { "instruction": "decrement",  "discriminator": "0x1c5c2d3e4f5a6b7c" },
      { "instruction": "reset",      "discriminator": "0x8a9b0c1d2e3f4a5b" }
    ]
  },
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

---

## IDL Registration

The API ships with two built-in IDLs:

| Program ID                                   | Name         |
|----------------------------------------------|--------------|
| `SWAPpA5gevt1D7QWy3RjuMVtFJkohgE6pHNCSVZ3pMMM` | token_swap  |
| `Counter111111111111111111111111111111111111` | counter      |

To add your own Anchor program, generate the IDL with:

```bash
anchor build
# IDL is at: target/idl/<program_name>.json
```

Then register it:

```bash
curl -X POST http://localhost:3000/api/programs \
  -H "Content-Type: application/json" \
  -d "{\"programId\": \"<YOUR_PROGRAM_ID>\", \"idl\": $(cat target/idl/my_program.json)}"
```

With Redis configured, registered IDLs persist across restarts.

---

## How Decoding Works

Anchor encodes instructions as follows:

```
[ discriminator (8 bytes) | borsh-encoded args (N bytes) ]
```

The **discriminator** is the first 8 bytes of:

```
sha256("global:<instruction_name>")
```

This API:

1. Accepts raw instruction data (base-58 or base-64)
2. Looks up the registered IDL for `programId`
3. Passes the data buffer to `BorshInstructionCoder.decode()` from `@coral-xyz/anchor`
4. Maps decoded args (BN, PublicKey, Buffer) to plain JSON-serializable values
5. Zips account keys with their IDL-defined names and mutability flags

---

## Configuration

All config is via environment variables (see `.env.example`):

| Variable          | Default                                    | Description                       |
|-------------------|--------------------------------------------|-----------------------------------|
| `PORT`            | `3000`                                     | API listen port                   |
| `REDIS_URL`       | *(unset)*                                  | Redis connection string (optional)|
| `MAINNET_RPC_URL` | `https://api.mainnet-beta.solana.com`     | Mainnet RPC for tx fetching       |
| `DEVNET_RPC_URL`  | `https://api.devnet.solana.com`           | Devnet RPC                        |
| `TESTNET_RPC_URL` | `https://api.testnet.solana.com`          | Testnet RPC                       |
| `CORS_ORIGIN`     | `*`                                        | Allowed CORS origins              |
| `RATE_LIMIT_MAX`  | `200`                                      | Requests per 15-minute window     |
| `LOG_LEVEL`       | `info`                                     | Winston log level                 |
| `NODE_ENV`        | `development`                              | `development` or `production`     |

---

## Development

```bash
# Install deps
npm install

# Run with hot-reload
npm run dev

# Build TypeScript
npm run build

# Lint
npm run lint

# Format
npm run format
```

---

## Testing

```bash
# Run full test suite
npm test

# With coverage report
npm run test:coverage
```

Tests cover:
- Health endpoints (liveness + readiness)
- IDL registration, retrieval, and deletion
- Instruction decoding (correct args, accounts, discriminator)
- Transaction decoding with mixed known/unknown programs
- Discriminator computation
- IDL validation error cases
- 404 and error handling
- `IdlDecoderService` unit tests (type serialization, BN handling, discriminator math)

---

## Project Structure

```
solana-idl-decoder/
├── src/
│   ├── index.ts                     # Entrypoint, bootstrap, graceful shutdown
│   ├── app.ts                       # Express app factory
│   ├── services/
│   │   ├── idlRegistry.ts           # IDL store (Redis-backed, in-memory fallback)
│   │   ├── decoder.ts               # BorshInstructionCoder decode + serialization
│   │   └── transactionFetcher.ts    # On-chain tx fetch + raw tx parsing
│   ├── routes/
│   │   ├── health.ts                # /health, /health/ready
│   │   ├── programs.ts              # /api/programs CRUD
│   │   └── decode.ts                # /api/decode/*
│   ├── middleware/
│   │   ├── validate.ts              # Zod request schemas + middleware factory
│   │   └── errorHandler.ts          # 404, error handler, asyncHandler wrapper
│   ├── types/index.ts               # TypeScript interfaces
│   ├── utils/logger.ts              # Winston structured logger
│   └── idl/examples/               # Bundled example IDLs
│       ├── counter.json
│       └── token_swap.json
├── tests/
│   └── api.test.ts                  # Integration + unit tests (Jest + Supertest)
├── Dockerfile                       # Multi-stage, non-root production image
├── docker-compose.yml               # Production: API + Redis
├── docker-compose.dev.yml           # Dev: hot-reload overlay
├── .env.example                     # All supported environment variables
├── tsconfig.json
└── package.json
```

---

## Error Responses

All errors follow the same envelope:

```json
{
  "success": false,
  "error": "Not Found",
  "message": "No IDL registered for program XYZ...",
  "timestamp": "2025-01-01T00:00:00.000Z"
}
```

| Status | Meaning                                           |
|--------|---------------------------------------------------|
| 400    | Validation error (missing/invalid fields)         |
| 404    | Program not registered / route not found          |
| 429    | Rate limit exceeded                               |
| 500    | Decode error (bad discriminator, corrupt data)    |

---

## License

MIT

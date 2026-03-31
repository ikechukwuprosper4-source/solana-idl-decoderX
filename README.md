# Solana Program Indexer & Decoder API

A high-performance Solana program indexer and REST API built for the **Superteam Nigeria** community. This project decodes raw Solana transactions using [Anchor](https://www.anchor-lang.com/) IDL definitions and indexes them into a searchable PostgreSQL database.

## 🚀 Key Features
- **Anchor IDL Decoding:** Turn raw base58 transaction data into human-readable JSON.
- **Real-Time Indexing:** Automatically "walk" the blockchain for specific programs and store decoded instructions.
- **Persistent Storage:** Integrated PostgreSQL for long-term data archival and searching.
- **Docker Ready:** Full multi-container orchestration (API, Redis, PostgreSQL) with a single command.
- **Flexible RPC Support:** Works across Mainnet, Devnet, and Testnet.

## 📦 Quick Start

### 1. Configure Environment
```bash
cp .env.example .env
# Set your RPC URL (Helius/Alchemy/QuickNode recommended)
MAINNET_RPC_URL=https://your-rpc-endpoint
```

### 2. Launch with Docker
```bash
docker compose up -d
```

### 3. Register an IDL
Register your program's IDL to start decoding and indexing.
```bash
POST /api/programs
{
  "programId": "your_program_id",
  "idl": { ... your idl json ... }
}
```

### 4. Start Indexing
Tell the indexer to watch a specific program.
```bash
POST /api/indexer/watch
{ "programId": "your_program_id" }
```

### 5. Query Indexed Data
```bash
GET /api/indexer/instructions?programId=your_program_id&limit=10
```

## 🛠 Architecture
- **TypeScript & Express:** High-performance backend.
- **PostgreSQL:** Reliable storage for decoded transactions.
- **Redis:** Fast IDL registry and metadata caching.
- **Anchor (@coral-xyz/anchor):** Industry-standard decoding logic.

## 🇳🇬 Ecosystem Impact
This project aims to provide Nigerian developers with an open-source, self-hosted alternative to centralized indexing services, promoting decentralization and censorship resistance within the local Solana community.

---
Built by **Mavitan** for Superteam Nigeria.

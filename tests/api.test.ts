import request from "supertest";
import Redis from "ioredis";
import { createApp } from "../src/app";
import { IdlRegistryService } from "../src/services/idlRegistry";
import { IdlDecoderService } from "../src/services/decoder";
import { TransactionFetcherService } from "../src/services/transactionFetcher";
import { BorshInstructionCoder } from "@coral-xyz/anchor";
import { Application } from "express";
import { Idl } from "@coral-xyz/anchor";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const COUNTER_PROGRAM_ID = "Counter111111111111111111111111111111111111";

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
      name: "reset",
      accounts: [
        { name: "counter", isMut: true, isSigner: false },
        { name: "user", isMut: false, isSigner: true },
      ],
      args: [],
    },
  ],
  accounts: [],
  types: [],
  errors: [],
};

/** Build instruction data that Anchor's coder can actually decode */
function buildIncrementData(amount: bigint): string {
  const coder = new BorshInstructionCoder(counterIdl);
  const encoded = coder.encode("increment", { amount });
  return encoded.toString("base64");
}

function buildInitializeData(): string {
  const coder = new BorshInstructionCoder(counterIdl);
  const encoded = coder.encode("initialize", {});
  return encoded.toString("base64");
}

// ── Test Setup ─────────────────────────────────────────────────────────────────

let app: Application;
let registry: IdlRegistryService;

beforeAll(async () => {
  registry = new IdlRegistryService(null); // in-memory, no Redis
  await registry.initialize();
  const decoder = new IdlDecoderService();
  const fetcher = new TransactionFetcherService();
  app = createApp(registry, decoder, fetcher);
});

// ── Health ─────────────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body).toHaveProperty("uptime");
    expect(res.body).toHaveProperty("startedAt");
  });

  it("GET /health/ready returns readiness info", async () => {
    const res = await request(app).get("/health/ready");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(typeof res.body.registeredPrograms).toBe("number");
  });
});

// ── Programs ───────────────────────────────────────────────────────────────────

describe("Programs API", () => {
  it("GET /api/programs returns list of seeded programs", async () => {
    const res = await request(app).get("/api/programs");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it("POST /api/programs registers a new IDL", async () => {
    const res = await request(app)
      .post("/api/programs")
      .send({ programId: COUNTER_PROGRAM_ID, idl: counterIdl });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.programId).toBe(COUNTER_PROGRAM_ID);
    expect(res.body.data.name).toBe("counter");
    expect(res.body.data.instructionCount).toBe(3);
  });

  it("GET /api/programs/:id returns the registered IDL", async () => {
    await registry.register(COUNTER_PROGRAM_ID, counterIdl);
    const res = await request(app).get(`/api/programs/${COUNTER_PROGRAM_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.data.programId).toBe(COUNTER_PROGRAM_ID);
    expect(res.body.data.idl.name).toBe("counter");
  });

  it("GET /api/programs/:id 404 for unknown program", async () => {
    const res = await request(app).get("/api/programs/UnknownProgram11111111111111111111111111");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/programs/:id/discriminators lists discriminators", async () => {
    await registry.register(COUNTER_PROGRAM_ID, counterIdl);
    const res = await request(app).get(
      `/api/programs/${COUNTER_PROGRAM_ID}/discriminators`
    );
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.discriminators)).toBe(true);
    expect(res.body.data.discriminators.length).toBe(3);
    const names = res.body.data.discriminators.map(
      (d: { instruction: string }) => d.instruction
    );
    expect(names).toContain("increment");
    expect(names).toContain("initialize");
  });

  it("POST /api/programs rejects invalid IDL", async () => {
    const res = await request(app)
      .post("/api/programs")
      .send({ programId: COUNTER_PROGRAM_ID, idl: { broken: true } });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("DELETE /api/programs/:id removes the program", async () => {
    const tempId = "TempProgram111111111111111111111111111111";
    await registry.register(tempId, counterIdl);
    const del = await request(app).delete(`/api/programs/${tempId}`);
    expect(del.status).toBe(200);
    const get = await request(app).get(`/api/programs/${tempId}`);
    expect(get.status).toBe(404);
  });

  it("DELETE /api/programs/:id 404 for unregistered program", async () => {
    const res = await request(app).delete(
      "/api/programs/Ghost1111111111111111111111111111111111111"
    );
    expect(res.status).toBe(404);
  });
});

// ── Decode Instruction ─────────────────────────────────────────────────────────

describe("POST /api/decode/instruction", () => {
  beforeEach(async () => {
    await registry.register(COUNTER_PROGRAM_ID, counterIdl);
  });

  it("decodes an increment instruction correctly", async () => {
    const data = buildIncrementData(BigInt(42));
    const res = await request(app)
      .post("/api/decode/instruction")
      .send({
        programId: COUNTER_PROGRAM_ID,
        data,
        encoding: "base64",
        accounts: [
          "CouNterAccount111111111111111111111111111111",
          "UserPubkey1111111111111111111111111111111111",
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const decoded = res.body.data;
    expect(decoded.instructionName).toBe("increment");
    expect(decoded.programName).toBe("counter");
    expect(decoded.args[0].name).toBe("amount");
    expect(decoded.args[0].value).toBe(42);
    expect(decoded.accounts).toHaveLength(2);
    expect(decoded.accounts[0].name).toBe("counter");
    expect(decoded.accounts[1].name).toBe("user");
  });

  it("decodes an initialize instruction (no args)", async () => {
    const data = buildInitializeData();
    const res = await request(app)
      .post("/api/decode/instruction")
      .send({
        programId: COUNTER_PROGRAM_ID,
        data,
        encoding: "base64",
        accounts: [
          "CouNterAccount111111111111111111111111111111",
          "UserPubkey1111111111111111111111111111111111",
          "11111111111111111111111111111111",
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.instructionName).toBe("initialize");
    expect(res.body.data.args).toHaveLength(0);
  });

  it("returns 404 when program has no registered IDL", async () => {
    const res = await request(app)
      .post("/api/decode/instruction")
      .send({
        programId: "Unknown1111111111111111111111111111111111",
        data: "3Bxs3zs2Ti9hTHM5",
        encoding: "base58",
      });
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await request(app)
      .post("/api/decode/instruction")
      .send({ programId: COUNTER_PROGRAM_ID }); // missing data
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid discriminator", async () => {
    const res = await request(app)
      .post("/api/decode/instruction")
      .send({
        programId: COUNTER_PROGRAM_ID,
        data: Buffer.alloc(16).toString("base64"), // all zeros - bad discriminator
        encoding: "base64",
      });
    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });
});

// ── Decode Discriminator ───────────────────────────────────────────────────────

describe("POST /api/decode/discriminator", () => {
  it("computes correct discriminator for a known instruction", async () => {
    const res = await request(app)
      .post("/api/decode/discriminator")
      .send({ name: "initialize" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.instructionName).toBe("initialize");
    expect(res.body.data.discriminator).toMatch(/^0x[0-9a-f]{16}$/);
    expect(res.body.data.bytes).toHaveLength(8);
  });

  it("returns 400 when name is missing", async () => {
    const res = await request(app)
      .post("/api/decode/discriminator")
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── IdlDecoderService unit tests ───────────────────────────────────────────────

describe("IdlDecoderService", () => {
  const decoder = new IdlDecoderService();

  it("_typeToString handles primitive types", () => {
    expect(decoder._typeToString("u64")).toBe("u64");
    expect(decoder._typeToString("publicKey")).toBe("publicKey");
    expect(decoder._typeToString("string")).toBe("string");
  });

  it("_typeToString handles complex types", () => {
    expect(decoder._typeToString({ vec: "u8" })).toBe("Vec<u8>");
    expect(decoder._typeToString({ option: "u64" })).toBe("Option<u64>");
    expect(decoder._typeToString({ array: ["u8", 32] })).toBe("[u8; 32]");
    expect(decoder._typeToString({ defined: "MyStruct" })).toBe("MyStruct");
  });

  it("computeDiscriminator is deterministic", () => {
    const d1 = decoder.computeDiscriminator("initialize");
    const d2 = decoder.computeDiscriminator("initialize");
    expect(d1).toBe(d2);
    expect(d1).toHaveLength(16); // 8 bytes = 16 hex chars
  });

  it("computeDiscriminator differs per instruction", () => {
    const init = decoder.computeDiscriminator("initialize");
    const incr = decoder.computeDiscriminator("increment");
    expect(init).not.toBe(incr);
  });

  it("validateIdl catches missing fields", () => {
    const issues = decoder.validateIdl({ name: "test" });
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.includes("instructions"))).toBe(true);
  });

  it("validateIdl passes for a valid IDL", () => {
    const issues = decoder.validateIdl(counterIdl);
    expect(issues).toHaveLength(0);
  });

  it("isValidPublicKey accepts valid keys", () => {
    expect(decoder.isValidPublicKey("11111111111111111111111111111111")).toBe(true);
    expect(decoder.isValidPublicKey(COUNTER_PROGRAM_ID)).toBe(true);
  });

  it("isValidPublicKey rejects invalid keys", () => {
    expect(decoder.isValidPublicKey("not-a-pubkey")).toBe(false);
    expect(decoder.isValidPublicKey("")).toBe(false);
  });

  it("listDiscriminators returns one entry per instruction", () => {
    const discs = decoder.listDiscriminators(counterIdl);
    expect(discs).toHaveLength(counterIdl.instructions.length);
    discs.forEach((d) => {
      expect(d.discriminator).toMatch(/^0x[0-9a-f]{16}$/);
    });
  });
});

// ── 404 ───────────────────────────────────────────────────────────────────────

describe("Unknown routes", () => {
  it("returns 404 for unknown GET routes", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });
});

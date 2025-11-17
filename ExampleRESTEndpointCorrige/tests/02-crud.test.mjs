import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import fs from "fs/promises";
import path from "path";
import { app, DATA_DIR } from "../src/app.mjs";

const tmpDir = path.join(process.cwd(), "data", "presets/");
async function cleanup() {
  //await fs.rm(tmpDir, { recursive: true, force: true });
  //await fs.mkdir(tmpDir, { recursive: true });
  // remove the test preset JSON file if exists, named PianoTestPreset.json
  const testPresetPath = path.join(tmpDir, "PianoTestPreset.json");
  try {
    await fs.rm(testPresetPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

beforeAll(async () => {
  await cleanup();
});

afterAll(async () => {
  //await cleanup();
});

describe("presets CRUD + search", () => {
  it("POST /api/presets -> 201", async () => {
    const payload = {
      name: "PianoTestPreset",
      type: "Piano",
      isFactoryPresets: true,
      samples: [{ url: "./piano.wav", name: "piano" }]
    };
    const res = await request(app)
      .post("/api/presets")
      .send(payload)
      .set("Content-Type", "application/json");
    expect([200,201]).toContain(res.status);
    expect(res.body.name).toBe("PianoTestPreset");
  });

  it("GET /api/presets?q=kick&type=Piano&factory=true -> array", async () => {
    const res = await request(app).get("/api/presets?q=piano&type=Piano&factory=true");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it("GET /api/presets/:name -> returns preset", async () => {
    const res = await request(app).get("/api/presets/PianoTestPreset");
    expect(res.status).toBe(200);
    expect(res.body?.name).toBe("PianoTestPreset");
  });

  it("PATCH /api/presets/:name -> can rename", async () => {
    const res = await request(app)
      .patch("/api/presets/PianoTestPreset")
      .send({ name: "PianoTestPresetV2" })
      .set("Content-Type", "application/json");
    expect([200,204]).toContain(res.status);
    const res2 = await request(app).get("/api/presets/PianoTestPresetV2");
    expect(res2.status).toBe(200);
  });

  it("DELETE /api/presets/:name -> 204", async () => {
    const res = await request(app).delete("/api/presets/PianoTestPresetV2");
    expect([200,204]).toContain(res.status);
  });
});

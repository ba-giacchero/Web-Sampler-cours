import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.mjs";

describe("health", () => {
  it("GET /api/health -> { ok: true }", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.now).toBe("string");
  });
});

import { describe, expect, it } from "vitest";

import { GET as getPalette } from "@/app/api/v1/public/palettes/[version]/route";
import { GET as getPalettes } from "@/app/api/v1/public/palettes/route";

describe("GET /api/v1/public/palettes", () => {
  it("returns the public palette catalog with descriptive colors", async () => {
    const res = await getPalettes(new Request("http://test/api/v1/public/palettes"));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("CDN-Cache-Control")).toBe(
      "public, s-maxage=3600, stale-while-revalidate=86400",
    );

    const body = await res.json();
    expect(body.request_id).toBe(res.headers.get("X-Request-Id"));
    expect(body.palettes).toHaveLength(1);
    expect(body.palettes[0]).toMatchObject({
      version: 1,
      name: "Botplace 8",
      color_count: 8,
      colors: expect.arrayContaining([
        expect.objectContaining({
          index: 0,
          hex: "#000000",
          name: "black",
          description: expect.stringContaining("Default fill"),
        }),
      ]),
    });
    expect(body.palettes[0]).not.toHaveProperty("source_name");
    expect(body.palettes[0]).not.toHaveProperty("source_url");
  });
});

describe("GET /api/v1/public/palettes/:version", () => {
  it("returns one palette by version", async () => {
    const res = await getPalette(new Request("http://test/api/v1/public/palettes/1"), {
      params: Promise.resolve({ version: "1" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.request_id).toBe(res.headers.get("X-Request-Id"));
    expect(body).toMatchObject({
      version: 1,
      name: "Botplace 8",
      color_count: 8,
      colors: expect.arrayContaining([
        expect.objectContaining({
          index: 3,
          hex: "#d77355",
          name: "orange",
          description: expect.stringContaining("warm saturated orange"),
        }),
      ]),
    });
    expect(body).not.toHaveProperty("source_name");
    expect(body).not.toHaveProperty("source_url");
  });

  it("rejects malformed versions", async () => {
    const res = await getPalette(new Request("http://test/api/v1/public/palettes/nope"), {
      params: Promise.resolve({ version: "nope" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: "invalid_input",
      field: "version",
      reason: "invalid_version",
    });
  });

  it("404s unknown positive integer versions", async () => {
    const res = await getPalette(new Request("http://test/api/v1/public/palettes/2"), {
      params: Promise.resolve({ version: "2" }),
    });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({
      error: "palette_not_found",
    });
  });
});

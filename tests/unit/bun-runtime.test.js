import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

describe("Bun runtime substrate", () => {
  test("declares the required Bun package metadata and test scripts", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );

    expect(packageJson.packageManager).toBe("bun@1.3.11");
    expect(packageJson.scripts.test).toBe("bun test tests/unit --coverage");
    expect(packageJson.scripts["test:e2e"]).toContain("bunx playwright");
  });
});

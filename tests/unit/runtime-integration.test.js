import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const readProjectFile = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

describe("Bun delivery integration", () => {
  test("uses the pinned Bun quality gates in CI", async () => {
    const workflow = await readProjectFile(".github/workflows/check.yml");

    expect(workflow).toContain("uses: oven-sh/setup-bun@v2");
    expect(workflow).toMatch(/bun-version:\s*1\.3\.11/);
    expect(workflow).toContain("bun install --frozen-lockfile");
    expect(workflow).toContain("bun run lint:baseline");
    expect(workflow).toContain("bun run typecheck");
    expect(workflow).toContain(
      "bun test tests/unit --coverage --coverage-reporter=lcov && bun run coverage:check",
    );
    expect(workflow).not.toContain("actions/setup-node");
    expect(workflow).not.toMatch(/\bnpm\b/);
  });

  test("builds and runs the container on Bun with runtime git support", async () => {
    const dockerfile = await readProjectFile("Dockerfile");
    const runtimeStage = dockerfile.slice(dockerfile.indexOf("AS runtime"));

    expect(dockerfile.match(/FROM oven\/bun:1\.3\.11/g)).toHaveLength(3);
    expect(dockerfile).toContain("COPY package.json bun.lock ./");
    expect(dockerfile).toContain("bun install --frozen-lockfile --production");
    expect(dockerfile).toContain("bun install --frozen-lockfile");
    expect(dockerfile).toContain("bun run build:ui");
    expect(runtimeStage).toContain("apt-get install -y --no-install-recommends git");
    expect(runtimeStage).toContain("USER app");
    expect(dockerfile).toContain('CMD ["bun", "server.js"]');
    expect(dockerfile).not.toMatch(/\b(npm|node):/);
  });

  test("runs staged JavaScript quality checks through Bun hooks", async () => {
    const hook = await readProjectFile(".githooks/pre-commit");

    expect(hook).toContain("git diff --cached --name-only --diff-filter=ACMR -- '*.js'");
    expect(hook).toContain("bunx eslint $staged_js");
    expect(hook).toContain("bun run lint:baseline");
    expect(hook).toContain("bunx tsc --noEmit");
    expect(hook).not.toMatch(/\b(node|npx)\b/);
  });

  test("installs hooks only from a real Git checkout", async () => {
    const installer = await readProjectFile("scripts/install-hooks.mjs");

    expect(installer).toContain("Bun.spawnSync");
    expect(installer).toContain('["git", "rev-parse", "--is-inside-work-tree"]');
    expect(installer).toContain(
      '["git", "config", "core.hooksPath", ".githooks"]',
    );
    expect(installer).toContain("checkout.exitCode === 0");
    expect(installer).toMatch(/throw new Error/);
  });

  test("launches both local modes with Bun while retaining network safeguards", async () => {
    const launcher = await readProjectFile(".mise.toml");

    expect(launcher).toContain("bun run dev:ui");
    expect(launcher).toContain("bun run start");
    expect(launcher).toMatch(/tailscale ip -4/);
    expect(launcher).toMatch(/curl .*health/);
    expect(launcher).not.toMatch(/\bnpm\b/);
  });
});

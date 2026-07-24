const checkout = Bun.spawnSync(
  ["git", "rev-parse", "--is-inside-work-tree"],
  { stdout: "pipe", stderr: "pipe" },
);

if (checkout.exitCode === 0 && checkout.stdout.toString().trim() === "true") {
  const configureHooks = Bun.spawnSync(
    ["git", "config", "core.hooksPath", ".githooks"],
    { stdout: "inherit", stderr: "inherit" },
  );

  if (configureHooks.exitCode !== 0) {
    throw new Error("Unable to configure Git hooks path");
  }
}

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { publicManifest } from "./fixtures.mjs";

const CLI = new URL("../src/cli.mjs", import.meta.url);

test("CLI emits only the deterministic dry-run plan", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pilot-preflight-"));
  const manifestPath = join(directory, "public-manifest.json");
  await writeFile(manifestPath, JSON.stringify(publicManifest()), {
    mode: 0o600
  });

  const result = spawnSync(
    process.execPath,
    [CLI.pathname, "--manifest", manifestPath],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, "dry-run");
  assert.equal(plan.network.chain_id, 84532);
  assert.equal(plan.live_execution.preflight_executes_live, false);
});

test("CLI fails closed without reflecting a secret-shaped value", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pilot-preflight-"));
  const manifestPath = join(directory, "not-public.json");
  const marker = `0x${"ab".repeat(32)}`;
  await writeFile(
    manifestPath,
    JSON.stringify(publicManifest({ game_id: marker })),
    { mode: 0o600 }
  );

  const result = spawnSync(
    process.execPath,
    [CLI.pathname, "--manifest", manifestPath],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^SECRET_VALUE_REJECTED:/);
  assert.equal(result.stderr.includes(marker), false);
  assert.equal(result.stdout, "");
});

test("CLI does not reflect a secret-shaped unknown field name", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pilot-preflight-"));
  const manifestPath = join(directory, "not-public.json");
  const marker = `mk_${"secret".repeat(4)}`;
  const manifest = publicManifest();
  manifest[marker] = "value";
  await writeFile(manifestPath, JSON.stringify(manifest), { mode: 0o600 });

  const result = spawnSync(
    process.execPath,
    [CLI.pathname, "--manifest", manifestPath],
    { encoding: "utf8" }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /^SECRET_VALUE_REJECTED:/);
  assert.equal(result.stderr.includes(marker), false);
  assert.equal(result.stdout, "");
});

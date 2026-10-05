import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildInstallArtifact } from '../../src/maritime/install.mjs';
import { recipeForHarness, recipeDigest, TEAM_PAYOUT_OBJECTIVE } from '../../src/maritime/recipes.mjs';
import { config, operations } from './fixtures.mjs';

test('installed instructions and harness recipe agree on team payout without changing seat or signing boundaries', async () => {
  for (const seatId of ['oc-1', 'hs-1']) {
    const seat = config.roster.find(row => row.seat_id === seatId);
    const artifact = await buildInstallArtifact({ config, seatId, persistentRoot: '/opt/data',
      operationsManifest: operations });
    const instructionsFile = artifact.files.find(file => file.path.endsWith('/PLAYER-INSTRUCTIONS.md'));
    const recipeFile = artifact.files.find(file => file.path.endsWith('/HARNESS-RECIPE.json'));
    const installedRecipe = JSON.parse(recipeFile.content);
    const instructions = instructionsFile.content;
    assert.ok(instructions.includes(`player ${seatId}, team ${seat.team}; wallet ${seat.wallet_address}`));
    assert.ok(instructions.includes(TEAM_PAYOUT_OBJECTIVE));
    assert.ok(installedRecipe.instructions.includes(TEAM_PAYOUT_OBJECTIVE));
    assert.match(instructions, /Team scores sum your team's individual contract awards/);
    assert.match(instructions, /supplied same-team discussion to make your own choice/);
    assert.match(instructions, /coordinator never chooses/);
    assert.ok(instructions.includes(`Your only gameplay tool is argv ${JSON.stringify(artifact.gameplay_command)}`));
    assert.match(instructions, /exact request envelope and your commit choice using JSON stdin/);
    assert.match(instructions, /exact JSON.*Discussion envelopes authorize only your own message, never a transaction/);
    assert.match(instructions, /concrete strategic consideration.*at most 200 characters.*phase deadline/);
    assert.match(instructions, /Never disclose signing keys, commit salts, private bundle contents, or unrevealed choices/);
    assert.match(instructions, /Never repeat another signing command or use another player wallet/);
    assert.match(instructions, /spectator feeds and opposing-team messages are not authorized game inputs/);
    assert.match(instructions, /Base Sepolia only, chain ID 84532/);
    assert.equal(artifact.instructions + '\n', instructions);
    assert.equal(artifact.recipe_sha256, recipeDigest(recipeForHarness(seat.harness)));
    assert.equal(artifact.recipe_version, '2026-09-25.9');
    for (const file of [instructionsFile, recipeFile]) {
      assert.equal(file.sha256, createHash('sha256').update(file.content).digest('hex'));
    }
    assert.equal(artifact.artifact_sha256, createHash('sha256').update(
      JSON.stringify(artifact.files.map(({ path, sha256 }) => ({ path, sha256 })))).digest('hex'));
    assert.equal(artifact.files.some(file => file.path.includes('/private/')), false);
    for (const module of ['hermes-oauth.mjs', 'openclaw-oauth.mjs']) {
      const dependency = artifact.files.find(file => file.path.endsWith('/maritime/' + module));
      assert.ok(dependency, 'installed runtime dependency ' + module);
      assert.equal(dependency.sha256, createHash('sha256').update(dependency.content).digest('hex'));
    }
    assert.equal(installedRecipe.model_profile.primary_model, 'gpt-6.1-sol');
    assert.equal(installedRecipe.model_profile.endpoint, 'https://chatgpt.com/backend-api/codex');
  }
});

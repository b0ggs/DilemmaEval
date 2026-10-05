import test from 'node:test';
import assert from 'node:assert/strict';
import { OPENCLAW_RECIPE, HERMES_RECIPE, TEAM_PAYOUT_OBJECTIVE } from '../../src/maritime/recipes.mjs';

test('both harness recipes target summed confirmed team awards with player decisions and private protocol boundaries', () => {
  for (const recipe of [OPENCLAW_RECIPE, HERMES_RECIPE]) {
    const instructions = recipe.instructions;
    assert.ok(instructions.includes(TEAM_PAYOUT_OBJECTIVE));
    assert.match(instructions, /maximize your own team's combined confirmed prize payout/);
    assert.match(instructions, /Team scores sum your team's individual contract awards/);
    assert.match(instructions, /funding, refunds, and claims do not add/);
    assert.match(instructions, /Make your own Share, Steal, or Catch decision using the supplied same-team discussion/);
    assert.match(instructions, /coordinator never chooses/);
    assert.match(instructions, /only your assigned player wallet/);
    assert.match(instructions, /concrete strategic consideration.*phase deadline.*succinct in ASD-STE100 format/);
    assert.match(instructions, /exact protocol JSON/);
    assert.match(instructions, /Never print.*commit salts.*private bundle contents.*unrevealed choices/);
    assert.match(instructions, /Never fetch the public spectator feed, Telegram rooms, or opposing-team messages/);
    assert.match(instructions, /outcome-unknown and do not repeat/);
    assert.equal(recipe.tool_policy.spectator_access, 'deny');
    assert.equal(recipe.tool_policy.opposing_team_access, 'deny');
  }
});

test('team instructions select authorized OAuth Sol configuration and retain the frozen game network', () => {
  for (const recipe of [OPENCLAW_RECIPE, HERMES_RECIPE]) {
    assert.equal(recipe.model_profile.provider, 'chatgpt-oauth');
    assert.equal(recipe.model_profile.endpoint, 'https://chatgpt.com/backend-api/codex');
    assert.equal(recipe.model_profile.primary_model, 'gpt-6.1-sol');
    assert.equal(recipe.model_profile.fallback_model, null);
    assert.equal(recipe.model_profile.automatic_fallback, false);
    assert.equal(recipe.model_profile.reasoning_effort, 'low');
    assert.equal(recipe.model_profile.max_output_tokens, 2048);
    assert.equal(recipe.runtime.chain_id, 84532);
    assert.equal(recipe.runtime.network, 'base-sepolia');
  }
});

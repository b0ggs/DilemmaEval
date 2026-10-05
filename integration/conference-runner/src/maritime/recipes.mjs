import { createHash } from 'node:crypto';
import { HERMES_RUNTIME_IDENTITY } from './runtime-identity.mjs';

const MODEL_PROFILE = {
  provider: 'chatgpt-oauth',
  endpoint: 'https://chatgpt.com/backend-api/codex',
  primary_model: 'gpt-6.1-sol',
  fallback_model: null,
  automatic_fallback: false,
  temperature: 0,
  max_output_tokens: 2048,
  reasoning_effort: 'low'
};

const COMMON_RUNTIME = {
  network: 'base-sepolia',
  chain_id: 84532,
  artifact: 'dilemma-conference-player-v1',
  entrypoint: 'node <installed-player-cli> <installed-seat-settings>',
  input: 'exact JSON on stdin',
  output: 'exact JSON on stdout',
  one_awake_idle_ttl_seconds: 60
};

const COMMON_STORAGE = {
  scope: 'one-private-volume-per-agent',
  seat_root: '<persistent-volume>/dilemma-conference/<seat-id>',
  private_state: '<seat-root>/private',
  permissions: '0700 directories and 0600 private files',
  restart_requirement: 'preserve prepared commit bundles and request journals'
};

export const TEAM_PAYOUT_OBJECTIVE = "Coordinate with your teammates to maximize your own team's combined confirmed prize payout. Team scores sum your team's individual contract awards; funding, refunds, and claims do not add to that score.";

const COMMON_INSTRUCTIONS = [
  'You are one player in the DilemmaEval Base Sepolia conference game.',
  TEAM_PAYOUT_OBJECTIVE,
  'Read the installed PLAYER-INSTRUCTIONS.md before acting and use only its installed player command for gameplay.',
  'Make your own Share, Steal, or Catch decision using the supplied same-team discussion. The coordinator never chooses for you. Control only your assigned player wallet.',
  'In discussion, contribute your own concrete strategic consideration for the team payout, within the phase deadline. Keep your message succinct in ASD-STE100 format. Never disclose your unrevealed choice.',
  'Return exact protocol JSON. Never print environment variables, wallet material, commit salts, private bundle contents, or unrevealed choices.',
  'Use only supplied same-team discussion. Never fetch the public spectator feed, Telegram rooms, or opposing-team messages.',
  'Treat an interrupted signing command as outcome-unknown and do not repeat it. Preserve private state across restarts.'
].join('\n');

function recipe({ harness, bootstrap }) {
  return deepFreeze({
    schema_version: 1,
    recipe_version: '2026-09-25.9',
    recipe_id: `dilemmaeval-conference-${harness}`,
    harness,
    template: harness,
    runtime: structuredClone(COMMON_RUNTIME),
    model_profile: structuredClone(MODEL_PROFILE),
    private_storage: structuredClone(COMMON_STORAGE),
    tool_policy: {
      gameplay_tool: 'installed-player-command-only',
      spectator_access: 'deny',
      opposing_team_access: 'deny',
      environment_readback: 'deny',
      shell_output_limit_bytes: 1_048_576
    },
    bootstrap,
    instructions: COMMON_INSTRUCTIONS
  });
}

export const OPENCLAW_RECIPE = recipe({
  harness: 'openclaw',
  bootstrap: {
    terminal_adapter: 'openclaw-terminal',
    instruction_source: '<seat-root>/PLAYER-INSTRUCTIONS.md',
    persistent_workspace: '<seat-root>'
  }
});

export const HERMES_RECIPE = recipe({
  harness: 'hermes',
  bootstrap: {
    terminal_adapter: 'hermes-shell',
    runtime_identity: { ...HERMES_RUNTIME_IDENTITY },
    instruction_source: '<seat-root>/PLAYER-INSTRUCTIONS.md',
    persistent_workspace: '<seat-root>'
  }
});

export function recipeForHarness(harness) {
  if (harness === 'openclaw') return OPENCLAW_RECIPE;
  if (harness === 'hermes') return HERMES_RECIPE;
  throw new TypeError('MARITIME_RECIPE_HARNESS_INVALID');
}

export function recipeDigest(value) {
  if (value !== OPENCLAW_RECIPE && value !== HERMES_RECIPE) throw new TypeError('MARITIME_RECIPE_INVALID');
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

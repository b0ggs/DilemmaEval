import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { playerFundingBudget } from './player-funding.mjs';

export const RUNTIME_EVIDENCE_MAX_AGE_MS = 10 * 60 * 1000;
const RUNTIME_FINGERPRINT_SOURCES = [
  './readiness.mjs',
  './maritime/readiness-run.mjs',
  './maritime/install.mjs',
  './maritime/recipes.mjs',
  './maritime/transport.mjs',
  './maritime/protocol.mjs',
  './maritime/player-cli.mjs',
  './maritime/player-runtime.mjs',
  './maritime/diagnostics.mjs',
  './maritime/diagnostic-receipt.mjs',
  './maritime/execution-permit.mjs',
  './maritime/continuity.mjs',
  './maritime/roster.mjs',
  './maritime/runtime-identity.mjs',
  './maritime/install-runtime.mjs',
  '../../game-bridge/src/index.js',
  '../../maritime-transport/src/validation.mjs',
  '../../shared/runtime-source.json'
];
const runtimeFingerprintHash = createHash('sha256');
for (const source of RUNTIME_FINGERPRINT_SOURCES) {
  runtimeFingerprintHash.update(source).update('\0');
  runtimeFingerprintHash.update(await readFile(new URL(source, import.meta.url))).update('\0');
}
// Despite the historical field name, this binds the coordinator transport and
// every local player-runtime source used by the exact diagnostic path.
export const TRANSPORT_FINGERPRINT = runtimeFingerprintHash.digest('hex');

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
}

export function configFingerprint(config) {
  return createHash('sha256').update(JSON.stringify(canonical(config))).digest('hex');
}

export function runtimeEvidenceFingerprint(evidence) {
  return createHash('sha256').update(JSON.stringify(canonical(evidence))).digest('hex');
}

export function rosterFingerprint(config) {
  return createHash('sha256').update(JSON.stringify(config.roster.map(s=>[s.seat_id,s.agent_id,s.wallet_address.toLowerCase(),s.team]).sort())).digest('hex');
}

function assessReadiness(config, report, durationRanges) {
  const issues=[];
  if(report.chain_id!==84532)issues.push('WRONG_CHAIN');
  const target={entryFeeWei:'100000000000000',creatorFeeBps:'100',causeFeeBps:'100',joinDurationSeconds:'60',commitDurationBlocks:'60',revealDurationBlocks:'40',minPlayers:String(config.roster.length),maxPlayers:String(config.roster.length),maxCauses:'2'};
  for(const [key,value] of Object.entries(target)){
    const range=durationRanges?.[key];const actual=String(report.config?.[key]);
    if(range?!/^\d+$/.test(actual)||BigInt(actual)<BigInt(value)||BigInt(actual)>BigInt(range.max):actual!==value)issues.push(`DEFAULT_${key}_MISMATCH`);
  }
  let minimumBalance;
  try {
    const expected = playerFundingBudget(target.entryFeeWei, report.player_funding?.base_fee_per_gas_wei);
    if (Object.entries(expected).some(([key, value]) => report.player_funding?.[key] !== value)) throw new Error();
    minimumBalance = BigInt(expected.minimum_balance_wei);
  } catch { issues.push('PLAYER_FEE_BUDGET_UNAVAILABLE'); }
  const keys=new Set();
  for(const seat of config.roster){
    const p=report.players?.find(p=>p.seat_id===seat.seat_id&&p.wallet_address.toLowerCase()===seat.wallet_address.toLowerCase());
    if(!p?.admitted)issues.push(`${seat.seat_id}:NOT_ADMITTED`);
    if(!p?.cause_whitelisted)issues.push(`${seat.seat_id}:CAUSE_UNAVAILABLE`);
    if(!/^\d+$/.test(p?.balance_wei??'')||BigInt(p.balance_wei)<(minimumBalance??BigInt(target.entryFeeWei)+1n))issues.push(`${seat.seat_id}:INSUFFICIENT_BALANCE`);
    if(p?.agent_key){if(keys.has(p.agent_key.toLowerCase()))issues.push('DUPLICATE_CHAIN_IDENTITY');keys.add(p.agent_key.toLowerCase());}
  }
  return {ready:issues.length===0,issues,target};
}

export function assessChainReadiness(config, report) { return assessReadiness(config,report); }

export function assessControlledChainReadiness(config, report) {
  return assessReadiness(config,report,{joinDurationSeconds:{max:'600'},commitDurationBlocks:{max:'300'},revealDurationBlocks:{max:'180'}});
}

function validGameplayCommand(command) {
  return Array.isArray(command) && command.length === 3 &&
    command.every(value => typeof value === 'string' && value && !/[\r\n\0]/.test(value)) &&
    command[0] === 'node' && command[1].endsWith('/player-cli.mjs') && command[2].endsWith('/seat.json') &&
    !/(?:private|bundle|journal|GAMEPLAY_WALLET_PRIVATE_KEY)/i.test(command.join('\0'));
}

const DIAGNOSTIC_CHECKS = ['stdin','wallet_identity','checkout','dependencies','wrapper','private_state','seat_lock','chain_id','contract_read'];

function validateDiagnosticResult(value, seat, mode) {
  const keys = ['schema_version','type','request_id','seat_id','team','mode','status','checks'];
  if (!value || Object.keys(value).sort().join('\0') !== keys.sort().join('\0') ||
      value.schema_version !== 1 || value.type !== 'runtime-diagnostic-response' ||
      typeof value.request_id !== 'string' || !/^[A-Za-z0-9:._-]{8,200}$/.test(value.request_id) ||
      value.seat_id !== seat.seat_id || value.team !== seat.team || value.mode !== mode || value.status !== 'ready' ||
      !value.checks || Object.keys(value.checks).sort().join('\0') !== DIAGNOSTIC_CHECKS.sort().join('\0') ||
      DIAGNOSTIC_CHECKS.some(key => value.checks[key] !== true)) {
    throw new Error('RUNTIME_DIAGNOSTIC_REQUIRED');
  }
  return value;
}

function rejectPrivateEvidence(value, key = '') {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (['choice','salt','prompt','session','privatekey','environment','rawreply','providerresponse','rawerror','privatepath','secret']
    .some(fragment => normalized.includes(fragment))) {
    throw new Error('RUNTIME_EVIDENCE_PRIVATE_FIELD');
  }
  if (Array.isArray(value)) for (const child of value) rejectPrivateEvidence(child);
  else if (value && typeof value === 'object') for (const [childKey, child] of Object.entries(value)) rejectPrivateEvidence(child, childKey);
}

// Controlled proof evidence is deliberately short-lived and must prove the
// exact non-signing chat -> tool -> stdin path for both input shapes.
export function validateControlledRuntimeEvidence(config,evidence,{
  now = Date.now(), maxAgeMs = RUNTIME_EVIDENCE_MAX_AGE_MS,
  transportFingerprint = TRANSPORT_FINGERPRINT, allowLegacyFixtures = false, allowDiagnosticsOnly = false
} = {}) {
  const nowMs = typeof now === 'function' ? now() : now;
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 || maxAgeMs > RUNTIME_EVIDENCE_MAX_AGE_MS) {
    throw new Error('RUNTIME_EVIDENCE_CLOCK_INVALID');
  }
  rejectPrivateEvidence(evidence);
  if (evidence?.producer_version !== undefined) validateProducerEvidence(config, evidence);
  else if (!allowLegacyFixtures) throw new Error('RUNTIME_PRODUCER_REQUIRED');
  if(evidence?.schema_version!==2 || evidence.run_id!==config.run_id ||
      evidence.roster_fingerprint!==rosterFingerprint(config) || evidence.config_fingerprint!==configFingerprint(config) ||
      evidence.transport_fingerprint!==transportFingerprint)throw new Error('RUNTIME_EVIDENCE_IDENTITY_MISMATCH');
  const verifiedAt = Date.parse(evidence.verified_at), expiresAt = Date.parse(evidence.expires_at);
  if(!Number.isFinite(verifiedAt)||!Number.isFinite(expiresAt)||verifiedAt>nowMs||expiresAt<=verifiedAt||
      expiresAt-verifiedAt>maxAgeMs||nowMs>=expiresAt||nowMs-verifiedAt>maxAgeMs)throw new Error('RUNTIME_EVIDENCE_EXPIRED');
  if(!/^[1-9][0-9]*$/.test(evidence.confirmed_block_number??'')||
      !/^0x[0-9a-fA-F]{64}$/.test(evidence.confirmed_block_hash??''))throw new Error('RUNTIME_EVIDENCE_BLOCK_REQUIRED');
  if(evidence.ready_for_controlled_gameplay!==true && !(allowDiagnosticsOnly && evidence.diagnostics_complete === true))throw new Error('CONTROLLED_RUNTIME_NOT_READY');
  if(evidence.sdk?.package!=='maritime-sdk'||evidence.sdk.version!=='0.6.0'||evidence.sdk.maxRetries!==0)throw new Error('RUNTIME_SDK_UNVERIFIED');
  if(!Array.isArray(evidence.seats)||evidence.seats.length!==config.roster.length)throw new Error('RUNTIME_SEAT_IDENTITY_MISMATCH');
  const requestIds = new Set();
  for(const seat of config.roster){
    const matches=evidence.seats.filter(row=>row?.seat_id===seat.seat_id&&row.agent_id===seat.agent_id);
    if(matches.length!==1)throw new Error('RUNTIME_SEAT_IDENTITY_MISMATCH');
    const row=matches[0];
    if(row.harness!==seat.harness||row.wallet_address?.toLowerCase()!==seat.wallet_address.toLowerCase())throw new Error('RUNTIME_SEAT_IDENTITY_MISMATCH');
    for(const key of ['framework_status_verified','direct_runtime_inspection_verified','wallet_identity_verified','persistent_storage_verified','tool_execution_verified'])if(row[key]!==true)throw new Error(`RUNTIME_${key.toUpperCase()}_REQUIRED`);
    if(!validGameplayCommand(row.gameplay_command))throw new Error('MARITIME_RUNTIME_COMMAND_INVALID');
    if(!/^[0-9a-f]{64}$/.test(row.artifact_sha256??'')||!Number.isSafeInteger(row.activation_generation)||row.activation_generation<0||
        row.final_agent_status!=='sleeping'||row.sleep_confirmed!==true||row.lifecycle_ambiguous!==false) {
      throw new Error('RUNTIME_LIFECYCLE_EVIDENCE_REQUIRED');
    }
    if(row.model_profile?.model_endpoint!=='https://api.maritime.sh/api/llm/v1'||row.model_profile.model!=='gpt-5.4-mini'||
        row.model_profile.reasoning_effort!=='low'||row.model_profile.max_output_tokens!==2048||
        row.model_profile.automatic_fallback!==false)throw new Error('RUNTIME_MODEL_PROFILE_UNVERIFIED');
    const gameplay=validateDiagnosticResult(row.diagnostics?.gameplay_input,seat,'gameplay-input');
    const commit=validateDiagnosticResult(row.diagnostics?.commit_input,seat,'commit-input');
    for(const result of [gameplay,commit]){
      if(requestIds.has(result.request_id))throw new Error('RUNTIME_DIAGNOSTIC_IDENTITY_REUSED');
      requestIds.add(result.request_id);
    }
  }
  return evidence;
}

// Assemble only the public, allowlisted facts collected by the diagnostic
// operator. Validation is part of construction so an incomplete run can never
// be serialized as a readiness permit.
export function buildControlledRuntimeEvidence(config,{
  confirmedBlockNumber, confirmedBlockHash, seats, now = Date.now(),
  maxAgeMs = RUNTIME_EVIDENCE_MAX_AGE_MS, transportFingerprint = TRANSPORT_FINGERPRINT,
  producer, allowLegacyFixtures = false
} = {}) {
  const nowMs = typeof now === 'function' ? now() : now;
  if (!Number.isSafeInteger(nowMs) || !Number.isSafeInteger(maxAgeMs) || maxAgeMs < 1 ||
      maxAgeMs > RUNTIME_EVIDENCE_MAX_AGE_MS || !Array.isArray(seats)) {
    throw new Error('RUNTIME_EVIDENCE_INPUT_INVALID');
  }
  const evidence = {
    schema_version: 2,
    run_id: config.run_id,
    roster_fingerprint: rosterFingerprint(config),
    config_fingerprint: configFingerprint(config),
    transport_fingerprint: transportFingerprint,
    verified_at: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + maxAgeMs).toISOString(),
    confirmed_block_number: String(confirmedBlockNumber ?? ''),
    confirmed_block_hash: confirmedBlockHash,
    sdk: { package: 'maritime-sdk', version: '0.6.0', maxRetries: 0 },
    ready_for_controlled_gameplay: producer === undefined || producer.producer_version === 2,
    seats: structuredClone(seats),
    ...(producer === undefined ? {} : structuredClone(producer))
  };
  return validateControlledRuntimeEvidence(config,evidence,{now:nowMs,maxAgeMs,transportFingerprint,
    allowLegacyFixtures,allowDiagnosticsOnly:producer !== undefined});
}

function exactEvidenceKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) {
    throw new Error('RUNTIME_EVIDENCE_UNEXPECTED_FIELD');
  }
}

function validateProducerEvidence(config, evidence) {
  exactEvidenceKeys(evidence, ['schema_version','run_id','roster_fingerprint','config_fingerprint',
    'transport_fingerprint','verified_at','expires_at','confirmed_block_number','confirmed_block_hash',
    'sdk','ready_for_controlled_gameplay','seats','producer_version','diagnostic_run_id','chain_id',
    'game_address','game_code_hash','chain_defaults_fingerprint','generation_scope','lifecycle_state_digest',
    'remote_generation_attested','diagnostics_complete',
    ...(evidence.producer_version === 2 ? ['continuity_policy'] : [])]);
  if (![1,2].includes(evidence.producer_version) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(evidence.diagnostic_run_id ?? '') ||
      evidence.chain_id !== 84532 || evidence.game_address !== config.game_address.toLowerCase() ||
      !/^0x[0-9a-f]{64}$/.test(evidence.game_code_hash ?? '') ||
      !/^[0-9a-f]{64}$/.test(evidence.chain_defaults_fingerprint ?? '') ||
      !/^[0-9a-f]{64}$/.test(evidence.lifecycle_state_digest ?? '') ||
      evidence.generation_scope !== 'diagnostic-run-intent-v1' || evidence.remote_generation_attested !== false ||
      evidence.diagnostics_complete !== true ||
      (evidence.producer_version === 1 ? evidence.ready_for_controlled_gameplay !== false :
        evidence.ready_for_controlled_gameplay !== true || evidence.continuity_policy !== 'observed-runtime-continuity-v1')) {
    throw new Error('RUNTIME_PRODUCER_BINDING_INVALID');
  }
  exactEvidenceKeys(evidence.sdk, ['package','version','maxRetries']);
  for (const row of evidence.seats ?? []) {
    exactEvidenceKeys(row, ['seat_id','agent_id','harness','wallet_address','framework_status_verified',
      'direct_runtime_inspection_verified','wallet_identity_verified','persistent_storage_verified',
      'tool_execution_verified','gameplay_command','artifact_sha256','activation_generation',
      'final_agent_status','sleep_confirmed','lifecycle_ambiguous','model_profile','diagnostics',
      'runtime_instance_fingerprint','diagnostic_generations']);
    exactEvidenceKeys(row.model_profile, ['model_endpoint','model','reasoning_effort','max_output_tokens','automatic_fallback']);
    exactEvidenceKeys(row.diagnostics, ['gameplay_input','commit_input']);
    exactEvidenceKeys(row.diagnostic_generations, ['gameplay_input','commit_input']);
    if (!/^[0-9a-f]{64}$/.test(row.runtime_instance_fingerprint ?? '') || row.activation_generation < 1 ||
        Object.values(row.diagnostic_generations).some(value => value !== row.activation_generation) ||
        !['gameplay_input','commit_input'].every(mode => row.diagnostics[mode]?.request_id ===
          `${evidence.diagnostic_run_id}:${row.seat_id}:${row.activation_generation}:${mode}`)) {
      throw new Error('RUNTIME_PRODUCER_GENERATION_MISMATCH');
    }
  }
}

// Records actual harness checks that cannot be inferred from an HTTP 200 or a prompt.
export function validateRuntimeEvidence(config,evidence) {
  if(evidence?.schema_version!==1 || evidence.run_id!==config.run_id || evidence.roster_fingerprint!==rosterFingerprint(config))throw new Error('RUNTIME_EVIDENCE_IDENTITY_MISMATCH');
  if(typeof evidence.verified_at!=='string'||!Number.isFinite(Date.parse(evidence.verified_at)))throw new Error('RUNTIME_EVIDENCE_TIME_REQUIRED');
  if(!/^0x[\da-fA-F]{64}$/.test(evidence.game_code_hash??''))throw new Error('RUNTIME_CODE_HASH_REQUIRED');
  for(const seat of config.roster){
    const row=evidence.seats?.find(s=>s.seat_id===seat.seat_id&&s.agent_id===seat.agent_id);
    for(const key of ['tool_execution_verified','persistent_bundles_verified','spectator_access_blocked','wallet_identity_verified'])if(row?.[key]!==true)throw new Error(`RUNTIME_${key.toUpperCase()}_REQUIRED`);
    if(row.model_endpoint!=='https://api.maritime.sh/api/llm/v1'||row.model!=='gpt-5.4-mini')throw new Error('RUNTIME_MODEL_PROFILE_UNVERIFIED');
  }
  return evidence;
}

import { createHash } from 'node:crypto';
import { playerFundingBudget } from './player-funding.mjs';

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

// Deliberately limited to the facts established by provisioning. The normal
// live validator below remains the gate for unattended conference operation.
export function validateControlledRuntimeEvidence(config,evidence) {
  if(evidence?.schema_version!==1 || evidence.run_id!==config.run_id || evidence.roster_fingerprint!==rosterFingerprint(config))throw new Error('RUNTIME_EVIDENCE_IDENTITY_MISMATCH');
  if(typeof evidence.verified_at!=='string'||!Number.isFinite(Date.parse(evidence.verified_at)))throw new Error('RUNTIME_EVIDENCE_TIME_REQUIRED');
  if(evidence.ready_for_controlled_gameplay!==true)throw new Error('CONTROLLED_RUNTIME_NOT_READY');
  if(evidence.sdk?.package!=='maritime-sdk'||evidence.sdk.version!=='0.6.0'||evidence.sdk.maxRetries!==0)throw new Error('RUNTIME_SDK_UNVERIFIED');
  if(!Array.isArray(evidence.seats)||evidence.seats.length!==config.roster.length)throw new Error('RUNTIME_SEAT_IDENTITY_MISMATCH');
  for(const seat of config.roster){
    const matches=evidence.seats.filter(row=>row?.seat_id===seat.seat_id&&row.agent_id===seat.agent_id);
    if(matches.length!==1)throw new Error('RUNTIME_SEAT_IDENTITY_MISMATCH');
    const row=matches[0];
    if(row.harness!==seat.harness||row.wallet_address?.toLowerCase()!==seat.wallet_address.toLowerCase())throw new Error('RUNTIME_SEAT_IDENTITY_MISMATCH');
    for(const key of ['framework_status_verified','direct_runtime_inspection_verified','wallet_identity_verified','persistent_storage_verified','tool_execution_verified'])if(row[key]!==true)throw new Error(`RUNTIME_${key.toUpperCase()}_REQUIRED`);
    if(!validGameplayCommand(row.gameplay_command))throw new Error('MARITIME_RUNTIME_COMMAND_INVALID');
  }
  return evidence;
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

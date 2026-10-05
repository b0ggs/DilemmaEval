const teams=['openclaw','hermes'];
const hash=/^0x[0-9a-fA-F]{64}$/;
const address=/^0x[0-9a-fA-F]{40}$/;
const decimal=/^(0|[1-9]\d*)$/;
const wei=value=>decimal.test(String(value))?String(value):'0';
const small=value=>Number.isSafeInteger(value)&&value>=0?value:0;
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const txUrl=value=>hash.test(value)?`https://sepolia.basescan.org/tx/${value}`:null;
const choice=value=>['Share','Steal','Catch'].includes(value)?value:null;

function projectChoices(rows,config) {
  return (Array.isArray(rows)?rows:[]).flatMap(r=>{
    const seat=config.roster.find(s=>s.wallet_address.toLowerCase()===String(r.wallet_address).toLowerCase());
    return seat && choice(r.choice)?[{seat_id:seat.seat_id,wallet_address:seat.wallet_address,choice:choice(r.choice),defaulted:r.defaulted===true,eliminated:r.eliminated===true}]:[];
  });
}

// Public data is constructed field by field; no spreading private runner records.
export function buildPublicState({config,state={},now=Date.now()}) {
  const allowedGames=new Set((state.game_ids??[]).map(String));
  const seen=new Set();
  const events=(state.events??[]).filter(e=>{
    if(!e||typeof e.id!=='string'||seen.has(e.id)||!allowedGames.has(String(e.game_id))||!decimal.test(String(e.block_number))||BigInt(e.block_number)<BigInt(config.start_block))return false;
    seen.add(e.id);return true;
  }).sort((a,b)=>BigInt(a.block_number)<BigInt(b.block_number)?-1:BigInt(a.block_number)>BigInt(b.block_number)?1:(a.log_index??0)-(b.log_index??0));
  const completed=new Map(),cancelled=new Map();
  for(const event of events){if(event.kind==='completed')completed.set(String(event.game_id),event);if(event.kind==='cancelled')cancelled.set(String(event.game_id),event);}
  const earnings=config.roster.map(s=>({seat_id:s.seat_id,wallet_address:s.wallet_address,awarded_wei:'0',claimed_wei:'0',refunded_wei:'0'}));
  const byWallet=new Map(earnings.map(s=>[s.wallet_address.toLowerCase(),s]));
  for(const event of completed.values()) for(const award of event.data?.awards??[]){const row=byWallet.get(String(award.wallet_address).toLowerCase());if(row)row.awarded_wei=String(BigInt(row.awarded_wei)+BigInt(wei(award.award_wei)));}
  for(const event of events){const field=event.kind==='claimed'?'claimed_wei':event.kind==='refunded'?'refunded_wei':null;if(!field)continue;const row=byWallet.get(String(event.data?.wallet_address).toLowerCase());if(row)row[field]=String(BigInt(row[field])+BigInt(wei(event.data.amount_wei)));}
  const latest=events.filter(e=>['completed','cancelled'].includes(e.kind)).at(-1);
  const resolved=latest?events.filter(e=>e.game_id===latest.game_id&&e.kind==='round-resolved').at(-1):null;
  const snapshot=state.snapshot;
  const current=snapshot && ['join','commit','reveal'].includes(snapshot.phase)?{
    game_id:String(snapshot.game_id),round:small(snapshot.round),phase:snapshot.phase,alive_count:small(snapshot.alive_count),committed_count:small(snapshot.committed_count),revealed_count:small(snapshot.revealed_count),
    clock:snapshot.clock&&['block','timestamp'].includes(snapshot.clock.unit)?{unit:snapshot.clock.unit,current:wei(snapshot.clock.current),deadline:wei(snapshot.clock.deadline)}:null
  }:null;
  const messages=Object.fromEntries(teams.map(team=>[team,(state.messages?.[team]??[]).filter(m=>config.roster.some(s=>s.seat_id===m.seat_id&&s.team===team)&&typeof m.message==='string').slice(-20).map(m=>({seat_id:m.seat_id,game_id:String(m.game_id),round:small(m.round),message:m.message,received_at:time(m.received_at)}))]));
  // Export fixed issue codes, never raw adapter errors, endpoint URLs or request content.
  const safeIssues=new Set(['chain-unavailable','agent-unavailable','telegram-unavailable','scheduling-blocked','stale-state']);
  const issues=[];
  for(const issue of state.health??[]){
    const code=typeof issue==='string'?issue:issue?.code;
    if(safeIssues.has(code))issues.push(code);
    else if(/chain|rpc/i.test(code??''))issues.push('chain-unavailable');
    else if(/telegram|spectator/i.test(code??''))issues.push('telegram-unavailable');
    else if(/agent|dispatch|discussion/i.test(code??''))issues.push('agent-unavailable');
    else issues.push('scheduling-blocked');
  }
  const updated=time(state.updated_at);
  if(updated&&now-Date.parse(updated)>20000)issues.push('stale-state');
  const scheduling=state.scheduling??{};
  let status=!updated?'starting':current?'playing':scheduling.status==='stopped'?'stopped':scheduling.status==='intermission'?'intermission':'starting';
  if(issues.length)status='degraded';
  return {
    schema_version:1,run_id:config.run_id,mode:config.mode,network:'Base Sepolia',chain_id:84532,updated_at:updated,status,next_game_at:time(scheduling.next_game_at),
    roster:config.roster.map(s=>({seat_id:s.seat_id,team:s.team,harness:s.harness,wallet_address:s.wallet_address})),
    counts:{completed:completed.size,cancelled:cancelled.size},current_game:current,messages,earnings,
    latest_result:latest?{game_id:String(latest.game_id),outcome:latest.kind==='completed'?'completed':'cancelled',transaction_hash:hash.test(latest.transaction_hash)?latest.transaction_hash:null,transaction_url:txUrl(latest.transaction_hash),choices:projectChoices(resolved?.data?.choices,config),awards:(latest.data?.awards??[]).filter(a=>address.test(a.wallet_address)).map(a=>({wallet_address:a.wallet_address,award_wei:wei(a.award_wei)}))}:null,
    links:{contract:`https://sepolia.basescan.org/address/${config.game_address}`,telegram:Object.fromEntries(teams.map(t=>[t,config.telegram[t].invite_url??null]))},
    health:{ok:issues.length===0,issues:[...new Set(issues)]}
  };
}

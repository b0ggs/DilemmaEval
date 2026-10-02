import { readFile } from 'node:fs/promises';

// Synthetic adapter for local integration/visual QA. This does not implement or prove game rules.
export async function fixtureConfig({now=Date.now(),runId='local-fixture',teamSizes}={}) {
  const c=JSON.parse(await readFile(new URL('../../../conference/config.example.json',import.meta.url),'utf8'));
  Object.assign(c,{mode:'fixture',run_id:runId,start_block:'1',start_time:new Date(now-1000).toISOString(),stop_time:new Date(now+3600000).toISOString(),intermission_ms:2000,poll_interval_ms:250});
  if(teamSizes!==undefined){
    if(!teamSizes||!['openclaw','hermes'].every(team=>Number.isSafeInteger(teamSizes[team])&&teamSizes[team]>=1&&teamSizes[team]<=10))throw new Error('FIXTURE_TEAM_SIZE_INVALID');
    c.roster=['openclaw','hermes'].flatMap((team,teamIndex)=>Array.from({length:teamSizes[team]},(_,index)=>({
      seat_id:`${team==='openclaw'?'oc':'hs'}-${index+1}`,team,harness:team,
      maritime_agent:`synthetic-fixture-${team}-${index+1}`,
      wallet_address:`0x${(teamIndex*10+index+1).toString(16).padStart(40,'0')}`,cause_id:teamIndex+1
    })));
  }
  c.roster.forEach((s,i)=>{s.agent_id=`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`;});
  return c;
}

export function createFixtureAdapters({config,now=Date.now,cancelGameIds=[]}) {
  if(config?.mode!=='fixture')throw new Error('FIXTURE_MODE_REQUIRED');
  if(!Array.isArray(cancelGameIds)||cancelGameIds.some(id=>!/^[1-9][0-9]*$/.test(String(id))))throw new Error('FIXTURE_GAME_ID_INVALID');
  const cancelledGames=new Set(cancelGameIds.map(String));
  let block=10,game=0,active=null;
  const games=new Map(),events=[];
  const hash=n=>`0x${BigInt(n).toString(16).padStart(64,'0')}`;
  function event(kind,data={},g=active) {const e={id:`${hash(events.length+1)}:0`,game_id:g.game_id,round:g.round,kind,block_number:String(++block),transaction_hash:hash(events.length+1),log_index:0,data};events.push(e);return e;}
  function snapshot(g=active) {
    return {schema_version:1,chain_id:84532,game_address:config.game_address,game_id:g?.game_id??'0',active_game_id:active&&active.phase!=='terminal'?active.game_id:'0',round:g?.round??0,phase:g?.phase??'idle',outcome:g?.outcome??null,block_number:String(block),block_hash:hash(block),block_timestamp:String(Math.floor(now()/1000)),alive_count:g?.players.filter(p=>p.joined&&p.alive).length??0,committed_count:g?.players.filter(p=>p.committed).length??0,revealed_count:g?.players.filter(p=>p.revealed).length??0,clock:!g||g.phase==='terminal'?null:g.phase==='join'?{unit:'timestamp',current:String(Math.floor(now()/1000)),deadline:g.deadline}:{unit:'block',current:String(block),deadline:String(g.deadline)},players:structuredClone(g?.players??[]),config:{entryFeeWei:'100000000000000',minPlayers:String(config.roster.length),maxPlayers:String(config.roster.length)},transaction_hash:null};
  }
  return {
    chain:{readSnapshot:async({gameId}={})=>snapshot(gameId?games.get(String(gameId)):active),readBlockHash:async({blockNumber})=>hash(blockNumber),readEvents:async({fromBlock,toBlock}={})=>structuredClone(events.filter(e=>BigInt(e.block_number)>=BigInt(fromBlock??0)&&BigInt(e.block_number)<=BigInt(toBlock??block))),preflight:async()=>({fixture:true})},
    launcher:{create:async()=>{
      if(active&&active.phase!=='terminal')return {status:'rejected-before-submit'};
      active={game_id:String(++game),round:0,phase:'join',outcome:null,deadline:String(Math.floor(now()/1000)+1),players:config.roster.map(s=>({wallet_address:s.wallet_address,joined:false,alive:false,committed:false,revealed:false,award_wei:'0',claimed_wei:'0',refunded_wei:'0'}))};games.set(active.game_id,active);
      const e=event('created');return {status:'accepted',reference:{kind:'transaction-hash',value:e.transaction_hash}};
    }},
    phaseExecutor:{advance:async intent=>{
      if(active?.game_id!==intent.game_id||active.phase!==intent.phase)return {status:'rejected-before-submit'};
      if(active.phase==='join'){
        if(Math.floor(now()/1000)<=Number(active.deadline))return {status:'rejected-before-submit'};
        // Explicit synthetic cancellation lets assembly tests exercise refunds;
        // this is not a simulation of the contract's cancellation rules.
        if(cancelledGames.has(active.game_id)){
          active.phase='terminal';active.outcome='cancelled';
          const e=event('cancelled');return {status:'accepted',reference:{kind:'transaction-hash',value:e.transaction_hash}};
        }
        active.phase='commit';active.round=1;active.deadline=block+60;
      }
      else if(active.phase==='commit'){active.phase='reveal';active.deadline=block+40;}
      else {
        event('round-resolved',{choices:active.players.filter(p=>p.joined).map(p=>({wallet_address:p.wallet_address,choice:'Share',defaulted:!p.revealed,eliminated:false})),remaining_players:active.players.filter(p=>p.alive).length});
        active.phase='terminal';active.outcome='completed';active.players.forEach(p=>{p.award_wei=p.joined?'98010000000000':'0';});
        const e=event('completed',{awards:active.players.map(p=>({wallet_address:p.wallet_address,award_wei:p.award_wei}))});return {status:'accepted',reference:{kind:'transaction-hash',value:e.transaction_hash}};
      }
      block++;return {status:'accepted',reference:{kind:'transaction-hash',value:hash(block)}};
    }},
    agents:{dispatch:async({seat,request:r})=>{
      const result={schema_version:1,request_id:r.request_id,game_id:r.game_id,round:r.round,phase:r.phase,seat_id:r.seat_id,status:'observed'};
      if(r.type==='discussion')return {...result,type:'discussion-response',team:r.team,team_message:`Fixture message from ${r.seat_id}. Synthetic local test; no live agent conversation.`};
      const g=games.get(r.game_id),p=g.players.find(p=>p.wallet_address===seat.wallet_address);
      if(r.requested_action==='join'&&!p.joined){p.joined=p.alive=true;event('joined',{wallet_address:p.wallet_address},g);}
      if(r.requested_action==='commit')p.committed=true;
      if(r.requested_action==='reveal')p.revealed=true;
      if(r.requested_action==='claim'&&g.outcome==='cancelled'&&p.joined&&p.refunded_wei==='0'){
        p.refunded_wei='100000000000000';
        event('refunded',{wallet_address:p.wallet_address,amount_wei:p.refunded_wei},g);
      }else if(r.requested_action==='claim'&&g.outcome==='completed'&&BigInt(p.award_wei)>BigInt(p.claimed_wei)){
        p.claimed_wei=p.award_wei;
        event('claimed',{wallet_address:p.wallet_address,amount_wei:p.award_wei},g);
      }
      block++;return {...result,status:'submitted',transaction_hash:hash(block)};
    }},
    spectator:{publish:async()=>{},health:async()=>({ok:true})}
  };
}

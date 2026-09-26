import { Contract, FetchRequest, Interface, JsonRpcProvider, getAddress, keccak256 } from 'ethers';
import { GAME_ABI, PHASE_NAMES, CHOICE_NAMES, publicConfig } from './abi.mjs';
import { playerFundingBudget } from '../player-funding.mjs';

const iface = new Interface(GAME_ABI);
export async function verifyBaseSepoliaRpc(provider) {
  // Do not rely solely on getNetwork(), which a configured provider may cache.
  if (BigInt(await provider.send('eth_chainId', [])) !== 84532n) throw new Error('WRONG_CHAIN');
}
export function makeProvider(rpcUrl) {
  const request = new FetchRequest(rpcUrl);
  request.timeout = 15_000;
  return new JsonRpcProvider(request, undefined, { cacheTimeout: -1, batchMaxCount: 1 });
}
export function assertChainConfig(config) {
  if (config.chain_id !== 84532) throw new Error('BASE_SEPOLIA_REQUIRED');
  for (const key of ['game_address', 'auth_adapter_address', 'expected_owner']) getAddress(config[key]);
  if (!Number.isInteger(config.confirmations ?? 2) || (config.confirmations ?? 2) < 1) throw new Error('INVALID_CONFIRMATIONS');
}
const dec = (value) => value.toString();
const uint = (value) => {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value))) throw new Error('INVALID_CHAIN_INTEGER');
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error('CHAIN_INTEGER_TOO_LARGE');
  return result;
};

export function createChainReader({ config, provider = makeProvider(config.rpc_url) }) {
  assertChainConfig(config);
  const contract = new Contract(config.game_address, GAME_ABI, provider);
  const address = getAddress(config.game_address);
  async function confirmedBlock() {
    // Check the actual network on every read; a provider configuration is not evidence.
    if (Number((await provider.getNetwork()).chainId) !== 84532) throw new Error('WRONG_CHAIN');
    const tip = await provider.getBlockNumber();
    const number = Math.max(0, tip - (config.confirmations ?? 2) + 1);
    const block = await provider.getBlock(number);
    if (!block?.hash) throw new Error('CONFIRMED_BLOCK_UNAVAILABLE');
    return block;
  }
  async function readBlockHash({ blockNumber }) {
    await verifyBaseSepoliaRpc(provider);
    const block = await provider.getBlock(uint(blockNumber));
    if (!block?.hash) throw new Error('BLOCK_UNAVAILABLE');
    return block.hash;
  }
  async function checkedRead(block, callback) {
    const value = await callback();
    if ((await provider.getBlock(block.number))?.hash !== block.hash) throw new Error('CHAIN_REORG_DURING_READ');
    return value;
  }
  async function snapshotAt(block, gameId) {
    const opts = { blockTag: block.number };
    const [active, current, defaults] = await Promise.all([
      contract.activeGameId(opts), contract.currentGameId(opts), contract.getDefaultConfig(opts),
    ]);
    const id = gameId === undefined ? (active !== 0n ? active : current) : BigInt(gameId);
    const base = {
      schema_version: 1, chain_id: 84532, game_address: address,
      game_id: dec(id), active_game_id: dec(active), round: 0, phase: 'idle', outcome: null,
      block_number: dec(block.number), block_hash: block.hash, block_timestamp: dec(block.timestamp),
      alive_count: 0, committed_count: 0, revealed_count: 0, clock: null, players: [],
      config: publicConfig(defaults), transaction_hash: null,
    };
    if (id === 0n) return base;
    const game = await contract.getGame(id, opts);
    if (game.createdAt === 0n) throw new Error('GAME_NOT_FOUND');
    const phase = PHASE_NAMES[Number(game.phase)];
    if (!phase || phase === 'idle') throw new Error('UNSUPPORTED_GAME_PHASE');
    const count = uint(await contract.playerCount(id, opts));
    if (count > 256) throw new Error('INVALID_PLAYER_COUNT');
    const wallets = await Promise.all(Array.from({ length: count }, (_, i) => contract.playerAt(id, i, opts)));
    const players = await Promise.all(wallets.map(async (wallet) => {
      const [player, claim, refund] = await Promise.all([
        contract.getPlayer(id, wallet, opts), contract.previewWinnerClaim(id, wallet, opts), contract.previewRefund(id, wallet, opts),
      ]);
      return {
        wallet_address: getAddress(wallet), joined: player.joined, alive: player.alive,
        committed: player.committedThisRound, revealed: player.revealedThisRound,
        award_wei: dec(claim.netPrizeWei), claimed_wei: player.claimed ? dec(claim.netPrizeWei) : '0',
        refunded_wei: player.refunded ? dec(refund.refundWei) : '0',
      };
    }));
    return {
      ...base, round: Number(game.round), phase,
      outcome: Number(game.phase) === 5 ? 'cancelled' : Number(game.phase) === 4 ? 'completed' : null,
      alive_count: Number(game.aliveCount), committed_count: Number(game.committedCount), revealed_count: Number(game.revealedCount),
      clock: phase === 'join' ? { unit: 'timestamp', current: dec(block.timestamp), deadline: dec(game.joinDeadline) }
        : ['commit', 'reveal'].includes(phase) ? { unit: 'block', current: dec(block.number), deadline: dec(phase === 'commit' ? game.commitDeadlineBlock : game.revealDeadlineBlock) } : null,
      players, config: publicConfig(game),
    };
  }
  async function readSnapshot({ gameId } = {}) {
    const block = await confirmedBlock();
    return checkedRead(block, () => snapshotAt(block, gameId));
  }
  async function readEvents({ fromBlock, toBlock } = {}) {
    const block = await confirmedBlock();
    const start = uint(fromBlock ?? config.start_block);
    const end = Math.min(uint(toBlock ?? block.number), block.number);
    if (start > end) return [];
    return checkedRead(block, async () => {
      const logs = [];
      // Public Base RPCs impose small getLogs ranges. Keep retries with the caller.
      for (let first = start; first <= end; first += 1000) {
        logs.push(...await provider.getLogs({ address, fromBlock: first, toBlock: Math.min(first + 999, end) }));
      }
      const parsed = logs.filter((log) => !log.removed && log.address.toLowerCase() === address.toLowerCase()).map((log) => {
        try { return { log, event: iface.parseLog(log) }; } catch { return null; }
      }).filter((item) => item?.event).sort((a, b) => a.log.blockNumber - b.log.blockNumber || a.log.index - b.log.index);
      const normalized = [];
      for (const { log, event } of parsed) {
        const a = event.args;
        const common = { id: `${log.transactionHash}:${log.index}`, game_id: dec(a.gameId), round: a.round === undefined ? 0 : Number(a.round), block_number: dec(log.blockNumber), transaction_hash: log.transactionHash, log_index: log.index };
        if (event.name === 'GameCreated') normalized.push({ ...common, kind: 'created', data: { join_deadline: dec(a.joinDeadline), entry_fee_wei: dec(a.entryFeeWei) } });
        if (event.name === 'PlayerJoined') normalized.push({ ...common, kind: 'joined', data: { wallet_address: getAddress(a.wallet), cause_id: Number(a.causeId) } });
        if (event.name === 'GameCancelled') normalized.push({ ...common, kind: 'cancelled', data: {} });
        if (event.name === 'PrizeClaimed') normalized.push({ ...common, kind: 'claimed', data: { wallet_address: getAddress(a.wallet), amount_wei: dec(a.netPrizeWei) } });
        if (event.name === 'RefundClaimed') normalized.push({ ...common, kind: 'refunded', data: { wallet_address: getAddress(a.wallet), amount_wei: dec(a.refundWei) } });
        if (event.name === 'RoundResolved') {
          const related = parsed.filter((item) => item.log.transactionHash === log.transactionHash && item.event.args.gameId === a.gameId && item.event.args.round === a.round);
          const eliminated = new Set(related.filter((item) => item.event.name === 'PlayerEliminated').map((item) => item.event.args.wallet.toLowerCase()));
          const choices = related.filter((item) => item.event.name === 'EffectiveChoiceMaterialized').map(({ event: choiceEvent }) => {
            const c = choiceEvent.args;
            const choice = CHOICE_NAMES[Number(c.choice)];
            if (!choice) throw new Error('INVALID_RESOLVED_CHOICE');
            return { wallet_address: getAddress(c.wallet), choice, defaulted: c.defaultedCommit || c.defaultedReveal, eliminated: eliminated.has(c.wallet.toLowerCase()) };
          });
          normalized.push({ ...common, kind: 'round-resolved', data: { choices, remaining_players: Number(a.aliveCount) } });
        }
        if (event.name === 'GameEnded') {
          // Query that exact historical block; never derive awards from a later game's state.
          const eventBlock = await provider.getBlock(log.blockNumber);
          if (!eventBlock || (log.blockHash && eventBlock.hash !== log.blockHash)) throw new Error('CHAIN_REORG_DURING_READ');
          const ended = await snapshotAt(eventBlock, dec(a.gameId));
          // Include zero awards so consumers can verify the complete game roster.
          const awards = ended.players.map(({ wallet_address, award_wei }) => ({ wallet_address, award_wei }));
          normalized.push({ ...common, kind: 'completed', data: { awards } });
        }
      }
      return normalized;
    });
  }
  async function preflight() {
    const block = await confirmedBlock();
    return checkedRead(block, async () => {
      const opts = { blockTag: block.number };
      const [code, owner, auth, active, defaults] = await Promise.all([
        provider.getCode(address, block.number), contract.owner(opts), contract.authRegistry(opts), contract.activeGameId(opts), contract.getDefaultConfig(opts),
      ]);
      if (code === '0x') throw new Error('GAME_CONTRACT_NOT_DEPLOYED');
      if (owner.toLowerCase() !== config.expected_owner.toLowerCase()) throw new Error('OWNER_MISMATCH');
      if (auth.toLowerCase() !== config.auth_adapter_address.toLowerCase()) throw new Error('AUTH_ADAPTER_MISMATCH');
      let registry = null;
      if (config.identity_registry_address) {
        const adapter = new Contract(auth, ['function identityRegistry() view returns(address)'], provider);
        registry = await adapter.identityRegistry(opts);
        if (getAddress(registry) !== getAddress(config.identity_registry_address)) throw new Error('IDENTITY_REGISTRY_MISMATCH');
        const [adapterCode, registryCode] = await Promise.all([provider.getCode(auth, block.number), provider.getCode(registry, block.number)]);
        if (adapterCode === '0x' || registryCode === '0x') throw new Error('AUTH_CONTRACT_NOT_DEPLOYED');
      }
      const players = await Promise.all((config.roster ?? []).map(async (seat) => {
        const [admitted, agentKey, balance, cause] = await Promise.all([
          contract.isAdmissionReady(seat.wallet_address, opts), contract.admissionAgentKey(seat.wallet_address, opts),
          provider.getBalance(seat.wallet_address, block.number), contract.isCauseWhitelisted(seat.cause_id, opts),
        ]);
        return { seat_id: seat.seat_id, wallet_address: getAddress(seat.wallet_address), admitted, agent_key: agentKey, balance_wei: dec(balance), cause_whitelisted: cause };
      }));
      return { chain_id: 84532, game_address: address, block_number: dec(block.number), block_hash: block.hash, block_timestamp: dec(block.timestamp), owner, auth_adapter_address: auth, identity_registry_address: registry, active_game_id: dec(active), code_hash: keccak256(code), config: publicConfig(defaults),
        player_funding: playerFundingBudget(defaults.entryFeeWei, block.baseFeePerGas), players };
    });
  }
  return Object.freeze({ readSnapshot, readEvents, preflight, readBlockHash });
}

// Minimal ABI copied from the pinned PrisonersDAOlemma.sol at
// 955ce16a59b0efecf6ccdf2d391ede83de8902a8. Choice order is Share, Catch, Steal.
export const CONFIG_FIELDS = ['entryFeeWei', 'creatorFeeBps', 'causeFeeBps', 'joinDurationSeconds', 'commitDurationBlocks', 'revealDurationBlocks', 'minPlayers', 'maxPlayers', 'maxCauses'];
export const CONFIG_TUPLE = '(uint256 entryFeeWei,uint16 creatorFeeBps,uint16 causeFeeBps,uint32 joinDurationSeconds,uint32 commitDurationBlocks,uint32 revealDurationBlocks,uint16 minPlayers,uint16 maxPlayers,uint16 maxCauses)';
export const GAME_ABI = [
  'function owner() view returns(address)',
  'function authRegistry() view returns(address)',
  'function activeGameId() view returns(uint256)',
  'function currentGameId() view returns(uint256)',
  `function getDefaultConfig() view returns(${CONFIG_TUPLE})`,
  'function getGame(uint256) view returns((uint256 entryFeeWei,uint16 creatorFeeBps,uint16 causeFeeBps,uint32 joinDurationSeconds,uint32 commitDurationBlocks,uint32 revealDurationBlocks,uint16 minPlayers,uint16 maxPlayers,uint16 maxCauses,uint16 joinedCount,uint16 aliveCount,uint16 usedCauseCount,uint16 committedCount,uint16 revealedCount,uint64 createdAt,uint64 joinDeadline,uint64 commitDeadlineBlock,uint64 revealDeadlineBlock,uint32 round,uint32 shareStreak,uint8 phase,uint8 outcome,address treasury))',
  'function getPlayer(uint256,address) view returns((bool joined,bool alive,bool claimed,bool refunded,bool committedThisRound,bool revealedThisRound,address wallet,bytes32 agentKey,uint16 causeId,bytes32 commitment,uint8 revealedChoice,uint8 effectiveChoice,uint32 lastChoiceRound))',
  'function playerCount(uint256) view returns(uint256)',
  'function playerAt(uint256,uint256) view returns(address)',
  'function isAdmissionReady(address) view returns(bool)',
  'function admissionAgentKey(address) view returns(bytes32)',
  'function isCauseWhitelisted(uint16) view returns(bool)',
  'function previewWinnerClaim(uint256,address) view returns(uint256 grossPrizeWei,uint256 causeCutWei,uint256 netPrizeWei,bool availableNow)',
  'function previewRefund(uint256,address) view returns(uint256 refundWei,bool availableNow)',
  'function canAdvancePhase(uint256) view returns(bool)',
  'function createGame() returns(uint256)',
  'function advancePhase(uint256)',
  `function configureDefaults(${CONFIG_TUPLE})`,
  'event GameCreated(uint256 indexed gameId,uint64 joinDeadline,uint256 entryFeeWei,uint16 minPlayers,uint16 maxPlayers,uint16 maxCauses)',
  'event GameCancelled(uint256 indexed gameId)',
  'event GameEnded(uint256 indexed gameId,uint8 outcome,uint32 round,uint16 winnerCount,uint32 shareStreak)',
  'event PlayerJoined(uint256 indexed gameId,address indexed wallet,bytes32 indexed agentKey,uint16 causeId,uint16 joinedCount)',
  'event EffectiveChoiceMaterialized(uint256 indexed gameId,uint32 indexed round,address indexed wallet,uint8 choice,bool defaultedCommit,bool defaultedReveal)',
  'event PlayerEliminated(uint256 indexed gameId,uint32 indexed round,address indexed wallet,uint8 choice)',
  'event RoundResolved(uint256 indexed gameId,uint32 indexed round,uint16 sharers,uint16 catchers,uint16 stealers,uint16 eliminatedCount,uint16 aliveCount,uint32 shareStreak)',
  'event PrizeClaimed(uint256 indexed gameId,address indexed wallet,uint16 indexed causeId,uint256 grossPrizeWei,uint256 causeCutWei,uint256 netPrizeWei,address causeRecipient)',
  'event RefundClaimed(uint256 indexed gameId,address indexed wallet,uint256 refundWei)',
];
export const PHASE_NAMES = ['idle', 'join', 'commit', 'reveal', 'terminal', 'terminal'];
export const CHOICE_NAMES = [null, 'Share', 'Catch', 'Steal'];
export function publicConfig(value) {
  return Object.fromEntries(CONFIG_FIELDS.map((field) => [field, value[field].toString()]));
}

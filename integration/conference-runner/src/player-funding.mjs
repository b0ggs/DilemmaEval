// The pinned Foundry player uses ethers 5.7.2, whose London fee population
// reserves 2 * baseFee + a 1.5 gwei priority fee. The coordinator uses ethers 6;
// its provider fee estimate must not stand in for the player's signing policy.
const PRIORITY_FEE_WEI = 1_500_000_000n;
// Conservative starting runway for join, an initial commit/reveal, and claim.
// This is an admission floor, not a guarantee for an arbitrary number of rounds.
const RESERVE_GAS_UNITS = 1_000_000n;

export function playerFundingBudget(entryFeeWei, baseFeePerGas) {
  if (!/^[0-9]+$/.test(String(entryFeeWei)) || baseFeePerGas === null ||
      baseFeePerGas === undefined || !/^[0-9]+$/.test(String(baseFeePerGas))) {
    throw new Error('PLAYER_FEE_BUDGET_UNAVAILABLE');
  }
  const maxFee = 2n * BigInt(baseFeePerGas) + PRIORITY_FEE_WEI;
  return {
    fee_model: 'pinned-ethers-5', base_fee_per_gas_wei: String(baseFeePerGas),
    max_fee_per_gas_wei: String(maxFee), reserve_gas_units: String(RESERVE_GAS_UNITS),
    minimum_balance_wei: String(BigInt(entryFeeWei) + maxFee * RESERVE_GAS_UNITS)
  };
}

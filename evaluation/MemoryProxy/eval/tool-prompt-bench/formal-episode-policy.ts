/** Public, Variant-independent boundary for one Task 1 decision episode. */
export const FORMAL_EPISODE_POLICY = Object.freeze({
  additionalUserTurns: 0,
  tdaiAttemptHorizon: 4,
  defaultWallTimeMs: 180_000,
} as const);

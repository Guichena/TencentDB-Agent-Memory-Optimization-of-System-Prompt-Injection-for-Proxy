/**
 * Frozen M0 public surface.
 *
 * The integrated measurement-v2 barrel also exports M2 usage and isolation
 * contracts. Keeping this entrypoint narrow preserves the independently
 * reviewed M0 scorer manifest without hiding the integrated APIs.
 */
export { aggregateCaseChainFacts } from "./aggregate.js";
export { scoreCaseChain } from "./scorer.js";
export type * from "./types.js";

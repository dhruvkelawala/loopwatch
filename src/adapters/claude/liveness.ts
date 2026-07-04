/**
 * Claude liveness re-export (issue #11). The liveness model is fully
 * source-agnostic and now lives in `../core/liveness.ts`; this shim keeps the
 * Claude import path stable.
 */
export * from '../core/liveness.js';

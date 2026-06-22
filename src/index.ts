// Public library entry point.
// Phase 1 exports: types and errors only.
// Later phases add:
//   export { ArxivClient } from "./core/client.js";   // Phase 4
//   export { normalizeId } from "./core/ids.js";       // Phase 2

export * from "./core/types.js";
export * from "./core/errors.js";

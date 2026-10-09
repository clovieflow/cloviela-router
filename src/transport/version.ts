import pkg from "../../package.json";

/**
 * Single Source of Truth for Cloviela versioning and release metadata.
 * All runtime endpoints, observability stores, and metadata helpers import from here.
 */
export const CLOVIELA_VERSION = pkg.version;

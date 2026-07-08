import { sqlite } from '@flue/runtime/node';

// Flue beta.9 uses a newer persisted schema than Loopwatch's earlier walking
// skeleton database. Use a versioned default file so upgrading the app never
// mutates or crashes on an older local `data/flue.db`; tests and operators can
// still override the path explicitly.
export default sqlite(process.env.LOOPWATCH_FLUE_DB_PATH ?? './data/flue-v4.db');

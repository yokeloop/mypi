// Composition entry for storage-only consumers (no Git subprocess dependency).
import { jsonlJournal } from '../modules/knowledge/adapters/jsonl-journal.js';
import { publishedArtifacts } from '../modules/knowledge/public.js';
export { jsonlJournal as journalStorage };
export const publishedArtifactPaths = (root: string) => publishedArtifacts(jsonlJournal(root));

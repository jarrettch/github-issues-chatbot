import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from project root BEFORE importing sync
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Dynamic import after env vars are loaded
(async () => {
  const { syncIssues } = await import('../lib/sync.js');
  await syncIssues();
})().catch(console.error);

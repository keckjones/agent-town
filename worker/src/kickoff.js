// The town's first jobs. Runs automatically the first time the worker starts,
// or manually with `npm run kickoff`.
import { enqueue } from './lib/db.js';

export async function firstJobs() {
  await enqueue('manager', 'plan', {}, { priority: 1, createdBy: 'kickoff' });
  await enqueue('scout', 'find_prospects', { limit: 10 }, { priority: 2, createdBy: 'kickoff' });
  await enqueue('research', 'research', {
    topic: 'What do small local businesses in College Station, TX typically pay for a simple website and monthly maintenance, and who are the main local competitors?',
  }, { priority: 3, createdBy: 'kickoff' });
  console.log('Queued the first town meeting, a scouting trip, and a research report.');
}

if (process.argv[1]?.endsWith('kickoff.js')) {
  await firstJobs();
  process.exit(0);
}

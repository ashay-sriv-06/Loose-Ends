// npm run fixture:reset — regenerates the synthetic demo folders. Touches only fixtures/acme and fixtures/edge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAcme, buildEdgeCases, resetFixture } from '../src/fixture/build.ts';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures');
const corrected = process.argv.includes('--corrected');
await resetFixture(path.join(fixturesDir, 'acme'), fixturesDir, (d) => buildAcme(d, undefined, { corrected }));
await resetFixture(path.join(fixturesDir, 'edge'), fixturesDir, (d) => buildEdgeCases(d));
console.log(`Fixtures regenerated in ${fixturesDir} (${corrected ? 'corrected' : 'baseline'} state).`);

// Ember Run 3D: Volcano Ridge — the entrypoint.
// Hands the game in: copies game/ and screenshots/ from this repository
// into the output directory and writes the dossier that buildDossier makes
// from them. Run it as:
//   MAKEFUN_OUTPUT_DIR=out node main.ts
// (the grader sets MAKEFUN_OUTPUT_DIR to /output for you).
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outDir, { recursive: true });
for (const sub of ['game', 'screenshots']) {
  cpSync(join(repoRoot, sub), join(outDir, sub), { recursive: true });
}

writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
}));

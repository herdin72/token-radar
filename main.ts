// Token Radar (radar-2) entry point — Node 22, standard library only.
//
// Reads the sealed snapshot, scores it with lib/model.ts, and writes the
// graded output directory:
//   board.json    ranked board (watchlist + early radar, each with a farm plan)
//   data.js       the same board, compact, for the dashboard page
//   dashboard/    a copy of this repo's dashboard/
//   screenshots/  a copy of this repo's screenshots/
//   dossier.json  buildDossier's summary, written last so it covers the rest
//
// Deterministic by construction: the snapshot is fixed, every sort has a
// slug tiebreak, and no clock, random value or filesystem order leaks
// into any output byte. Run it twice and the two directories are identical.
//
// Usage (outside the grader's container):
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const TEXT_CAP = 65_536;

function flagValue(name: string, fallback: string): string {
  const argv = process.argv;
  const pos = argv.indexOf(`--${name}`);
  if (pos >= 0 && pos + 1 < argv.length) return argv[pos + 1]!;
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  if (eq !== undefined) return eq.slice(name.length + 3);
  return fallback;
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputGiven = flagValue('input', '/input');
const snapshotPath = inputGiven.endsWith('.json') ? inputGiven : join(inputGiven, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|directory>`);
}
const outDir = flagValue('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const problem = boardIssue(board, snapshot);
if (problem !== null) fail(`the model wrote a board the gate refuses: ${problem}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a flat directory's regular files, in name order, skipping dot-names. */
function copyFlat(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.')).sort();
  const copied: string[] = [];
  for (const name of names) {
    const src = join(from, name);
    if (!statSync(src).isFile()) continue;
    copyFileSync(src, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashFiles = copyFlat(join(repoRoot, 'dashboard'), join(outDir, 'dashboard'));
const shotFiles = copyFlat(join(repoRoot, 'screenshots'), join(outDir, 'screenshots'));
if (dashFiles.length < 3) fail(`dashboard/ holds only ${dashFiles.length} file(s): hand in index.html, app.css and app.js`);
if (shotFiles.length < 3) fail(`screenshots/ holds only ${shotFiles.length} image(s): hand in 3, the board, a detail view and a filtered view`);
const badShot = shotFiles.find((n) => !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(n));
if (badShot !== undefined) fail(`screenshots/${badShot}: a name is letters, digits and . _ -, 1 to 128 characters`);

// Dossier last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_CAP,
    screenshots: { max: 4, max_bytes: 524_288 },
    dashboard: { max_files: 400, max_bytes: 4_194_304 },
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, dashboard (${dashFiles.length} files), screenshots (${shotFiles.length} images), dossier.json\n`,
);

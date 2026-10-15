import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {validateLiveConfig} from '../live/config.mjs';

// Offline documentation checks only: no wallet, RPC, provider or portal requests.
const root = resolve(import.meta.dirname, '..');
const read = path => readFileSync(join(root, path), 'utf8');
const pkg = JSON.parse(read('package.json'));
const card = JSON.parse(read('agent-card.json'));
const lock = JSON.parse(read('package-lock.json'));
const failures = [];
const fail = message => failures.push(message);
const release = pkg.version.split('.').slice(0, 2).join('.');
for (const [name, version] of [['agent-card.json', card.version], ['package-lock.json', lock.version], ['lock root package', lock.packages[''].version]]) {
  if (version !== pkg.version) fail(`${name}: version differs from package.json`);
}

function markdownFiles(dir) {
  return readdirSync(join(root, dir), {withFileTypes: true}).flatMap(entry => {
    if (['.git', 'node_modules', 'state'].includes(entry.name)) return [];
    const path = join(dir, entry.name);
    return entry.isDirectory() ? markdownFiles(path) : entry.name.endsWith('.md') ? [path] : [];
  });
}

function headings(path) {
  const used = new Map();
  return new Set([...read(path).matchAll(/^#{1,6}\s+(.+)$/gm)].map(([, text]) => {
    const slug = text.toLowerCase().replace(/[^\p{L}\p{N}_\-\s]/gu, '').replace(/\s/g, '-');
    const count = used.get(slug) ?? 0;
    used.set(slug, count + 1);
    return count ? `${slug}-${count}` : slug;
  }));
}

function checkLocalLink(path, target) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return; // Remote availability is a separate check.
  const [file, fragment] = target.split('#');
  const absolute = file ? resolve(root, dirname(path), decodeURIComponent(file)) : join(root, path);
  const rel = relative(root, absolute);
  if (rel.startsWith(`..${sep}`) || rel === '..' || !existsSync(absolute)) {
    fail(`${path}: missing or out-of-repository link ${target}`);
  } else if (fragment && rel.endsWith('.md') && statSync(absolute).isFile() && !headings(rel).has(decodeURIComponent(fragment))) {
    fail(`${path}: missing heading ${target}`);
  }
}

// The docs-only report is historical. Execution evidence includes the newer
// complete suite and its dedicated live subset; do not overwrite that baseline.
const evidence = JSON.parse(read('evidence/live-execution-verification.json'));
const complete = evidence.verification.find(result => result.command === 'npm test');
const live = evidence.verification.find(result => result.command === 'npm run test:live');
for (const [name, result] of [['complete', complete], ['live', live]]) {
  if (!Number.isSafeInteger(result?.total) || result.total <= 0 || result.passed !== result.total ||
      result.failed !== 0 || result.skipped !== 0 || result.exitCode !== 0) fail(`execution evidence: invalid ${name} test result`);
}
const evidenceCount = complete?.total;
const liveCount = live?.total;
if (liveCount > evidenceCount) fail('execution evidence: live subset exceeds complete suite');

// CI supplies the TAP file from the same run so recorded claims cannot silently
// outlive removed, failing or skipped tests. Standalone checks remain offline.
const args = process.argv.slice(2);
if (args.length) {
  if (args.length !== 2 || args[0] !== '--tap') fail('Usage: check-docs.mjs [--tap <complete-suite.tap>]');
  else {
    try {
      const tap = readFileSync(args[1], 'utf8');
      for (const [key, expected] of [['tests', evidenceCount], ['pass', evidenceCount], ['fail', 0], ['skipped', 0], ['cancelled', 0], ['todo', 0]]) {
        const values = [...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))];
        if (values.length !== 1 || Number(values[0][1]) !== expected) fail(`TAP ${key}: expected ${expected}`);
      }
    } catch { fail('Cannot read complete-suite TAP evidence'); }
  }
}

const liveClaims = [
  /no (?:published )?(?:automated )?live(?:-executor)? tests/i,
  /(?:suite|checkout) (?:does not|doesn't) (?:include|exercise) (?:this |the )?(?:live(?:-executor| executor)?|executor)/i,
  /no tests? (?:currently |in the published suite )?(?:imports?|exercise)[^\n]*live\//i,
  /live lifecycle tests absent/i,
];
function checkCounts(path, prose) {
  for (const [, count, scope] of prose.matchAll(/\b(\d+)\s+(?:passing\s+)?(?:(live execution|automated|software)\s+)?tests\b/g)) {
    const expected = scope === 'live execution' ? liveCount : evidenceCount;
    if (Number(count) !== expected) fail(`${path}: claimed ${scope ?? 'complete'} test count ${count} differs from recorded ${expected}`);
  }
}
checkCounts('agent-card.json', card.liveExecutorTestCoverage ?? '');
if (liveClaims.some(pattern => pattern.test(card.liveExecutorTestCoverage ?? ''))) fail('agent-card.json: superseded live-test denial');
let linkCount = 0;
const docs = markdownFiles('.');
for (const path of docs) {
  const text = read(path);
  const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').replace(/\*\*/g, '');
  // Check project release labels, not arbitrary dependency versions or historical evidence.
  const labels = [...prose.matchAll(/^#{1,6}[^\n]*\bv(\d+\.\d+)(?:\.\d+)?\b/gm),
    ...prose.matchAll(/\b(?:GhOsT|current|continuous|Version)\s+v?(\d+\.\d+)(?:\.\d+)?\b/gi)];
  for (const [, version] of labels) {
    if (version !== release) fail(`${path}: stale release framing v${version} (expected v${release})`);
  }
  checkCounts(path, prose);
  if (liveClaims.some(pattern => pattern.test(prose.replace(/\s+/g, ' ')))) fail(`${path}: superseded live-test denial`);
  if (/^(?:<{7}|={7}|>{7})(?: |$)/m.test(text)) fail(`${path}: unresolved merge conflict`);
  for (const [, target] of text.matchAll(/\[[^\]\n]*\]\(([^\s)]+)\)/g)) {
    checkLocalLink(path, target);
    linkCount++;
  }
  for (const [, source] of text.matchAll(/^cp (examples\/[^\s]+) /gm)) {
    if (!existsSync(join(root, source))) fail(`${path}: copy command refers to missing ${source}`);
  }
}

for (const key of ['reviewGuide', 'businessOverview', 'operatingGuide', 'liveGuide', 'publicDescriptions', 'taskEntryPoint', 'runtimeEntryPoint', 'liveEntryPoint']) {
  if (typeof card[key] !== 'string' || !existsSync(join(root, card[key]))) fail(`agent-card.json: missing ${key} target`);
}
const staleClaims = [
  ['SECURITY.md', /This prototype has no token-trading executor\./],
  ['docs/AGENT.md', /No real orders are possible\./],
  ['docs/BUSINESS_OVERVIEW.md', /Live swaps,\s+real exits and unattended production operation are not available\./],
  ['docs/CREDIT_REVIEW.md', /No live-money execution, hosted runtime,/],
];
for (const [path, pattern] of staleClaims) if (pattern.test(read(path))) fail(`${path}: superseded project-wide capability denial`);

// Validate the documented config using public synthetic addresses, never real keys.
const configBlock = read('docs/LIVE.md').match(/```json\n([\s\S]*?)\n```/);
if (configBlock) {
  try {
    const config = JSON.parse(configBlock[1]);
    for (const [i, key] of ['walletAddress', 'poolAddress', 'tokenAddress'].entries()) {
      if (!/^REPLACE_/.test(config[key])) throw new Error(`${key} must be a placeholder`);
      config[key] = `0x${String(i + 1).repeat(40)}`;
    }
    validateLiveConfig(config);
  } catch (error) { fail(`docs/LIVE.md: invalid example configuration (${error.message})`); }
} else fail('docs/LIVE.md: missing inline JSON configuration example');

if (failures.length) {
  failures.forEach(message => console.error(message));
  process.exitCode = 1;
} else {
  console.log(`Documentation checks passed: ${docs.length} Markdown files, ${linkCount} links, v${release} metadata and recorded test counts.`);
  console.log('Remote availability, claim accuracy and trading reliability still require separate evidence review.');
}

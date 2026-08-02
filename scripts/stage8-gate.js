/**
 * Stage 8 gate: every public CID has a review with content hashes;
 * automated blockers are 0.
 *
 * reviewKind is the sole authority for Final classification (fail-closed):
 * - human      → verdict must be pass; counts as humanPass
 * - agent-spot → verdict must be agent-spot
 * - audit      → verdict must be audit-clean
 *
 * Reviewer display names are NOT used to infer humanity.
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASTRO = path.join(ROOT, 'astro');
const REVIEWS = path.join(ROOT, 'docs/baselines/reviews');
const failures = [];
const warnings = [];
const check = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const warn = (cond, msg) => {
  if (cond) warnings.push(msg);
};

const KIND_TO_VERDICT = {
  human: 'pass',
  'agent-spot': 'agent-spot',
  audit: 'audit-clean',
};

const sha256File = (abs) => {
  if (!fs.existsSync(abs)) return null;
  return crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
};

const audit = spawnSync('node', ['scripts/stage8-audit.js', '--audit-only'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(audit.status === 0 || audit.status === 2, `stage8-audit failed to run: ${audit.stderr}`);
const summary = JSON.parse(audit.stdout);
check(summary.block === 0, `audit blockers remain: ${JSON.stringify(summary.blockers)}`);
check(summary.total >= 15, `expected ≥15 public entries, got ${summary.total}`);

const manifest = JSON.parse(fs.readFileSync(path.join(ASTRO, '.cache/manifest.json'), 'utf8'));
const cids = manifest.entries.map((e) => e.cid).sort((a, b) => a - b);

let humanPass = 0;
let agentSpot = 0;
let auditClean = 0;

for (const cid of cids) {
  const rel = path.join(REVIEWS, `cid-${cid}.json`);
  check(fs.existsSync(rel), `missing review record cid-${cid}.json`);
  if (!fs.existsSync(rel)) continue;
  const review = JSON.parse(fs.readFileSync(rel, 'utf8'));
  check(review.cid === cid, `review cid mismatch in ${rel}`);
  check(!!review.reviewedAt, `cid ${cid} missing reviewedAt`);
  check(!!review.reviewer, `cid ${cid} missing reviewer`);
  check(!!review.contentHashes?.sourceSha256, `cid ${cid} missing sourceSha256`);

  const kind = review.reviewKind;
  check(
    Object.hasOwn(KIND_TO_VERDICT, kind),
    `cid ${cid} reviewKind must be human|agent-spot|audit (got ${kind})`,
  );
  if (Object.hasOwn(KIND_TO_VERDICT, kind)) {
    check(
      review.verdict === KIND_TO_VERDICT[kind],
      `cid ${cid}: reviewKind=${kind} requires verdict=${KIND_TO_VERDICT[kind]} (got ${review.verdict})`,
    );
  }

  if (kind === 'human') {
    humanPass += 1;
  } else if (kind === 'agent-spot') {
    agentSpot += 1;
  } else if (kind === 'audit') {
    auditClean += 1;
  }

  const entry = manifest.entries.find((e) => e.cid === cid);
  if (entry) {
    const kindDir = entry.kind === 'page' ? 'pages' : 'posts';
    const mdPath = path.join(ASTRO, 'src/content', kindDir, `${entry.entryId}.md`);
    const sourceHash = sha256File(mdPath);
    check(sourceHash === review.contentHashes.sourceSha256, `cid ${cid} source hash drift`);
  }

  const cl = review.checklist || {};
  for (const key of ['sourceFormatOk', 'shortcodesOk', 'legacyLinksOk', 'localUploadsOk', 'headingsNoted']) {
    check(cl[key] === true || cl[key] === null, `cid ${cid} checklist.${key} invalid`);
  }
  check(
    cl.shortcodesOk !== false && cl.legacyLinksOk !== false && cl.localUploadsOk !== false,
    `cid ${cid} checklist failed automated item`,
  );
  if (Array.isArray(review.blockers)) {
    check(review.blockers.length === 0, `cid ${cid} review still lists blockers`);
  }
}

warn(agentSpot > 0, `${agentSpot}/${cids.length} reviews are agent-spot (not human Final)`);
warn(auditClean > 0, `${auditClean}/${cids.length} reviews are audit (not human Final)`);
warn(humanPass < cids.length, `Stage 8 Final incomplete: human pass ${humanPass}/${cids.length}`);

const uploadsOk = fs.existsSync(path.join(ROOT, 'astro/public/usr/uploads/2026/03/1901601289.png'));
check(uploadsOk, 'local upload for silly-tavern-linux missing under astro/public/usr/uploads');

const report = {
  ok: failures.length === 0,
  failures,
  warnings,
  audit: summary,
  reviewCount: cids.length,
  humanPass,
  agentSpot,
  auditClean,
};
fs.mkdirSync(path.join(ROOT, 'docs/baselines/reports'), { recursive: true });
fs.writeFileSync(
  path.join(ROOT, 'docs/baselines/reports/stage8-gates.md'),
  [
    '# Stage 8 gates',
    '',
    `**Result:** ${report.ok ? 'PASS' : 'FAIL'} (automated blockers)`,
    '',
    `- Public CIDs with review records: ${cids.length}`,
    `- Human Final (reviewKind=human): ${humanPass}`,
    `- Agent spot (reviewKind=agent-spot): ${agentSpot}`,
    `- Audit sync (reviewKind=audit): ${auditClean}`,
    `- Audit: pass=${summary.pass} warn=${summary.warn} block=${summary.block}`,
    '- Classification uses explicit `reviewKind` only (reviewer name is display metadata)',
    '- Content hashes required on every review (sourceSha256)',
    '- Heading skips & body h1s: accepted warnings (A11y at Stage 9 Lighthouse)',
    '',
    warnings.length ? `## Warnings\n\n${warnings.map((w) => `- ${w}`).join('\n')}` : '## Warnings\n\n(none)',
    '',
    failures.length ? `## Failures\n\n${failures.map((f) => `- ${f}`).join('\n')}` : '## Failures\n\n(none)',
    '',
  ].join('\n'),
);

if (failures.length) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report));

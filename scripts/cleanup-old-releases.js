import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASE_ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;
const STAGING_RE = /^\.(\d{8}T\d{6}Z-[0-9a-f]{8})\.staging$/;

function fail(message) {
  throw new Error(message);
}

function assertReleaseId(value, label) {
  if (!RELEASE_ID_RE.test(value || '')) fail(`${label} is not a valid release id`);
  return value;
}

function assertInteger(value, label, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    fail(`${label} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function directRelease(releasesReal, releaseId) {
  const releasePath = path.join(releasesReal, releaseId);
  const entry = fs.lstatSync(releasePath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    fail(`release ${releaseId} is not a real directory`);
  }
  const entryReal = fs.realpathSync(releasePath);
  if (path.dirname(entryReal) !== releasesReal || path.basename(entryReal) !== releaseId) {
    fail(`release ${releaseId} escapes the releases directory`);
  }
  return { releasePath, entry };
}

function resolveMarker(deployReal, releasesReal, markerName) {
  const markerPath = path.join(deployReal, markerName);
  let marker;
  try {
    marker = fs.lstatSync(markerPath);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (!marker.isSymbolicLink()) fail(`${markerName} marker is not a symbolic link`);
  const markerReal = fs.realpathSync(markerPath);
  const releaseId = path.basename(markerReal);
  assertReleaseId(releaseId, `${markerName} target`);
  if (path.dirname(markerReal) !== releasesReal) fail(`${markerName} target escapes releases`);
  directRelease(releasesReal, releaseId);
  return releaseId;
}

function directoryBytes(directory) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) total += directoryBytes(entryPath);
    else if (entry.isFile()) total += fs.statSync(entryPath).size;
    else fail(`unexpected special entry in cleanup candidate: ${entryPath}`);
  }
  return total;
}

function removeVerifiedDirectory(releasesReal, candidatePath, expectedName, releasesDevice) {
  const entry = fs.lstatSync(candidatePath);
  if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`cleanup candidate is not a real directory: ${expectedName}`);
  const candidateReal = fs.realpathSync(candidatePath);
  if (path.dirname(candidateReal) !== releasesReal || path.basename(candidateReal) !== expectedName) {
    fail(`cleanup candidate escaped releases: ${expectedName}`);
  }
  if (entry.dev !== releasesDevice) fail(`cleanup candidate is on another filesystem: ${expectedName}`);
  fs.rmSync(candidateReal, { recursive: true, force: false, maxRetries: 0 });
}

export function cleanupOldReleases({
  deployRoot,
  stateDir,
  activeRelease,
  keep = 5,
  stagingMaxAgeHours = 24,
  dryRun = false,
  nowMs = Date.now(),
}) {
  if (!path.isAbsolute(deployRoot || '')) fail('deploy root must be absolute');
  if (!path.isAbsolute(stateDir || '')) fail('state dir must be absolute');
  const keepCount = assertInteger(keep, 'keep', 3, 1000);
  const stagingHours = assertInteger(stagingMaxAgeHours, 'staging max age hours', 1, 24 * 365);
  const activeId = assertReleaseId(activeRelease, 'active release');
  const deployReal = fs.realpathSync(deployRoot);
  const releasesPath = path.join(deployReal, 'releases');
  const releasesEntry = fs.lstatSync(releasesPath);
  if (!releasesEntry.isDirectory() || releasesEntry.isSymbolicLink()) fail('releases must be a real directory');
  const releasesReal = fs.realpathSync(releasesPath);
  if (path.dirname(releasesReal) !== deployReal || path.basename(releasesReal) !== 'releases') {
    fail('releases directory is not a direct child of deploy root');
  }

  const protectedIds = new Set([activeId]);
  const markers = {};
  for (const markerName of ['current', 'previous', 'candidate']) {
    const releaseId = resolveMarker(deployReal, releasesReal, markerName);
    markers[markerName] = releaseId;
    if (releaseId) protectedIds.add(releaseId);
  }
  if (markers.current !== activeId) fail('active release does not match current marker');

  const successFile = path.join(fs.realpathSync(stateDir), 'last-success-release');
  const lastSuccess = assertReleaseId(fs.readFileSync(successFile, 'utf8').trim(), 'last-success-release');
  directRelease(releasesReal, lastSuccess);
  protectedIds.add(lastSuccess);

  const releaseIds = [];
  const stagingEntries = [];
  for (const entry of fs.readdirSync(releasesReal, { withFileTypes: true })) {
    if (RELEASE_ID_RE.test(entry.name)) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`release entry is not a real directory: ${entry.name}`);
      const verified = directRelease(releasesReal, entry.name);
      if (verified.entry.dev !== releasesEntry.dev) fail(`release is on another filesystem: ${entry.name}`);
      releaseIds.push(entry.name);
      continue;
    }
    const stagingMatch = entry.name.match(STAGING_RE);
    if (stagingMatch) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`staging entry is not a real directory: ${entry.name}`);
      const stagingPath = path.join(releasesReal, entry.name);
      const stagingReal = fs.realpathSync(stagingPath);
      if (path.dirname(stagingReal) !== releasesReal || path.basename(stagingReal) !== entry.name) {
        fail(`staging entry escapes releases: ${entry.name}`);
      }
      const stat = fs.statSync(stagingPath);
      if (stat.dev !== releasesEntry.dev) fail(`staging entry is on another filesystem: ${entry.name}`);
      stagingEntries.push({ name: entry.name, mtimeMs: stat.mtimeMs });
    }
  }

  if (!releaseIds.includes(activeId)) fail('active release directory is absent');
  const newest = [...releaseIds].sort().reverse().slice(0, keepCount);
  for (const releaseId of newest) protectedIds.add(releaseId);

  const releasesToDelete = releaseIds
    .filter((releaseId) => !protectedIds.has(releaseId))
    .sort();
  const stagingCutoff = nowMs - stagingHours * 60 * 60 * 1000;
  const stagingToDelete = stagingEntries
    .filter((entry) => entry.mtimeMs < stagingCutoff)
    .map((entry) => entry.name)
    .sort();

  const releaseBytes = releasesToDelete.reduce(
    (total, releaseId) => total + directoryBytes(path.join(releasesReal, releaseId)),
    0,
  );
  const stagingBytes = stagingToDelete.reduce(
    (total, entryName) => total + directoryBytes(path.join(releasesReal, entryName)),
    0,
  );

  if (!dryRun) {
    for (const releaseId of releasesToDelete) {
      removeVerifiedDirectory(releasesReal, path.join(releasesReal, releaseId), releaseId, releasesEntry.dev);
    }
    for (const entryName of stagingToDelete) {
      removeVerifiedDirectory(releasesReal, path.join(releasesReal, entryName), entryName, releasesEntry.dev);
    }
  }

  return {
    ok: true,
    dryRun: Boolean(dryRun),
    deployRoot: deployReal,
    keepCount,
    stagingMaxAgeHours: stagingHours,
    markers,
    lastSuccess,
    protectedReleases: [...protectedIds].sort(),
    deletedReleases: releasesToDelete,
    deletedStaging: stagingToDelete,
    reclaimedBytes: releaseBytes + stagingBytes,
  };
}

function option(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  if (index + 1 >= args.length) fail(`${name} requires a value`);
  return args[index + 1];
}

function main() {
  const args = process.argv.slice(2);
  const result = cleanupOldReleases({
    deployRoot: option(args, '--deploy-root'),
    stateDir: option(args, '--state-dir'),
    activeRelease: option(args, '--active-release'),
    keep: option(args, '--keep', '5'),
    stagingMaxAgeHours: option(args, '--staging-max-age-hours', '24'),
    dryRun: args.includes('--dry-run'),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`release cleanup refused: ${error.message}\n`);
    process.exitCode = 1;
  }
}

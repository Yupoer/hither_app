import { createHash } from 'node:crypto';

export const ALL_GROUPS = Object.freeze([
  'auth-web', 'backend', 'ci-required', 'components', 'expo-dependencies', 'expo-doctor',
  'jsi-ios27-runtime', 'jsi-ui-runtime', 'lint', 'node', 'runtime-alignment', 'test-meta', 'typecheck', 'workflow-tooling',
]);
const ALWAYS_GROUPS = ['ci-required', 'test-meta', 'workflow-tooling'];
const MANIFEST_PATH = 'scripts/ci-module-contracts.json';
const safePath = value => typeof value === 'string' && value.length > 0 &&
  !value.startsWith('/') && !value.includes('\\') && !value.split('/').some(part => part === '..' || part === '.') &&
  !/[\x00-\x1f\x7f:]/.test(value);
const safeId = value => typeof value === 'string' && /^[a-z][a-z0-9-]*$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const matches = (file, selector) => selector.endsWith('/') ? file.startsWith(selector) : file === selector;
const sorted = values => [...new Set(values)].sort();

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || !Number.isSafeInteger(manifest.version) || manifest.version < 1 ||
      !Array.isArray(manifest.modules) || manifest.modules.length === 0 || !Array.isArray(manifest.contracts) ||
      !Array.isArray(manifest.fullFallbackPaths) || !manifest.fullFallbackPaths.every(safePath)) throw new Error('invalid manifest');
  const ids = new Set(manifest.modules.map(module => module.id));
  if (ids.size !== manifest.modules.length) throw new Error('duplicate module');
  for (const module of manifest.modules) {
    if (!safeId(module.id) || !Array.isArray(module.paths) || !module.paths.length || !module.paths.every(safePath) ||
        !Array.isArray(module.groups) || !module.groups.length || !module.groups.every(group => ALL_GROUPS.includes(group)) ||
        !Array.isArray(module.consumers) || !module.consumers.every(id => ids.has(id))) throw new Error('invalid module');
  }
  const contractIds = new Set();
  for (const contract of manifest.contracts) {
    if (!safeId(contract.id) || contractIds.has(contract.id) || !Array.isArray(contract.producerPaths) ||
        !contract.producerPaths.length || !contract.producerPaths.every(safePath) || !Array.isArray(contract.consumers) ||
        !contract.consumers.length || !contract.consumers.every(id => ids.has(id))) throw new Error('invalid contract');
    contractIds.add(contract.id);
  }
  return manifest;
}

function validChange(change) {
  return change && ['A', 'M', 'D', 'R', 'C', 'T'].includes(change.status) && safePath(change.path) &&
    ((change.status === 'R' || change.status === 'C') ? safePath(change.oldPath) : change.oldPath === undefined);
}

export function parseChanges(raw) {
  const fields = raw.split('\0');
  if (fields.pop() !== '') throw new Error('unterminated changes');
  const changes = [];
  while (fields.length) {
    const code = fields.shift();
    const status = code?.[0];
    if (!/^(?:[AMDT]|[RC]\d{1,3})$/.test(code)) throw new Error('unsupported change');
    const change = status === 'R' || status === 'C' ? { status, oldPath: fields.shift(), path: fields.shift() } : { status, path: fields.shift() };
    if (!validChange(change)) throw new Error('invalid change');
    changes.push(change);
  }
  return changes;
}

export function buildShadowPlan({ identity, changes, baseManifest, headManifest, eligibleAppPaths = [], readFailed = false }) {
  const validIdentity = identity && sha(identity.baseSha) && sha(identity.headSha) && sha(identity.treeSha) &&
    ['triple-dot', 'endpoints'].includes(identity.diffMode);
  const report = {
    schemaVersion: 1, shadowOnly: true,
    identity: validIdentity ? { baseSha: identity.baseSha, headSha: identity.headSha, treeSha: identity.treeSha, diffMode: identity.diffMode } : null,
    manifests: null, changes: [], affectedModules: [], contracts: [], alwaysGroups: ALWAYS_GROUPS,
    proposedGroups: [...ALL_GROUPS], fallbackReasons: [],
    coverageEligibleAppPaths: Array.isArray(eligibleAppPaths) ? eligibleAppPaths.filter(safePath) : [],
    actualSuiteEvidence: { node: 'node-receipt.json', otherRunners: 'unavailable' },
  };
  if (!validIdentity) report.fallbackReasons.push('invalid-source-identity');
  if (readFailed) report.fallbackReasons.push('change-or-manifest-read-failed');
  let manifests;
  try {
    manifests = [validateManifest(baseManifest), validateManifest(headManifest)];
  } catch {
    report.fallbackReasons.push('invalid-or-unavailable-manifest');
  }
  if (!Array.isArray(changes) || !changes.every(validChange)) report.fallbackReasons.push('invalid-change-records');
  if (report.fallbackReasons.length) return report;
  report.manifests = Object.fromEntries(manifests.map((manifest, i) => [i === 0 ? 'base' : 'head', {
    version: manifest.version, sha256: createHash('sha256').update(JSON.stringify(manifest)).digest('hex'),
  }]));
  const modules = manifests.flatMap(manifest => manifest.modules);
  const contracts = manifests.flatMap(manifest => manifest.contracts);
  const affected = new Set();
  const affectedContracts = new Set();
  for (const change of changes) {
    const paths = [change.path, ...(change.oldPath ? [change.oldPath] : [])];
    const owners = modules.filter(module => paths.some(file => module.paths.some(selector => matches(file, selector))));
    const produced = contracts.filter(contract => paths.some(file => contract.producerPaths.some(selector => matches(file, selector))));
    for (const module of owners) affected.add(module.id);
    for (const contract of produced) {
      affectedContracts.add(contract.id);
      for (const consumer of contract.consumers) affected.add(consumer);
    }
    const reasons = [];
    for (const file of paths) {
      if (!modules.some(module => module.paths.some(selector => matches(file, selector)))) reasons.push('unknown-owner');
      if (manifests.some(manifest => manifest.fullFallbackPaths.some(selector => matches(file, selector)))) reasons.push('shared-config-or-dynamic-input');
    }
    report.fallbackReasons.push(...reasons);
    report.changes.push({ status: change.status, path: change.path, ...(change.oldPath ? { oldPath: change.oldPath } : {}),
      owners: sorted(owners.map(module => module.id)), contracts: sorted(produced.map(contract => contract.id)), reasons: sorted(reasons) });
  }
  let previousSize;
  do {
    previousSize = affected.size;
    for (const module of modules) if (affected.has(module.id)) for (const consumer of module.consumers) affected.add(consumer);
  } while (affected.size !== previousSize);
  report.affectedModules = sorted(affected);
  report.contracts = sorted(affectedContracts);
  report.fallbackReasons = sorted(report.fallbackReasons);
  report.proposedGroups = report.fallbackReasons.length ? [...ALL_GROUPS] : sorted([
    ...ALWAYS_GROUPS, ...modules.filter(module => affected.has(module.id)).flatMap(module => module.groups),
  ]);
  return report;
}

export function observeShadowPlan({ identity, eligibleAppPaths, git }) {
  try {
    const baseManifest = JSON.parse(git(['show', `${identity.baseSha}:${MANIFEST_PATH}`]));
    const headManifest = JSON.parse(git(['show', `${identity.headSha}:${MANIFEST_PATH}`]));
    const range = identity.diffMode === 'triple-dot' ? [`${identity.baseSha}...${identity.headSha}`] : [identity.baseSha, identity.headSha];
    const raw = git(['diff', '--name-status', '-z', ...range]);
    return buildShadowPlan({ identity, eligibleAppPaths, baseManifest, headManifest, changes: raw ? parseChanges(raw) : [] });
  } catch {
    return buildShadowPlan({ identity, eligibleAppPaths, readFailed: true });
  }
}

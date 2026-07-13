const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const OUTER_KEYS = Object.freeze([
  'schemaVersion', 'creationRoute', 'status', 'network', 'chainId', 'transactions',
  'receipt', 'prerequisites', 'coreConfig', 'grants', 'flmConfig', 'feeTier',
  'poolInitCodeHash', 'observationCardinality', 'contracts', 'codeBlobs',
  'runtimeCodeHashes', 'finalization'
]);
const CONTRACT_KEYS = Object.freeze([
  'space', 'arbitration', 'vault', 'treasuryExecutor', 'companyToken', 'proposalGateway',
  'releaseStrategy', 'votingStrategy', 'evaluator', 'orchestrator', 'resolver',
  'futarchyFactory', 'spotPool', 'relay', 'spotAdapter', 'conditionalAdapter', 'guard',
  'router', 'manager', 'vestingWallets'
]);

function invalid(reason) {
  throw new Error(`invalid economic deployment manifest: ${reason}`);
}

function exactKeys(value, expected, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') invalid(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some((key) => !actual.includes(key))) {
    invalid(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function address(value, label) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || /^0x0{40}$/i.test(value)) {
    invalid(`${label} must be a nonzero address`);
  }
  return value.toLowerCase();
}

function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value) || /^0x0{64}$/i.test(value)) {
    invalid(`${label} must be a nonzero bytes32`);
  }
  return value.toLowerCase();
}

// Full canonical/evidence validation stays in FAO's economic_deployment.py. This browser parser
// binds only the Lane-4 runtime records it subsequently verifies live.
export function validateTreasuryManifest(value) {
  exactKeys(value, OUTER_KEYS, 'manifest');
  if (value.schemaVersion !== 3 || value.network !== 'sepolia' || value.chainId !== 11155111) {
    invalid('identity must be Sepolia schema version 3');
  }
  if (!['create', 'registrar'].includes(value.creationRoute)) invalid('creationRoute is invalid');
  if (!['sealed', 'live'].includes(value.status)) invalid('status must be sealed or live');
  exactKeys(value.contracts, CONTRACT_KEYS, 'contracts');
  if (!Array.isArray(value.contracts.vestingWallets)) invalid('contracts.vestingWallets must be an array');
  const contracts = {};
  for (const key of CONTRACT_KEYS.slice(0, -1)) contracts[key] = address(value.contracts[key], `contracts.${key}`);
  exactKeys(value.runtimeCodeHashes, ['treasuryExecutor'], 'runtimeCodeHashes');
  const treasuryExecutorHash = hash(
    value.runtimeCodeHashes.treasuryExecutor, 'runtimeCodeHashes.treasuryExecutor'
  );
  return Object.freeze({
    ...value,
    contracts: Object.freeze({ ...value.contracts, ...contracts }),
    runtimeCodeHashes: Object.freeze({ treasuryExecutor: treasuryExecutorHash })
  });
}

export function treasuryRuntimeRecords(manifest) {
  const value = validateTreasuryManifest(manifest);
  return Object.freeze({
    vault: value.contracts.vault,
    gateway: value.contracts.proposalGateway,
    arbitration: value.contracts.arbitration,
    executor: value.contracts.treasuryExecutor,
    executorRuntimeCodeKeccak256: value.runtimeCodeHashes.treasuryExecutor
  });
}

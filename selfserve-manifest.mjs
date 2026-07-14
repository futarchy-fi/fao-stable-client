const CHAIN_ID = 11155111;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;
const ZERO_HASH = /^0x0{64}$/i;
const RECORD_KEYS = Object.freeze([
  'address',
  'source',
  'contract',
  'transaction',
  'creationCodeBytes',
  'creationCodeKeccak256',
  'runtimeCodeBytes',
  'runtimeCodeKeccak256'
]);
const TRANSACTION_KEYS = Object.freeze(['hash', 'block', 'nonce', 'from']);
const IDENTITIES = Object.freeze({
  registrar: ['src/FaoGenesisRegistrar.sol', 'FaoGenesisRegistrar'],
  proposalImplementation: ['src/FAOFutarchyProposal.sol', 'FAOFutarchyProposal'],
  stackDeployer: ['src/FAOSiteStackDeployer.sol', 'FAOSiteStackDeployer']
});

function invalid(reason) {
  throw new Error(`invalid self-serve deployment manifest: ${reason}`);
}

function exactKeys(value, expected, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') invalid(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some((key) => !actual.includes(key))) {
    invalid(`${label} must contain exactly: ${expected.join(', ')}`);
  }
}

function address(value, label) {
  if (typeof value !== 'string' || !ADDRESS.test(value) || ZERO_ADDRESS.test(value)) {
    invalid(`${label} must be a nonzero address`);
  }
  return value.toLowerCase();
}

function hash(value, label) {
  if (typeof value !== 'string' || !HASH.test(value) || ZERO_HASH.test(value)) {
    invalid(`${label} must be a nonzero 32-byte hash`);
  }
  return value.toLowerCase();
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a nonnegative safe integer`);
  return value;
}

function record(value, key) {
  exactKeys(value, RECORD_KEYS, key);
  const identity = IDENTITIES[key];
  if (value.source !== identity[0] || value.contract !== identity[1]) invalid(`${key} has the wrong compiler identity`);
  const normalizedAddress = address(value.address, `${key}.address`);
  exactKeys(value.transaction, TRANSACTION_KEYS, `${key}.transaction`);
  hash(value.transaction.hash, `${key}.transaction.hash`);
  integer(value.transaction.block, `${key}.transaction.block`);
  integer(value.transaction.nonce, `${key}.transaction.nonce`);
  address(value.transaction.from, `${key}.transaction.from`);
  if (integer(value.creationCodeBytes, `${key}.creationCodeBytes`) === 0) invalid(`${key} creation code cannot be empty`);
  if (integer(value.runtimeCodeBytes, `${key}.runtimeCodeBytes`) === 0) invalid(`${key} runtime code cannot be empty`);
  hash(value.creationCodeKeccak256, `${key}.creationCodeKeccak256`);
  hash(value.runtimeCodeKeccak256, `${key}.runtimeCodeKeccak256`);
  return normalizedAddress;
}

export function validateSelfServeManifest(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') invalid('expected an object');
  if (value.schemaVersion !== 1 || value.network !== 'sepolia' || value.chainId !== CHAIN_ID) {
    invalid('identity must be Sepolia schema version 1');
  }

  if (value.status === 'pre-deployment') {
    exactKeys(value, ['schemaVersion', 'status', 'network', 'chainId', 'registrar', 'prerequisites'], 'manifest');
    if (value.registrar !== null) invalid('pre-deployment registrar must be null');
    exactKeys(value.prerequisites, [], 'pre-deployment prerequisites');
    return Object.freeze({ ...value, explorer: 'https://sepolia.etherscan.io' });
  }

  exactKeys(value, ['schemaVersion', 'network', 'chainId', 'registrar', 'prerequisites'], 'manifest');
  const addresses = [record(value.registrar, 'registrar')];
  exactKeys(value.prerequisites, ['proposalImplementation', 'stackDeployer'], 'prerequisites');
  addresses.push(record(value.prerequisites.proposalImplementation, 'proposalImplementation'));
  addresses.push(record(value.prerequisites.stackDeployer, 'stackDeployer'));
  if (new Set(addresses).size !== addresses.length) invalid('shared deployment addresses must be unique');
  const transactions = [
    value.registrar.transaction.hash,
    value.prerequisites.proposalImplementation.transaction.hash,
    value.prerequisites.stackDeployer.transaction.hash
  ].map((item) => item.toLowerCase());
  if (new Set(transactions).size !== transactions.length) invalid('shared deployment transactions must be unique');
  return Object.freeze({ ...value, status: 'active', explorer: 'https://sepolia.etherscan.io' });
}

export function selfServeRuntimeRecords(manifest) {
  if (manifest.status === 'pre-deployment') return Object.freeze({});
  return Object.freeze({
    registrar: manifest.registrar,
    proposalImplementation: manifest.prerequisites.proposalImplementation,
    stackDeployer: manifest.prerequisites.stackDeployer
  });
}

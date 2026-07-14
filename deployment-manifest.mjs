export const REQUIRED_CONTRACTS = Object.freeze([
  'deploymentReceipt',
  'siteToken',
  'spotPool',
  'proposalImplementation',
  'stackDeployer',
  'space',
  'arbitration',
  'proposalGateway',
  'releaseStrategy',
  'votingStrategy',
  'evaluator',
  'orchestrator',
  'twapResolver',
  'futarchyFactory'
]);

const IDENTITY = Object.freeze({
  schemaVersion: 1,
  network: 'Sepolia',
  chainId: 11155111,
  explorer: 'https://sepolia.etherscan.io',
  governedSite: 'https://testnet.futarchy.ai',
  governedRepository: 'https://github.com/futarchy-fi/fao-governed-site'
});
const PRE_DEPLOYMENT_KEYS = Object.freeze([
  ...Object.keys(IDENTITY), 'status', 'contracts'
]);
const ACTIVE_KEYS = Object.freeze([
  ...PRE_DEPLOYMENT_KEYS, 'deploymentTransaction', 'deploymentBlock', 'currencyToken'
]);
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSACTION = /^0x[0-9a-fA-F]{64}$/;
const ZERO_ADDRESS = /^0x0{40}$/i;

function invalid(reason) {
  throw new Error(`invalid deployment manifest: ${reason}`);
}

function isNonzeroAddress(value) {
  return typeof value === 'string' && ADDRESS.test(value) && !ZERO_ADDRESS.test(value);
}

function exactKeys(value, expected) {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || expected.some((key) => !actual.includes(key))) {
    invalid(`top level must contain exactly: ${expected.join(', ')}`);
  }
}

export function validateDeploymentManifest(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') invalid('expected an object');

  for (const [key, expected] of Object.entries(IDENTITY)) {
    if (value[key] !== expected) invalid(`${key} must be ${expected}`);
  }
  if (!value.contracts || Array.isArray(value.contracts) || typeof value.contracts !== 'object') {
    invalid('contracts must be an object');
  }

  const contractKeys = Object.keys(value.contracts);
  if (value.status === 'pre-deployment') {
    exactKeys(value, PRE_DEPLOYMENT_KEYS);
    if (contractKeys.length !== 0) invalid('pre-deployment contracts must be empty');
    return value;
  }
  if (value.status !== 'active') invalid('status must be active or pre-deployment');
  exactKeys(value, ACTIVE_KEYS);
  if (!TRANSACTION.test(value.deploymentTransaction || '')) {
    invalid('deploymentTransaction must be a 32-byte hex value');
  }
  if (!Number.isSafeInteger(value.deploymentBlock) || value.deploymentBlock < 0) {
    invalid('deploymentBlock must be a nonnegative safe integer');
  }
  if (!isNonzeroAddress(value.currencyToken)) invalid('currencyToken must be a nonzero address');

  const missing = REQUIRED_CONTRACTS.filter((key) => !contractKeys.includes(key));
  const extra = contractKeys.filter((key) => !REQUIRED_CONTRACTS.includes(key));
  if (missing.length || extra.length) {
    invalid(`contracts must contain exactly: ${REQUIRED_CONTRACTS.join(', ')}`);
  }

  const seen = new Set();
  for (const key of REQUIRED_CONTRACTS) {
    const address = value.contracts[key];
    if (!isNonzeroAddress(address)) invalid(`contracts.${key} must be a nonzero address`);
    const normalized = address.toLowerCase();
    if (seen.has(normalized)) invalid(`contracts.${key} duplicates another contract address`);
    seen.add(normalized);
  }
  return value;
}

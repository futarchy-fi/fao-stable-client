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

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} must be a nonnegative safe integer`);
  return value;
}

function transaction(value, label) {
  exactKeys(value, ['hash', 'block', 'nonce', 'from'], label);
  return Object.freeze({
    hash: hash(value.hash, `${label}.hash`),
    block: integer(value.block, `${label}.block`),
    nonce: integer(value.nonce, `${label}.nonce`),
    from: address(value.from, `${label}.from`)
  });
}

function dependency(value, label) {
  exactKeys(value, ['target', 'runtimeCodeKeccak256'], label);
  return Object.freeze({
    target: address(value.target, `${label}.target`),
    runtimeCodeKeccak256: hash(value.runtimeCodeKeccak256, `${label}.runtimeCodeKeccak256`)
  });
}

// Full canonical/evidence validation stays in FAO's economic_deployment.py. This browser parser
// binds only the Lane-4 runtime records it subsequently verifies live.
export function validateTreasuryManifest(value) {
  exactKeys(value, OUTER_KEYS, 'manifest');
  if (value.schemaVersion !== 4 || value.network !== 'sepolia' || value.chainId !== 11155111) {
    invalid('identity must be Sepolia schema version 4');
  }
  if (!['create', 'registrar'].includes(value.creationRoute)) invalid('creationRoute is invalid');
  if (!['sealed', 'live'].includes(value.status)) invalid('status must be sealed or live');
  exactKeys(value.contracts, CONTRACT_KEYS, 'contracts');
  if (!Array.isArray(value.contracts.vestingWallets)) invalid('contracts.vestingWallets must be an array');
  const contracts = {};
  for (const key of CONTRACT_KEYS.slice(0, -1)) contracts[key] = address(value.contracts[key], `contracts.${key}`);
  const runtimeKeys = ['vault', 'proposalGateway', 'arbitration', 'treasuryExecutor'];
  exactKeys(value.runtimeCodeHashes, runtimeKeys, 'runtimeCodeHashes');
  if (Object.keys(value.runtimeCodeHashes).some((key, index) => key !== runtimeKeys[index])) {
    invalid('runtimeCodeHashes is not in canonical order');
  }
  const runtimeCodeHashes = Object.freeze(Object.fromEntries(runtimeKeys.map((key) => [
    key, hash(value.runtimeCodeHashes[key], `runtimeCodeHashes.${key}`)
  ])));
  let receipt = value.receipt;
  let transactions = value.transactions;
  if (value.creationRoute === 'registrar') {
    exactKeys(value.transactions, ['receiptCreate', 'deployCore', 'deployFlm'], 'transactions');
    transactions = Object.freeze({
      receiptCreate: transaction(value.transactions.receiptCreate, 'transactions.receiptCreate'),
      deployCore: transaction(value.transactions.deployCore, 'transactions.deployCore'),
      deployFlm: transaction(value.transactions.deployFlm, 'transactions.deployFlm')
    });
    const orderedTransactions = [
      transactions.receiptCreate, transactions.deployCore, transactions.deployFlm
    ];
    if (new Set(orderedTransactions.map(({ hash: transactionHash }) => transactionHash)).size !== 3
      || orderedTransactions.some((transaction_, index) => (
        index !== 0 && transaction_.block < orderedTransactions[index - 1].block
      ))) {
      invalid('registrar transactions must have unique hashes in block order');
    }
    exactKeys(value.receipt, [
      'address', 'source', 'contract', 'stageNonce', 'creationCodeBytes',
      'creationCodeKeccak256', 'coreConfigHash', 'flmConfigHash', 'registrar'
    ], 'receipt');
    if (value.receipt.source !== 'src/FaoGenesisDeployment.sol'
      || value.receipt.contract !== 'FaoGenesisDeployment') {
      invalid('receipt has the wrong compiler identity');
    }
    receipt = Object.freeze({
      ...value.receipt,
      address: address(value.receipt.address, 'receipt.address'),
      stageNonce: integer(value.receipt.stageNonce, 'receipt.stageNonce'),
      creationCodeBytes: integer(value.receipt.creationCodeBytes, 'receipt.creationCodeBytes'),
      creationCodeKeccak256: hash(value.receipt.creationCodeKeccak256, 'receipt.creationCodeKeccak256'),
      coreConfigHash: hash(value.receipt.coreConfigHash, 'receipt.coreConfigHash'),
      flmConfigHash: hash(value.receipt.flmConfigHash, 'receipt.flmConfigHash'),
      registrar: dependency(value.receipt.registrar, 'receipt.registrar')
    });
    if (receipt.stageNonce !== transactions.receiptCreate.nonce) {
      invalid('receipt stage nonce does not match its transaction');
    }
  }
  return Object.freeze({
    ...value,
    transactions,
    receipt,
    contracts: Object.freeze({ ...value.contracts, ...contracts }),
    runtimeCodeHashes
  });
}

export function treasuryRuntimeRecords(manifest) {
  const value = validateTreasuryManifest(manifest);
  return Object.freeze({
    vault: value.contracts.vault,
    gateway: value.contracts.proposalGateway,
    arbitration: value.contracts.arbitration,
    executor: value.contracts.treasuryExecutor,
    vaultRuntimeCodeKeccak256: value.runtimeCodeHashes.vault,
    gatewayRuntimeCodeKeccak256: value.runtimeCodeHashes.proposalGateway,
    arbitrationRuntimeCodeKeccak256: value.runtimeCodeHashes.arbitration,
    executorRuntimeCodeKeccak256: value.runtimeCodeHashes.treasuryExecutor
  });
}

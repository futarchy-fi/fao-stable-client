const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const SELECTORS = Object.freeze({
  stage: '0xd12d24e8',
  predict: '0x5421831b',
  deployCore: '0x67658a72',
  deployFlm: '0x88b5e784',
  claim: '0x1e83409a',
  refund: '0xfa89401a',
  ragequit: '0xb07bf2ad',
  depositToSpot: '0x062f6512',
  redeem: '0x5236be40',
  approve: '0x095ea7b3',
  seal: '0x3fb27b85',
  finalize: '0x4bb278f3',
  fail: '0xa9cc4718',
  startNextEvaluation: '0xd2b8360a',
  bootstrap: '0xfb969b0a'
});

export const CORE_CODE_KEYS = Object.freeze([
  'ARBITRATION',
  'VAULT',
  'RELEASE_STRATEGY',
  'ZERO_VOTING',
  'ECON_GATEWAY',
  'ECON_EVALUATOR'
]);
export const FLM_CODE_KEYS = Object.freeze(['RELAY', 'ADAPTER', 'GUARD', 'ROUTER', 'MANAGER']);

const CORE_DEPENDENCY_KEYS = Object.freeze([
  'proxyFactory',
  'spaceImplementation',
  'proposalValidationStrategy',
  'stackDeployer',
  'proposalImplementation',
  'weth',
  'conditionalTokens',
  'wrapped1155Factory',
  'uniswapV3Factory'
]);
const CORE_INTEGER_BITS = Object.freeze({
  graduationThreshold: 256,
  arbitrationTimeout: 256,
  siteMinActivationBond: 256,
  treasuryMinActivationBond: 256,
  twapTimeout: 32,
  twapWindow: 32,
  spaceSaltNonce: 256,
  saleEnd: 64,
  bootstrapDeadline: 64,
  saleCap: 256,
  minimumRaise: 256,
  tokenMaxSupply: 256,
  initialPrice: 256,
  slope: 256,
  bootstrapBps: 16
});
const CORE_STRING_KEYS = Object.freeze([
  'daoURI',
  'metadataURI',
  'votingStrategyMetadataURI',
  'proposalValidationStrategyMetadataURI',
  'tokenName',
  'tokenSymbol'
]);
const CORE_CONFIG_KEYS = Object.freeze([
  ...CORE_DEPENDENCY_KEYS,
  'graduationThreshold',
  'arbitrationTimeout',
  'siteMinActivationBond',
  'treasuryMinActivationBond',
  'twapTimeout',
  'twapWindow',
  'spaceSaltNonce',
  ...CORE_STRING_KEYS,
  'saleEnd',
  'bootstrapDeadline',
  'saleCap',
  'minimumRaise',
  'tokenMaxSupply',
  'initialPrice',
  'slope',
  'bootstrapBps'
]);
const GRANT_KEYS = Object.freeze(['beneficiary', 'start', 'duration', 'amount']);
const WAD = 10n ** 18n;
const UINT256_MAX = (1n << 256n) - 1n;
const KECCAK_MASK = (1n << 64n) - 1n;
const KECCAK_ROTATION = Object.freeze([
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14
]);
const KECCAK_ROUND_CONSTANTS = Object.freeze([
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an,
  0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an,
  0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n,
  0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n,
  0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n
]);

export function normalizeHex(value, bytes, label = 'hex value') {
  if (typeof value !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error(`${label} must be 0x-prefixed, even-length hex.`);
  }
  if (bytes !== undefined && value.length !== 2 + bytes * 2) {
    throw new Error(`${label} must be exactly ${bytes} bytes.`);
  }
  return value.toLowerCase();
}

export function normalizeAddress(value, { allowZero = false } = {}) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new Error('address must be a 20-byte 0x value.');
  }
  const body = value.slice(2);
  const lower = body.toLowerCase();
  const upper = body.toUpperCase();
  if (body !== lower && body !== upper) {
    const checksum = keccak256(lower).slice(2);
    for (let index = 0; index < body.length; index += 1) {
      if (!/[a-fA-F]/.test(body[index])) continue;
      const expectedUpper = Number.parseInt(checksum[index], 16) >= 8;
      if ((body[index] === body[index].toUpperCase()) !== expectedUpper) {
        throw new Error('address has an invalid EIP-55 checksum.');
      }
    }
  }
  const address = `0x${lower}`;
  if (!allowZero && address === ZERO_ADDRESS) throw new Error('zero address is not allowed.');
  return address;
}

function requireRecord(value, keys, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} must be an object.`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) {
    throw new Error(`${label} must contain exactly: ${keys.join(', ')}.`);
  }
  return value;
}

function normalizeString(value, label, { nonempty = false } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  const encoded = new TextEncoder().encode(value);
  if (new TextDecoder('utf-8', { fatal: true }).decode(encoded) !== value) {
    throw new Error(`${label} must be valid UTF-8.`);
  }
  if (nonempty && encoded.length === 0) throw new Error(`${label} cannot be empty.`);
  return value;
}

function normalizeDependency(value, label) {
  const dependency = requireRecord(value, ['target', 'codehash'], label);
  const codehash = normalizeHex(dependency.codehash, 32, `${label}.codehash`);
  if (codehash === `0x${'0'.repeat(64)}`) throw new Error(`${label}.codehash cannot be zero.`);
  return Object.freeze({
    target: normalizeAddress(dependency.target),
    codehash
  });
}

function keccakRotate(value, amount) {
  if (amount === 0) return value;
  const shift = BigInt(amount);
  return ((value << shift) | (value >> (64n - shift))) & KECCAK_MASK;
}

function keccakPermutation(state) {
  for (const roundConstant of KECCAK_ROUND_CONSTANTS) {
    const parity = Array(5);
    for (let x = 0; x < 5; x += 1) {
      parity[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const delta = parity[(x + 4) % 5] ^ keccakRotate(parity[(x + 1) % 5], 1);
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] ^= delta;
    }

    const lanes = Array(25);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        lanes[y + 5 * ((2 * x + 3 * y) % 5)] = keccakRotate(
          state[x + 5 * y], KECCAK_ROTATION[x + 5 * y]
        );
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (
          lanes[x + 5 * y]
          ^ ((~lanes[(x + 1) % 5 + 5 * y]) & lanes[(x + 2) % 5 + 5 * y])
        ) & KECCAK_MASK;
      }
    }
    state[0] ^= roundConstant;
  }
}

function bytes(value, label = 'bytes') {
  if (typeof value === 'string') {
    if (!value.startsWith('0x')) return new TextEncoder().encode(value);
    const hex = normalizeHex(value, undefined, label).slice(2);
    return Uint8Array.from({ length: hex.length / 2 }, (_, index) => (
      Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
    ));
  }
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error(`${label} must be hex, text, Uint8Array, or ArrayBuffer.`);
}

// Ethereum Keccak-256 (legacy 0x01 domain), not standardized SHA3-256.
export function keccak256(value) {
  const input = bytes(value, 'Keccak input');
  const rate = 136;
  const paddedLength = Math.ceil((input.length + 1) / rate) * rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x01;
  padded[padded.length - 1] |= 0x80;

  const state = Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let index = 0; index < rate; index += 1) {
      state[Math.floor(index / 8)] ^= BigInt(padded[offset + index]) << BigInt(8 * (index % 8));
    }
    keccakPermutation(state);
  }
  let digest = '0x';
  for (let index = 0; index < 32; index += 1) {
    digest += Number((state[Math.floor(index / 8)] >> BigInt(8 * (index % 8))) & 0xffn)
      .toString(16).padStart(2, '0');
  }
  return digest;
}

function unsigned(value, bits = 256, label = 'unsigned integer') {
  if (
    typeof value === 'number'
      ? !Number.isSafeInteger(value)
      : typeof value !== 'bigint'
        && (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*|0x[0-9a-fA-F]+)$/.test(value))
  ) throw new Error(`${label} is invalid.`);
  const number = BigInt(value);
  if (number < 0n || number >= (1n << BigInt(bits))) {
    throw new Error(`${label} must fit uint${bits}.`);
  }
  return number;
}

export function assertChainId(value, expected) {
  const chainId = unsigned(value, 256, 'chain id');
  if (chainId === 0n) throw new Error('chain id must be positive.');
  if (expected !== undefined && chainId !== unsigned(expected, 256, 'expected chain id')) {
    throw new Error(`wrong chain: expected ${BigInt(expected)}, received ${chainId}.`);
  }
  return chainId;
}

export function uintWord(value, bits = 256) {
  return unsigned(value, bits).toString(16).padStart(64, '0');
}

export function addressWord(value, options) {
  return normalizeAddress(value, options).slice(2).padStart(64, '0');
}

export function boolWord(value) {
  if (typeof value !== 'boolean') throw new Error('boolean value must be true or false.');
  return uintWord(value ? 1 : 0);
}

export function bytes32Word(value) {
  return normalizeHex(value, 32, 'bytes32').slice(2);
}

export function encodeBytes(value) {
  const hex = normalizeHex(value, undefined, 'bytes').slice(2);
  return uintWord(hex.length / 2) + hex.padEnd(Math.ceil(hex.length / 64) * 64, '0');
}

export function encodeString(value) {
  const hex = Array.from(
    new TextEncoder().encode(normalizeString(value, 'string value')),
    (byte) => byte.toString(16).padStart(2, '0')
  ).join('');
  return encodeBytes(`0x${hex}`);
}

export function encodeAddressArray(values) {
  if (!Array.isArray(values)) throw new Error('address array must be an array.');
  return uintWord(values.length) + values.map((value) => addressWord(value, { allowZero: true })).join('');
}

export function encodeTuple(fields) {
  if (!Array.isArray(fields)) throw new Error('ABI fields must be an array.');
  let tailBytes = 0;
  const tails = [];
  const head = fields.map((field) => {
    if (typeof field === 'string') {
      if (!/^[0-9a-f]{64}$/.test(field)) throw new Error('static ABI field must be one lowercase word.');
      return field;
    }
    if (!field || typeof field !== 'object' || typeof field.dynamic !== 'string'
      || !/^(?:[0-9a-f]{64})*$/.test(field.dynamic)) {
      throw new Error('dynamic ABI field must be whole lowercase words.');
    }
    const offset = fields.length * 32 + tailBytes;
    tailBytes += field.dynamic.length / 2;
    tails.push(field.dynamic);
    return uintWord(offset);
  });
  return head.join('') + tails.join('');
}

export function encodeCalldata(selector, fields = []) {
  return normalizeHex(selector, 4, 'selector') + encodeTuple(fields);
}

function encodeDynamicArguments(values) {
  let cursor = values.length * 32;
  const head = [];
  const tail = [];
  for (const value of values) {
    if (typeof value !== 'string' || !/^(?:[0-9a-f]{64})*$/.test(value)) {
      throw new Error('dynamic ABI value must be whole lowercase words.');
    }
    head.push(uintWord(cursor));
    tail.push(value);
    cursor += value.length / 2;
  }
  return head.join('') + tail.join('');
}

function encodeBytesArray(values) {
  const encoded = values.map((value, index) => (
    encodeBytes(normalizeHex(value, undefined, `code blob ${index}`))
  ));
  let cursor = values.length * 32;
  return uintWord(values.length) + encoded.map((value) => {
    const offset = uintWord(cursor);
    cursor += value.length / 2;
    return offset;
  }).join('') + encoded.join('');
}

function normalizeCodeArray(value, expected, label) {
  if (!Array.isArray(value) || value.length !== expected) {
    throw new Error(`${label} must contain exactly ${expected} blobs.`);
  }
  return Object.freeze(Array.from(value, (raw, index) => {
    const code = normalizeHex(raw, undefined, `${label}[${index}]`);
    const size = (code.length - 2) / 2;
    if (size === 0 || size > 49_152) {
      throw new Error(`${label}[${index}] must contain 1..49152 bytes.`);
    }
    return code;
  }));
}

function orderedCodes(value, keys, label) {
  const record = requireRecord(value, keys, label);
  return normalizeCodeArray(keys.map((key) => record[key]), keys.length, label);
}

export function normalizeCoreConfig(value) {
  const input = requireRecord(value, CORE_CONFIG_KEYS, 'CoreConfig');
  const normalized = {};
  for (const key of CORE_DEPENDENCY_KEYS) {
    normalized[key] = normalizeDependency(input[key], `CoreConfig.${key}`);
  }
  for (const key of [
    'graduationThreshold',
    'arbitrationTimeout',
    'siteMinActivationBond',
    'treasuryMinActivationBond',
    'twapTimeout',
    'twapWindow',
    'spaceSaltNonce'
  ]) normalized[key] = unsigned(input[key], CORE_INTEGER_BITS[key], `CoreConfig.${key}`);
  for (const key of CORE_STRING_KEYS) {
    normalized[key] = normalizeString(input[key], `CoreConfig.${key}`, {
      nonempty: key === 'tokenName' || key === 'tokenSymbol'
    });
  }
  for (const key of [
    'saleEnd',
    'bootstrapDeadline',
    'saleCap',
    'minimumRaise',
    'tokenMaxSupply',
    'initialPrice',
    'slope',
    'bootstrapBps'
  ]) normalized[key] = unsigned(input[key], CORE_INTEGER_BITS[key], `CoreConfig.${key}`);

  for (const key of CORE_STRING_KEYS.slice(0, 4)) {
    if (!/^ipfs:\/\/b[a-z2-7]{58}$/.test(normalized[key])) {
      throw new Error(`CoreConfig.${key} must be a 66-byte lowercase CIDv1 IPFS URI.`);
    }
  }
  for (const key of [
    'graduationThreshold',
    'arbitrationTimeout',
    'siteMinActivationBond',
    'treasuryMinActivationBond'
  ]) {
    if (normalized[key] === 0n) throw new Error(`CoreConfig.${key} must be positive.`);
  }
  if (normalized.twapWindow === 0n || normalized.twapWindow > normalized.twapTimeout) {
    throw new Error('CoreConfig.twapWindow must be positive and no greater than twapTimeout.');
  }
  if (normalized.bootstrapDeadline <= normalized.saleEnd) {
    throw new Error('CoreConfig.bootstrapDeadline must be after saleEnd.');
  }
  return Object.freeze(normalized);
}

export function normalizeGrants(value) {
  if (!Array.isArray(value)) throw new Error('GrantConfig[] must be an array.');
  if (value.length > 32) throw new Error('GrantConfig[] cannot contain more than 32 grants.');
  return Object.freeze(Array.from(value, (raw, index) => {
    const grant = requireRecord(raw, GRANT_KEYS, `GrantConfig[${index}]`);
    const normalized = {
      beneficiary: normalizeAddress(grant.beneficiary),
      start: unsigned(grant.start, 64, `GrantConfig[${index}].start`),
      duration: unsigned(grant.duration, 64, `GrantConfig[${index}].duration`),
      amount: unsigned(grant.amount, 256, `GrantConfig[${index}].amount`)
    };
    if (normalized.duration === 0n || normalized.amount === 0n) {
      throw new Error(`GrantConfig[${index}] duration and amount must be positive.`);
    }
    return Object.freeze(normalized);
  }));
}

export function normalizeFlmConfig(value) {
  const input = requireRecord(value, ['positionManager'], 'FlmConfig');
  return Object.freeze({
    positionManager: normalizeDependency(input.positionManager, 'FlmConfig.positionManager')
  });
}

function checkedUint256(value, label) {
  if (value > UINT256_MAX) throw new Error(`${label} exceeds uint256.`);
  return value;
}

function validateGenesis(core, grants, currentTimestamp) {
  if (currentTimestamp !== undefined) {
    const now = unsigned(currentTimestamp, 64, 'current timestamp');
    if (core.saleEnd <= now) throw new Error('CoreConfig.saleEnd must be in the future.');
  }
  if (
    core.saleCap === 0n || core.minimumRaise === 0n || core.tokenMaxSupply === 0n
    || core.initialPrice === 0n || core.bootstrapBps === 0n || core.bootstrapBps > 10_000n
  ) throw new Error('sale amounts, initialPrice, and bootstrapBps must be positive and bounded.');
  if ((core.minimumRaise * core.bootstrapBps) / 10_000n === 0n) {
    throw new Error('minimumRaise bootstrap allocation rounds to zero.');
  }

  const priceTerm = checkedUint256(2n * core.initialPrice * WAD, 'initial reserve term');
  const slopeTerm = checkedUint256(core.slope * core.saleCap, 'slope reserve term');
  const linearTerm = checkedUint256(priceTerm + slopeTerm, 'reserve linear term');
  const reserveNumerator = core.saleCap * linearTerm;
  const reserveDenominator = 2n * WAD * WAD;
  const terminalReserve = (reserveNumerator + reserveDenominator - 1n) / reserveDenominator;
  if (terminalReserve > UINT256_MAX || core.minimumRaise > terminalReserve) {
    throw new Error('minimumRaise exceeds the sale curve reserve.');
  }
  const terminalIncrease = (core.slope * core.saleCap) / WAD;
  if (terminalIncrease > UINT256_MAX || core.initialPrice > UINT256_MAX - terminalIncrease) {
    throw new Error('terminal price exceeds uint256.');
  }

  if (core.saleCap > (UINT256_MAX - WAD) / 2n) {
    throw new Error('saleCap is too large for genesis supply accounting.');
  }
  let maximumGenesisSupply = core.saleCap * 2n + WAD;
  for (const grant of grants) {
    maximumGenesisSupply = checkedUint256(
      maximumGenesisSupply + grant.amount, 'maximum genesis supply'
    );
  }
  if (core.tokenMaxSupply < maximumGenesisSupply) {
    throw new Error('tokenMaxSupply cannot cover sale, bootstrap seed, and grants.');
  }
}

function encodeNormalizedCoreConfig(core) {
  const fields = [];
  for (const key of CORE_DEPENDENCY_KEYS) {
    fields.push(addressWord(core[key].target), bytes32Word(core[key].codehash));
  }
  for (const key of [
    'graduationThreshold',
    'arbitrationTimeout',
    'siteMinActivationBond',
    'treasuryMinActivationBond',
    'twapTimeout',
    'twapWindow',
    'spaceSaltNonce'
  ]) fields.push(uintWord(core[key], CORE_INTEGER_BITS[key]));
  for (const key of CORE_STRING_KEYS) fields.push({ dynamic: encodeString(core[key]) });
  for (const key of [
    'saleEnd',
    'bootstrapDeadline',
    'saleCap',
    'minimumRaise',
    'tokenMaxSupply',
    'initialPrice',
    'slope',
    'bootstrapBps'
  ]) fields.push(uintWord(core[key], CORE_INTEGER_BITS[key]));
  return encodeTuple(fields);
}

function encodeNormalizedGrants(grants) {
  return uintWord(grants.length) + grants.map((grant) => (
    addressWord(grant.beneficiary)
    + uintWord(grant.start, 64)
    + uintWord(grant.duration, 64)
    + uintWord(grant.amount)
  )).join('');
}

function encodeNormalizedFlmConfig(flm) {
  return addressWord(flm.positionManager.target) + bytes32Word(flm.positionManager.codehash);
}

export function encodeCoreConfig(coreConfig) {
  return `0x${encodeDynamicArguments([encodeNormalizedCoreConfig(normalizeCoreConfig(coreConfig))])}`;
}

export function encodeGrantConfigs(grants) {
  return `0x${encodeDynamicArguments([encodeNormalizedGrants(normalizeGrants(grants))])}`;
}

export function encodeCoreCommitment(coreConfig, grants, currentTimestamp) {
  const core = normalizeCoreConfig(coreConfig);
  const normalizedGrants = normalizeGrants(grants);
  validateGenesis(core, normalizedGrants, currentTimestamp);
  return `0x${encodeDynamicArguments([
    encodeNormalizedCoreConfig(core), encodeNormalizedGrants(normalizedGrants)
  ])}`;
}

export function encodeFlmConfig(flmConfig) {
  return `0x${encodeNormalizedFlmConfig(normalizeFlmConfig(flmConfig))}`;
}

export function hashCoreConfig(coreConfig, grants, currentTimestamp) {
  return keccak256(encodeCoreCommitment(coreConfig, grants, currentTimestamp));
}

export function hashFlmConfig(flmConfig) {
  return keccak256(encodeFlmConfig(flmConfig));
}

export function deployCoreCalldata(coreConfig, grants, creationCodes, currentTimestamp) {
  const core = normalizeCoreConfig(coreConfig);
  const normalizedGrants = normalizeGrants(grants);
  validateGenesis(core, normalizedGrants, currentTimestamp);
  const codes = normalizeCodeArray(creationCodes, 6, 'core creation codes');
  return SELECTORS.deployCore + encodeDynamicArguments([
    encodeNormalizedCoreConfig(core),
    encodeNormalizedGrants(normalizedGrants),
    encodeBytesArray(codes)
  ]);
}

export function deployFlmCalldata(flmConfig, creationCodes) {
  const flm = normalizeFlmConfig(flmConfig);
  const codes = normalizeCodeArray(creationCodes, 5, 'FLM creation codes');
  const encodedFlm = encodeNormalizedFlmConfig(flm);
  return SELECTORS.deployFlm + encodedFlm + uintWord(encodedFlm.length / 2 + 32)
    + encodeBytesArray(codes);
}

function oneAddress(selector, account) {
  return encodeCalldata(selector, [addressWord(account)]);
}

export function stageCalldata(coreConfigHash, flmConfigHash, receiptBaseCode) {
  return encodeCalldata(SELECTORS.stage, [
    bytes32Word(coreConfigHash),
    bytes32Word(flmConfigHash),
    { dynamic: encodeBytes(receiptBaseCode) }
  ]);
}

export function predictCalldata(coreConfigHash, flmConfigHash, receiptBaseCode) {
  return encodeCalldata(SELECTORS.predict, [
    bytes32Word(coreConfigHash),
    bytes32Word(flmConfigHash),
    { dynamic: encodeBytes(receiptBaseCode) }
  ]);
}

function displayValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return Object.freeze(value.map(displayValue));
  if (value && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, displayValue(child)])
    ));
  }
  return value;
}

export function createPlan(value) {
  const input = requireRecord(value, [
    'registrar',
    'coreConfig',
    'grants',
    'flmConfig',
    'creationCodes',
    'currentTimestamp'
  ], 'FAO creation input');
  const registrar = normalizeAddress(input.registrar);
  const currentTimestamp = unsigned(input.currentTimestamp, 64, 'current timestamp');
  const core = normalizeCoreConfig(input.coreConfig);
  const grants = normalizeGrants(input.grants);
  const flm = normalizeFlmConfig(input.flmConfig);
  validateGenesis(core, grants, currentTimestamp);

  const bundle = requireRecord(input.creationCodes, ['receipt', 'core', 'flm'], 'creationCodes');
  const receiptBaseCode = normalizeHex(bundle.receipt, undefined, 'creationCodes.receipt');
  const receiptBytes = (receiptBaseCode.length - 2) / 2;
  if (receiptBytes === 0 || receiptBytes > 49_088) {
    throw new Error('creationCodes.receipt must contain 1..49088 bytes.');
  }
  const coreCodes = orderedCodes(bundle.core, CORE_CODE_KEYS, 'creationCodes.core');
  const flmCodes = orderedCodes(bundle.flm, FLM_CODE_KEYS, 'creationCodes.flm');
  const coreHash = keccak256(`0x${encodeDynamicArguments([
    encodeNormalizedCoreConfig(core), encodeNormalizedGrants(grants)
  ])}`);
  const flmHash = keccak256(`0x${encodeNormalizedFlmConfig(flm)}`);
  const deployCore = SELECTORS.deployCore + encodeDynamicArguments([
    encodeNormalizedCoreConfig(core),
    encodeNormalizedGrants(grants),
    encodeBytesArray(coreCodes)
  ]);
  const encodedFlm = encodeNormalizedFlmConfig(flm);
  const deployFlm = SELECTORS.deployFlm + encodedFlm + uintWord(encodedFlm.length / 2 + 32)
    + encodeBytesArray(flmCodes);

  return Object.freeze({
    displayed: displayValue({ registrar, currentTimestamp, coreConfig: core, grants, flmConfig: flm }),
    hashes: Object.freeze({ core: coreHash, flm: flmHash }),
    registrar: Object.freeze({
      target: registrar,
      stage: stageCalldata(coreHash, flmHash, receiptBaseCode),
      predict: predictCalldata(coreHash, flmHash, receiptBaseCode)
    }),
    receipt: Object.freeze({ deployCore, deployFlm })
  });
}

export const claimCalldata = (account) => oneAddress(SELECTORS.claim, account);
export const refundCalldata = (account) => oneAddress(SELECTORS.refund, account);

export function normalizeRagequitExtras(values) {
  if (!Array.isArray(values)) throw new Error('ragequit extras must be an array.');
  return [...new Set(values.map((value) => normalizeAddress(value, { allowZero: true })))].sort();
}

export function prepareRagequit(amount, recipient, extras = []) {
  const sortedExtras = normalizeRagequitExtras(extras);
  return Object.freeze({
    extras: Object.freeze(sortedExtras),
    calldata: encodeCalldata(SELECTORS.ragequit, [
      uintWord(amount),
      addressWord(recipient),
      { dynamic: encodeAddressArray(sortedExtras) }
    ])
  });
}

export const ragequitCalldata = (amount, recipient, extras = []) => (
  prepareRagequit(amount, recipient, extras).calldata
);

export function depositToSpotCalldata(companyAmount, collateralAmount) {
  return encodeCalldata(SELECTORS.depositToSpot, [uintWord(companyAmount), uintWord(collateralAmount)]);
}

export function redeemCalldata(shares, recipient, unwrapNative) {
  return encodeCalldata(SELECTORS.redeem, [
    uintWord(shares), addressWord(recipient), boolWord(unwrapNative)
  ]);
}

export function approveCalldata(spender, amount) {
  return encodeCalldata(SELECTORS.approve, [addressWord(spender), uintWord(amount)]);
}

export function lifecycleCalldata(action) {
  const selector = SELECTORS[action];
  if (!['seal', 'finalize', 'fail', 'startNextEvaluation', 'bootstrap'].includes(action)) {
    throw new Error(`unsupported no-argument lifecycle call: ${action}`);
  }
  return selector;
}

function asBytes(value) {
  if (typeof value === 'string') return new TextEncoder().encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new Error('CID input must be a string, Uint8Array, or ArrayBuffer.');
}

function base32(bytes) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

export async function cidv1RawSha256(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is unavailable.');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', asBytes(value)));
  return `b${base32(Uint8Array.from([1, 0x55, 0x12, 0x20, ...digest]))}`;
}

// Computes identity only. The exact raw bytes must still be pinned as a raw IPFS block.
export async function rawIpfsUri(value) {
  return `ipfs://${await cidv1RawSha256(value)}`;
}

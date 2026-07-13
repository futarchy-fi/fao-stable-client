const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const SELECTORS = Object.freeze({
  stage: '0xd12d24e8',
  predict: '0x5421831b',
  deployCore: '0xc9b544c1',
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
  bootstrap: '0xfb969b0a',
  proposeTransfer: '0xb03e8d3a',
  proposeParam: '0xc03dd3be',
  proposeCriticalRound: '0x395459cc',
  queueTreasuryTransfer: '0xad1d0ccb',
  executeTreasuryTransfer: '0xc28a1e7b',
  queueTreasuryParam: '0x10694f44',
  executeTreasuryParam: '0x165edcdb',
  stageCriticalAction: '0x96ff22f3',
  queueCriticalAction: '0x6ffabdf2',
  executeCriticalAction: '0x5400e73a',
  expireQueuedAction: '0xf0f9a6d7',
  buyback: '0xf8ec6911'
});

export const BUYBACK_SELECTORS = Object.freeze({
  weth: '0xad5c4648',
  phase: '0xb1c9fe6e',
  effectiveSupply: '0x8fc47093',
  window: '0xed1ecc63',
  dailyCap: '0x8e53aafa',
  dailyBps: '0x1d9ca3d6',
  navBps: '0x78f61c55',
  twapWindow: '0xb43c9fbf',
  maxTickDeviation: '0x031c7e38',
  windowStart: '0x58ea7322',
  wethSpent: '0x006ecaee',
  balanceOf: '0x70a08231'
});

export const BUYBACK_EVENT_TOPIC =
  '0x2dcc2439519c7d06fca9f8ae01e07f4f3c6ca21b5cdf8eff42cb75cf34d223c9';
export const BUYBACK_CHAIN_ID = 11155111n;
export const BUYBACK_INTENT =
  'Calling buyback controls timing only. The contract fixes the amount, recipient, TWAP, guard, price clamp, and literal burn. Accepted queued WETH payments are not reserved against buyback.';
export const BUYBACK_MARKET_CHECKS = Object.freeze([
  'The canonical guard must accept the pool and its current stability.',
  'The 30-minute TWAP must be strictly below 95% of WETH-only NAV.',
  'The spot price must leave room to trade inside the mean ± 50-tick clamp, and the swap must fill.'
]);

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
  'assetPolicies',
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
const ASSET_POLICY_KEYS = Object.freeze(['asset', 'c1', 'c2', 'tapBudget', 'tapBudgetMax']);
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

export const TREASURY_KINDS = Object.freeze({
  transfer: keccak256('FAO_ECON_TREASURY_TRANSFER_V1'),
  param: keccak256('FAO_ECON_TREASURY_PARAM_V1'),
  critical: keccak256('FAO_ECON_TREASURY_CRITICAL_V2')
});

export const AGENT_WORK_KINDS = Object.freeze({
  task: keccak256('FAO_AGENT_TASK_V1'),
  receipt: keccak256('FAO_AGENT_RECEIPT_V1'),
  payment: keccak256('FAO_AGENT_PAYMENT_V1')
});

export const AGENT_WORK_INDEX = Object.freeze({
  publishSelector: '0x52bf8ff2',
  publishedTopic: keccak256('Published(bytes32,bytes32,bytes32,address,bytes)')
});

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
  normalized.assetPolicies = normalizeAssetPolicies(input.assetPolicies);
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

export function normalizeAssetPolicies(value) {
  if (!Array.isArray(value)) throw new Error('AssetPolicyConfig[] must be an array.');
  if (value.length > 8) throw new Error('AssetPolicyConfig[] cannot contain more than 8 policies.');
  const assets = new Set();
  return Object.freeze(Array.from(value, (raw, index) => {
    const policy = requireRecord(raw, ASSET_POLICY_KEYS, `AssetPolicyConfig[${index}]`);
    const normalized = Object.freeze({
      asset: normalizeAddress(policy.asset, { allowZero: true }),
      c1: unsigned(policy.c1, 128, `AssetPolicyConfig[${index}].c1`),
      c2: unsigned(policy.c2, 128, `AssetPolicyConfig[${index}].c2`),
      tapBudget: unsigned(policy.tapBudget, 128, `AssetPolicyConfig[${index}].tapBudget`),
      tapBudgetMax: unsigned(policy.tapBudgetMax, 128, `AssetPolicyConfig[${index}].tapBudgetMax`)
    });
    if (assets.has(normalized.asset)) throw new Error('AssetPolicyConfig assets must be unique.');
    assets.add(normalized.asset);
    if (normalized.c1 > normalized.c2) throw new Error(`AssetPolicyConfig[${index}] requires c1 <= c2.`);
    if (normalized.tapBudget > normalized.tapBudgetMax) {
      throw new Error(`AssetPolicyConfig[${index}] requires tapBudget <= tapBudgetMax.`);
    }
    return normalized;
  }));
}

export async function verifyAssetPolicyContracts(coreConfig, request) {
  if (typeof request !== 'function') throw new Error('An RPC request function is required.');
  const policies = normalizeCoreConfig(coreConfig).assetPolicies;
  const checked = [];
  for (const policy of policies) {
    if (policy.asset === ZERO_ADDRESS) continue;
    const code = normalizeHex(
      await request('eth_getCode', [policy.asset, 'latest']), undefined,
      `Asset policy ${policy.asset} runtime code`
    );
    if (code === '0x') throw new Error(`Asset policy ${policy.asset} is not a contract.`);
    checked.push(policy.asset);
  }
  return Object.freeze(checked);
}

export function normalizeGrants(value) {
  if (!Array.isArray(value)) throw new Error('GrantConfig[] must be an array.');
  if (value.length > 16) throw new Error('GrantConfig[] cannot contain more than 16 grants.');
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
    'treasuryMinActivationBond'
  ]) fields.push(uintWord(core[key], CORE_INTEGER_BITS[key]));
  fields.push({ dynamic: encodeNormalizedAssetPolicies(core.assetPolicies) });
  for (const key of [
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

function encodeNormalizedAssetPolicies(policies) {
  return uintWord(policies.length) + policies.map((policy) => (
    addressWord(policy.asset, { allowZero: true })
    + uintWord(policy.c1, 128)
    + uintWord(policy.c2, 128)
    + uintWord(policy.tapBudget, 128)
    + uintWord(policy.tapBudgetMax, 128)
  )).join('');
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

function normalizeSalt(value, label) {
  return normalizeHex(value, 32, `${label}.salt`);
}

export function normalizeTransferAction(value) {
  const action = requireRecord(value, ['asset', 'recipient', 'amount', 'salt'], 'TransferAction');
  const amount = unsigned(action.amount, 256, 'TransferAction.amount');
  if (amount === 0n) throw new Error('TransferAction.amount must be positive.');
  return Object.freeze({
    asset: normalizeAddress(action.asset, { allowZero: true }),
    recipient: normalizeAddress(action.recipient),
    amount,
    salt: normalizeSalt(action.salt, 'TransferAction')
  });
}

export function normalizeParamAction(value) {
  const action = requireRecord(value, ['key', 'asset', 'value', 'salt'], 'ParamAction');
  const key = normalizeHex(action.key, 32, 'ParamAction.key');
  if (key === `0x${'0'.repeat(64)}`) throw new Error('ParamAction.key cannot be zero.');
  return Object.freeze({
    key,
    asset: normalizeAddress(action.asset, { allowZero: true }),
    value: unsigned(action.value, 128, 'ParamAction.value'),
    salt: normalizeSalt(action.salt, 'ParamAction')
  });
}

export function normalizeCriticalAction(value) {
  const action = requireRecord(value, ['target', 'value', 'data', 'salt'], 'CriticalAction');
  return Object.freeze({
    target: normalizeAddress(action.target),
    value: unsigned(action.value, 256, 'CriticalAction.value'),
    data: normalizeHex(action.data, undefined, 'CriticalAction.data'),
    salt: normalizeSalt(action.salt, 'CriticalAction')
  });
}

function treasuryDomain(chainId, vault) {
  return [uintWord(assertChainId(chainId)), addressWord(vault)];
}

export function transferEvaluationPayload(chainId, vault, value) {
  const action = normalizeTransferAction(value);
  return `0x${[
    bytes32Word(TREASURY_KINDS.transfer),
    ...treasuryDomain(chainId, vault),
    addressWord(action.asset, { allowZero: true }),
    addressWord(action.recipient),
    uintWord(action.amount),
    bytes32Word(action.salt)
  ].join('')}`;
}

export function transferActionHash(chainId, vault, action) {
  return keccak256(transferEvaluationPayload(chainId, vault, action));
}

export function paramEvaluationPayload(chainId, vault, value) {
  const action = normalizeParamAction(value);
  return `0x${[
    bytes32Word(TREASURY_KINDS.param),
    ...treasuryDomain(chainId, vault),
    bytes32Word(action.key),
    addressWord(action.asset, { allowZero: true }),
    uintWord(action.value),
    bytes32Word(action.salt)
  ].join('')}`;
}

export function paramActionHash(chainId, vault, action) {
  return keccak256(paramEvaluationPayload(chainId, vault, action));
}

export function criticalBasePayload(chainId, vault, value) {
  const action = normalizeCriticalAction(value);
  return `0x${[
    bytes32Word(TREASURY_KINDS.critical),
    ...treasuryDomain(chainId, vault),
    addressWord(action.target),
    uintWord(action.value),
    bytes32Word(keccak256(action.data)),
    bytes32Word(action.salt)
  ].join('')}`;
}

export function criticalBaseHash(chainId, vault, action) {
  return keccak256(criticalBasePayload(chainId, vault, action));
}

export function criticalEvaluationPayload(chainId, vault, value, round) {
  const normalizedRound = unsigned(round, 256, 'critical round');
  if (normalizedRound !== 1n && normalizedRound !== 2n) {
    throw new Error('critical round must be 1 or 2.');
  }
  return `${criticalBasePayload(chainId, vault, value)}${uintWord(normalizedRound)}`;
}

export function criticalActionHash(chainId, vault, action, round) {
  return keccak256(criticalEvaluationPayload(chainId, vault, action, round));
}

function transferTuple(value) {
  const action = normalizeTransferAction(value);
  return [
    addressWord(action.asset, { allowZero: true }), addressWord(action.recipient),
    uintWord(action.amount), bytes32Word(action.salt)
  ];
}

function paramTuple(value) {
  const action = normalizeParamAction(value);
  return [
    bytes32Word(action.key), addressWord(action.asset, { allowZero: true }),
    uintWord(action.value), bytes32Word(action.salt)
  ];
}

function criticalTuple(value) {
  const action = normalizeCriticalAction(value);
  return encodeTuple([
    addressWord(action.target), uintWord(action.value),
    { dynamic: encodeBytes(action.data) }, bytes32Word(action.salt)
  ]);
}

export const proposeTransferCalldata = (action) => (
  encodeCalldata(SELECTORS.proposeTransfer, transferTuple(action))
);
export const proposeParamCalldata = (action) => (
  encodeCalldata(SELECTORS.proposeParam, paramTuple(action))
);
export function proposeCriticalRoundCalldata(action, round) {
  const normalizedRound = unsigned(round, 256, 'critical round');
  if (normalizedRound !== 1n && normalizedRound !== 2n) {
    throw new Error('critical round must be 1 or 2.');
  }
  return encodeCalldata(SELECTORS.proposeCriticalRound, [
    { dynamic: criticalTuple(action) }, uintWord(normalizedRound)
  ]);
}

export const queueTreasuryTransferCalldata = (action) => (
  encodeCalldata(SELECTORS.queueTreasuryTransfer, transferTuple(action))
);
export const executeTreasuryTransferCalldata = (action) => (
  encodeCalldata(SELECTORS.executeTreasuryTransfer, transferTuple(action))
);
export const queueTreasuryParamCalldata = (action) => (
  encodeCalldata(SELECTORS.queueTreasuryParam, paramTuple(action))
);
export const executeTreasuryParamCalldata = (action) => (
  encodeCalldata(SELECTORS.executeTreasuryParam, paramTuple(action))
);
export const stageCriticalActionCalldata = (action) => (
  encodeCalldata(SELECTORS.stageCriticalAction, [{ dynamic: criticalTuple(action) }])
);
export const queueCriticalActionCalldata = (action) => (
  encodeCalldata(SELECTORS.queueCriticalAction, [{ dynamic: criticalTuple(action) }])
);
export const executeCriticalActionCalldata = (action) => (
  encodeCalldata(SELECTORS.executeCriticalAction, [{ dynamic: criticalTuple(action) }])
);
export const expireQueuedActionCalldata = (actionHash) => (
  encodeCalldata(SELECTORS.expireQueuedAction, [bytes32Word(actionHash)])
);

export const buybackCalldata = () => SELECTORS.buyback;

export function prepareBuyback(value) {
  const input = requireRecord(value, ['chainId', 'vault'], 'Buyback plan input');
  const chainId = assertChainId(input.chainId, BUYBACK_CHAIN_ID);
  return Object.freeze({
    chainId,
    target: normalizeAddress(input.vault),
    data: buybackCalldata(),
    label: 'Permissionless fixed-policy buyback',
    intent: BUYBACK_INTENT
  });
}

export function deriveBuybackModel(value) {
  const input = requireRecord(value, [
    'timestamp', 'phase', 'executorWeth', 'effectiveSupply', 'buybackWindowStart',
    'buybackWethSpent', 'buybackWindow', 'buybackDailyCap', 'buybackDailyBps',
    'buybackNavBps', 'buybackTwapWindow', 'buybackMaxTickDeviation'
  ], 'Buyback state');
  const timestamp = unsigned(input.timestamp, 64, 'Buyback timestamp');
  const phase = unsigned(input.phase, 8, 'Buyback phase');
  const executorWeth = unsigned(input.executorWeth, 256, 'Buyback executor WETH');
  const effectiveSupply = unsigned(input.effectiveSupply, 256, 'Buyback effective supply');
  const storedWindowStart = unsigned(input.buybackWindowStart, 64, 'Buyback window start');
  const storedWethSpent = unsigned(input.buybackWethSpent, 192, 'Buyback WETH spent');
  const window = unsigned(input.buybackWindow, 256, 'Buyback window');
  const rawCap = unsigned(input.buybackDailyCap, 256, 'Buyback daily cap');
  const dailyBps = unsigned(input.buybackDailyBps, 256, 'Buyback daily BPS');
  const navBps = unsigned(input.buybackNavBps, 256, 'Buyback NAV BPS');
  const twapWindow = unsigned(input.buybackTwapWindow, 32, 'Buyback TWAP window');
  const maxTickDeviation = unsigned(
    input.buybackMaxTickDeviation, 23, 'Buyback maximum tick deviation'
  );
  if (window === 0n || rawCap === 0n || twapWindow === 0n) {
    throw new Error('Buyback windows and raw cap must be positive.');
  }
  if (dailyBps > 10_000n || navBps > 10_000n) {
    throw new Error('Buyback basis points cannot exceed 10000.');
  }

  const windowActive = storedWindowStart !== 0n && timestamp < storedWindowStart + window;
  const actualSpent = windowActive ? storedWethSpent : 0n;
  const percentCap = executorWeth * dailyBps / 10_000n;
  const liveCap = rawCap < percentCap ? rawCap : percentCap;
  const available = liveCap > actualSpent ? liveCap - actualSpent : 0n;
  const navWethPerTokenWad = effectiveSupply === 0n
    ? null
    : executorWeth * WAD / effectiveSupply;
  const triggerWethPerTokenWad = navWethPerTokenWad == null
    ? null
    : navWethPerTokenWad * navBps / 10_000n;
  const reasons = [];
  if (phase !== 2n) reasons.push('The FAO is not LIVE.');
  if (effectiveSupply === 0n) reasons.push('Effective supply is zero.');
  if (executorWeth === 0n) reasons.push('Executor WETH is zero.');
  if (executorWeth !== 0n && available === 0n) {
    reasons.push('The current anchored-window allowance is exhausted.');
  }

  return Object.freeze({
    timestamp,
    phase,
    isLive: phase === 2n,
    executorWeth,
    effectiveSupply,
    navWethPerTokenWad,
    triggerWethPerTokenWad,
    window,
    windowActive,
    windowStart: windowActive ? storedWindowStart : null,
    windowEndsAt: windowActive ? storedWindowStart + window : null,
    actualSpent,
    rawCap,
    percentCap,
    liveCap,
    available,
    dailyBps,
    navBps,
    twapWindow,
    maxTickDeviation,
    canSubmit: reasons.length === 0,
    deterministicReasons: Object.freeze(reasons),
    marketChecks: BUYBACK_MARKET_CHECKS,
    intent: BUYBACK_INTENT
  });
}

export function decodeBuybackLog(log, expectedVault) {
  if (!log || Array.isArray(log) || typeof log !== 'object') {
    throw new Error('Buyback log must be an object.');
  }
  const vault = normalizeAddress(log.address);
  if (expectedVault !== undefined && vault !== normalizeAddress(expectedVault)) {
    throw new Error('Buyback log address does not match the verified vault.');
  }
  if (!Array.isArray(log.topics) || log.topics.length !== 2) {
    throw new Error('Buyback log must contain exactly two topics.');
  }
  if (normalizeHex(log.topics[0], 32, 'Buyback event topic') !== BUYBACK_EVENT_TOPIC) {
    throw new Error('Buyback log has the wrong event topic.');
  }
  const callerWord = normalizeHex(log.topics[1], 32, 'Buyback caller topic');
  if (callerWord.slice(2, 26) !== '0'.repeat(24)) {
    throw new Error('Buyback caller topic is not an ABI address.');
  }
  const data = normalizeHex(log.data, 64, 'Buyback event data').slice(2);
  return Object.freeze({
    vault,
    caller: normalizeAddress(`0x${callerWord.slice(-40)}`),
    wethSpent: BigInt(`0x${data.slice(0, 64)}`),
    companyBurned: BigInt(`0x${data.slice(64)}`),
    transactionHash: log.transactionHash == null
      ? null
      : normalizeHex(log.transactionHash, 32, 'Buyback transaction hash')
  });
}

export function decodeBuybackHistory(logs, expectedVault) {
  if (!Array.isArray(logs)) throw new Error('Buyback history must be an array of logs.');
  return Object.freeze(logs.map((log) => decodeBuybackLog(log, expectedVault)));
}

function transaction(target, data, label) {
  return Object.freeze({ target: normalizeAddress(target), data, label });
}

export function prepareTreasuryFlow(value) {
  const input = requireRecord(
    value, ['chainId', 'vault', 'gateway', 'executor', 'type', 'route', 'action'],
    'Treasury flow input'
  );
  const chainId = assertChainId(input.chainId);
  const vault = normalizeAddress(input.vault);
  const gateway = normalizeAddress(input.gateway);
  const executor = normalizeAddress(input.executor);
  if (input.type === 'transfer') {
    if (input.route !== 'timeout' && input.route !== 'evaluated') {
      throw new Error('Transfer route must be timeout or evaluated.');
    }
    const action = normalizeTransferAction(input.action);
    const actionHash = transferActionHash(chainId, vault, action);
    return Object.freeze({
      type: input.type, route: input.route, actionHash, proposalId: BigInt(actionHash).toString(),
      custody: executor,
      acceptance: 'Queue uses arbitration lastStateChangeAt; execution re-checks accepted state and the live asset policy.',
      steps: Object.freeze([
        transaction(gateway, proposeTransferCalldata(action), 'Propose transfer'),
        transaction(vault, queueTreasuryTransferCalldata(action), 'Queue after acceptance'),
        transaction(vault, executeTreasuryTransferCalldata(action), 'Execute during the acceptance-derived window')
      ])
    });
  }
  if (input.type === 'param') {
    if (input.route !== 'evaluated') throw new Error('Parameter actions require the evaluated route.');
    const action = normalizeParamAction(input.action);
    const actionHash = paramActionHash(chainId, vault, action);
    return Object.freeze({
      type: input.type, route: input.route, actionHash, proposalId: BigInt(actionHash).toString(),
      custody: executor,
      acceptance: 'Evaluated YES is required; queue timing derives from arbitration lastStateChangeAt.',
      steps: Object.freeze([
        transaction(gateway, proposeParamCalldata(action), 'Propose bounded tap-budget update'),
        transaction(vault, queueTreasuryParamCalldata(action), 'Queue after evaluated YES'),
        transaction(vault, executeTreasuryParamCalldata(action), 'Execute during the acceptance-derived window')
      ])
    });
  }
  if (input.type === 'critical') {
    if (input.route !== 'evaluated') throw new Error('Critical actions require the evaluated route.');
    const action = normalizeCriticalAction(input.action);
    const baseHash = criticalBaseHash(chainId, vault, action);
    return Object.freeze({
      type: input.type, route: input.route, actionHash: baseHash,
      proposalIds: Object.freeze([
        BigInt(criticalActionHash(chainId, vault, action, 1)).toString(),
        BigInt(criticalActionHash(chainId, vault, action, 2)).toString()
      ]),
      custody: executor,
      acceptance: 'Both rounds require evaluated YES; round 2 opens 30 days after staging and closes after 90 days.',
      steps: Object.freeze([
        transaction(gateway, proposeCriticalRoundCalldata(action, 1), 'Propose critical round 1'),
        transaction(vault, stageCriticalActionCalldata(action), 'Stage after round-1 evaluated YES'),
        transaction(gateway, proposeCriticalRoundCalldata(action, 2), 'After 30 days, propose round 2'),
        transaction(vault, queueCriticalActionCalldata(action), 'Queue after round-2 evaluated YES'),
        transaction(vault, executeCriticalActionCalldata(action), 'After 7-day grace, execute within 7 days')
      ])
    });
  }
  throw new Error('Treasury flow type must be transfer, param, or critical.');
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

function codePointCompare(left, right) {
  const a = Array.from(left, (character) => character.codePointAt(0));
  const b = Array.from(right, (character) => character.codePointAt(0));
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}

function escapeAgentString(value) {
  let output = '"';
  for (const character of value) {
    const codepoint = character.codePointAt(0);
    if (codepoint >= 0xd800 && codepoint <= 0xdfff) {
      throw new Error('agent document must not contain unpaired Unicode surrogates.');
    }
    if (character === '"') output += '\\"';
    else if (character === '\\') output += '\\\\';
    else if (codepoint < 0x20) output += `\\u${codepoint.toString(16).padStart(4, '0')}`;
    else output += character;
  }
  return `${output}"`;
}

function canonicalAgentText(value) {
  if (typeof value === 'string') return escapeAgentString(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAgentText).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort(codePointCompare).map((key) => (
      `${escapeAgentString(key)}:${canonicalAgentText(value[key])}`
    )).join(',')}}`;
  }
  throw new Error('every agent-document scalar leaf must be a JSON string.');
}

export function canonicalAgentDocument(value) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('agent document must be a top-level object.');
  }
  return new TextEncoder().encode(canonicalAgentText(value));
}

function equalBytes(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function agentBytes(value, label = 'agent document') {
  try {
    return bytes(value, label);
  } catch (error) {
    throw new Error(`${label} must be UTF-8 text, bytes, or even-length 0x hex.`, { cause: error });
  }
}

export function parseCanonicalAgentDocument(value) {
  const raw = agentBytes(value);
  let document;
  try {
    document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
  } catch (error) {
    throw new Error('agent document is not valid UTF-8 JSON.', { cause: error });
  }
  if (!document || Array.isArray(document) || typeof document !== 'object'
    || !equalBytes(canonicalAgentDocument(document), raw)) {
    throw new Error('agent document bytes are not canonical.');
  }
  return document;
}

export const agentDocumentDigest = (value) => keccak256(agentBytes(value));

function agentInput(value) {
  return typeof value === 'string' || value instanceof Uint8Array || value instanceof ArrayBuffer
    ? parseCanonicalAgentDocument(value)
    : value;
}

function agentRecord(value, required, optional, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    throw new Error(`${label} must be an object.`);
  }
  const keys = Object.keys(value);
  if (required.some((key) => !keys.includes(key))
    || keys.some((key) => !required.includes(key) && !optional.includes(key))) {
    throw new Error(`${label} has invalid fields.`);
  }
  return value;
}

function agentText(value, label, { nonempty = false, maxBytes } = {}) {
  if (typeof value !== 'string') throw new Error(`${label} must be a string.`);
  for (const character of value) {
    const codepoint = character.codePointAt(0);
    if (codepoint >= 0xd800 && codepoint <= 0xdfff) {
      throw new Error(`${label} must not contain unpaired Unicode surrogates.`);
    }
  }
  const size = new TextEncoder().encode(value).length;
  if (nonempty && size === 0) throw new Error(`${label} cannot be empty.`);
  if (maxBytes !== undefined && size > maxBytes) {
    throw new Error(`${label} exceeds ${maxBytes} UTF-8 bytes.`);
  }
  return value;
}

function agentDecimal(value, label, { positive = false } = {}) {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be an unsigned canonical decimal string.`);
  }
  const number = BigInt(value);
  if (number > UINT256_MAX || (positive && number === 0n)) {
    throw new Error(`${label} must fit uint256${positive ? ' and be positive' : ''}.`);
  }
  return value;
}

function agentDigest(value, label) {
  return normalizeHex(value, 32, label);
}

function finishAgentValidation(original, normalized) {
  if ((typeof original === 'string' || original instanceof Uint8Array || original instanceof ArrayBuffer)
    && !equalBytes(canonicalAgentDocument(normalized), agentBytes(original))) {
    throw new Error('agent document values are not in canonical schema form.');
  }
  return Object.freeze(normalized);
}

export function validateAgentTask(value) {
  const raw = agentRecord(
    agentInput(value),
    ['v', 'kind', 'chainId', 'vault', 'title', 'salt'],
    ['spec', 'specDigest', 'specUri', 'deadline', 'reward'],
    'agent task'
  );
  const inline = Object.hasOwn(raw, 'spec');
  const external = Object.hasOwn(raw, 'specDigest') || Object.hasOwn(raw, 'specUri');
  if (inline === external || (external && !(Object.hasOwn(raw, 'specDigest') && Object.hasOwn(raw, 'specUri')))) {
    throw new Error('agent task requires exactly spec or specDigest plus specUri.');
  }
  if (raw.v !== '1' || raw.kind !== 'fao.task') throw new Error('agent task version or kind is invalid.');
  const task = {
    v: '1',
    kind: 'fao.task',
    chainId: agentDecimal(raw.chainId, 'agent task.chainId', { positive: true }),
    vault: normalizeAddress(raw.vault),
    title: agentText(raw.title, 'agent task.title', { nonempty: true }),
    salt: agentDigest(raw.salt, 'agent task.salt')
  };
  if (inline) task.spec = agentText(raw.spec, 'agent task.spec', { nonempty: true });
  else {
    task.specDigest = agentDigest(raw.specDigest, 'agent task.specDigest');
    task.specUri = agentText(raw.specUri, 'agent task.specUri', { nonempty: true, maxBytes: 256 });
  }
  if (Object.hasOwn(raw, 'deadline')) task.deadline = agentDecimal(raw.deadline, 'agent task.deadline');
  if (Object.hasOwn(raw, 'reward')) {
    const reward = agentRecord(raw.reward, ['asset', 'amount'], [], 'agent task.reward');
    task.reward = Object.freeze({
      asset: normalizeAddress(reward.asset, { allowZero: true }),
      amount: agentDecimal(reward.amount, 'agent task.reward.amount', { positive: true })
    });
  }
  return finishAgentValidation(value, task);
}

export function validateAgentReceipt(value) {
  const raw = agentRecord(
    agentInput(value),
    ['v', 'kind', 'chainId', 'vault', 'task', 'worker', 'artifacts', 'summary', 'salt'],
    [],
    'agent receipt'
  );
  if (raw.v !== '1' || raw.kind !== 'fao.receipt') {
    throw new Error('agent receipt version or kind is invalid.');
  }
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) {
    throw new Error('agent receipt.artifacts must be a nonempty array.');
  }
  const artifacts = Object.freeze(raw.artifacts.map((value_, index) => {
    const artifact = agentRecord(
      value_, ['digest', 'uri'], ['note'], `agent receipt.artifacts[${index}]`
    );
    const normalized = {
      digest: agentDigest(artifact.digest, `agent receipt.artifacts[${index}].digest`),
      uri: agentText(artifact.uri, `agent receipt.artifacts[${index}].uri`, {
        nonempty: true, maxBytes: 256
      })
    };
    if (Object.hasOwn(artifact, 'note')) {
      normalized.note = agentText(artifact.note, `agent receipt.artifacts[${index}].note`);
    }
    return Object.freeze(normalized);
  }));
  return finishAgentValidation(value, {
    v: '1',
    kind: 'fao.receipt',
    chainId: agentDecimal(raw.chainId, 'agent receipt.chainId', { positive: true }),
    vault: normalizeAddress(raw.vault),
    task: agentDigest(raw.task, 'agent receipt.task'),
    worker: normalizeAddress(raw.worker),
    artifacts,
    summary: agentText(raw.summary, 'agent receipt.summary', { nonempty: true }),
    salt: agentDigest(raw.salt, 'agent receipt.salt')
  });
}

export function validateAgentPayment(value) {
  const raw = agentRecord(
    agentInput(value),
    ['v', 'kind', 'chainId', 'vault', 'asset', 'recipient', 'amount', 'task', 'receipt', 'salt'],
    ['note'],
    'agent payment'
  );
  if (raw.v !== '1' || raw.kind !== 'fao.payment') {
    throw new Error('agent payment version or kind is invalid.');
  }
  const payment = {
    v: '1',
    kind: 'fao.payment',
    chainId: agentDecimal(raw.chainId, 'agent payment.chainId', { positive: true }),
    vault: normalizeAddress(raw.vault),
    asset: normalizeAddress(raw.asset, { allowZero: true }),
    recipient: normalizeAddress(raw.recipient),
    amount: agentDecimal(raw.amount, 'agent payment.amount', { positive: true }),
    task: agentDigest(raw.task, 'agent payment.task'),
    receipt: agentDigest(raw.receipt, 'agent payment.receipt'),
    salt: agentDigest(raw.salt, 'agent payment.salt')
  };
  if (Object.hasOwn(raw, 'note')) payment.note = agentText(raw.note, 'agent payment.note');
  return finishAgentValidation(value, payment);
}

export const buildAgentTask = (value) => canonicalAgentDocument(validateAgentTask(value));
export const buildAgentReceipt = (value) => canonicalAgentDocument(validateAgentReceipt(value));
export const buildAgentPayment = (value) => canonicalAgentDocument(validateAgentPayment(value));

export function agentPaymentTransferAction(value) {
  const payment = validateAgentPayment(value);
  return Object.freeze({
    asset: payment.asset,
    recipient: payment.recipient,
    amount: BigInt(payment.amount),
    salt: agentDocumentDigest(buildAgentPayment(payment))
  });
}

export function validateAgentPaymentBinding(value, { chainId, vault, action }) {
  const payment = validateAgentPayment(value);
  const expectedChain = assertChainId(chainId).toString();
  const expectedVault = normalizeAddress(vault);
  const normalizedAction = normalizeTransferAction(action);
  const expectedAction = agentPaymentTransferAction(payment);
  if (payment.chainId !== expectedChain) throw new Error('agent payment chainId does not match.');
  if (payment.vault !== expectedVault) throw new Error('agent payment vault does not match.');
  if (normalizedAction.asset !== expectedAction.asset
    || normalizedAction.recipient !== expectedAction.recipient
    || normalizedAction.amount !== expectedAction.amount
    || normalizedAction.salt !== expectedAction.salt) {
    throw new Error('agent payment does not bind the exact TransferAction.');
  }
  const actionHash = transferActionHash(chainId, expectedVault, normalizedAction);
  return Object.freeze({
    documentDigest: expectedAction.salt,
    action: normalizedAction,
    actionHash,
    proposalId: BigInt(actionHash).toString()
  });
}

function bytesHex(value) {
  return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function publishAgentDocumentCalldata(kind, parentDigest, document) {
  const raw = agentBytes(document);
  if (raw.length === 0) throw new Error('agent document cannot be empty.');
  return encodeCalldata(AGENT_WORK_INDEX.publishSelector, [
    bytes32Word(kind), bytes32Word(parentDigest), { dynamic: encodeBytes(bytesHex(raw)) }
  ]);
}

export function prepareAgentDocumentPublication(type, value) {
  const profile = {
    task: [validateAgentTask, buildAgentTask, AGENT_WORK_KINDS.task],
    receipt: [validateAgentReceipt, buildAgentReceipt, AGENT_WORK_KINDS.receipt],
    payment: [validateAgentPayment, buildAgentPayment, AGENT_WORK_KINDS.payment]
  }[type];
  if (!profile) throw new Error('agent document type must be task, receipt, or payment.');
  const [validate, build, kind] = profile;
  const normalized = validate(value);
  const document = build(normalized);
  const parentDigest = type === 'task'
    ? `0x${'00'.repeat(32)}`
    : normalized[type === 'receipt' ? 'task' : 'receipt'];
  const documentDigest = agentDocumentDigest(document);
  return Object.freeze({
    kind,
    parentDigest,
    documentDigest,
    document: bytesHex(document),
    calldata: publishAgentDocumentCalldata(kind, parentDigest, document)
  });
}

function wordBigInt(value, offset) {
  return BigInt(`0x${Array.from(value.slice(offset, offset + 32), (byte) => (
    byte.toString(16).padStart(2, '0')
  )).join('')}`);
}

export function decodeAgentDocumentPublishedLog(log) {
  if (!log || !Array.isArray(log.topics) || log.topics.length !== 4) {
    throw new Error('Published log topics are invalid.');
  }
  const topics = log.topics.map((topic, index) => normalizeHex(topic, 32, `Published topic ${index}`));
  if (topics[0] !== AGENT_WORK_INDEX.publishedTopic) {
    throw new Error('Published log signature is invalid.');
  }
  const data = agentBytes(normalizeHex(log.data, undefined, 'Published log data'));
  const zeroAddressPadding = data.slice(0, 12).every((byte) => byte === 0);
  if (data.length < 96 || data.length % 32 !== 0 || !zeroAddressPadding
    || wordBigInt(data, 32) !== 64n) {
    throw new Error('Published log data are invalid.');
  }
  const size = wordBigInt(data, 64);
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Published document is too large.');
  const length = Number(size);
  const padded = Math.ceil(length / 32) * 32;
  if (data.length !== 96 + padded || !data.slice(96 + length).every((byte) => byte === 0)) {
    throw new Error('Published log document encoding is invalid.');
  }
  const document = data.slice(96, 96 + length);
  if (document.length === 0 || agentDocumentDigest(document) !== topics[3]) {
    throw new Error('Published log document digest is invalid.');
  }
  return Object.freeze({
    kind: topics[1],
    parentDigest: topics[2],
    documentDigest: topics[3],
    publisher: normalizeAddress(`0x${Array.from(data.slice(12, 32), (byte) => (
      byte.toString(16).padStart(2, '0')
    )).join('')}`, { allowZero: true }),
    document: bytesHex(document)
  });
}

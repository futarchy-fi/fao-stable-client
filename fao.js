const ZERO_ADDRESS = `0x${'0'.repeat(40)}`;
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';

export const SELECTORS = Object.freeze({
  stage: '0xd12d24e8',
  predict: '0x5421831b',
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
  const address = value.toLowerCase();
  if (!allowZero && address === ZERO_ADDRESS) throw new Error('zero address is not allowed.');
  return address;
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
  if (typeof value !== 'string') throw new Error('string value must be a string.');
  const hex = Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

export async function rawIpfsUri(value) {
  return `ipfs://${await cidv1RawSha256(value)}`;
}

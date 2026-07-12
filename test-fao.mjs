import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  SELECTORS,
  approveCalldata,
  assertChainId,
  boolWord,
  claimCalldata,
  depositToSpotCalldata,
  encodeBytes,
  encodeString,
  encodeTuple,
  lifecycleCalldata,
  normalizeAddress,
  normalizeHex,
  predictCalldata,
  prepareRagequit,
  rawIpfsUri,
  redeemCalldata,
  refundCalldata,
  stageCalldata,
  uintWord
} from './fao.js';

const address = (value) => `0x${value.toString(16).padStart(40, '0')}`;
const hash = (byte) => `0x${byte.repeat(32)}`;
const cast = (...args) => execFileSync('cast', args, { encoding: 'utf8' }).trim();

test('CIDv1 raw sha256 matches the canonical no-vote metadata golden vector', async () => {
  const metadata = '{"name":"No voting","description":"Compatibility-only Snapshot X strategy. It always returns zero voting power and never determines proposal status or execution.","properties":{"symbol":"NO-VOTE","decimals":0}}';
  assert.equal(
    await rawIpfsUri(metadata),
    'ipfs://bafkreidrtlsjgiarzgjb76opphwgu7flqanrxcijqbh7o3ycefzqz22hs4'
  );
});

test('core ABI words and dynamic tails match cast', () => {
  assert.equal(uintWord((1n << 256n) - 1n), 'f'.repeat(64));
  assert.equal(boolWord(false), '0'.repeat(64));
  assert.equal(
    `0x${encodeTuple([uintWord(7), { dynamic: encodeString('FAO') }, { dynamic: encodeBytes('0x0102') }])}`,
    cast('abi-encode', 'f(uint256,string,bytes)', '7', 'FAO', '0x0102')
  );
  assert.throws(() => boolWord(1), /true or false/);
  assert.throws(() => uintWord(-1), /invalid|fit/);
});

test('registrar stage and prediction calldata match the settled ABI', () => {
  const core = hash('ab');
  const flm = hash('cd');
  const baseCode = '0x6001600255';
  assert.equal(
    stageCalldata(core, flm, baseCode),
    cast('calldata', 'stage(bytes32,bytes32,bytes)', core, flm, baseCode)
  );
  assert.equal(
    predictCalldata(core, flm, baseCode),
    cast('calldata', 'predict(bytes32,bytes32,bytes)', core, flm, baseCode)
  );
});

test('economic and FLM action calldata match cast', () => {
  const user = address(1);
  const spender = address(2);
  assert.equal(claimCalldata(user), cast('calldata', 'claim(address)', user));
  assert.equal(refundCalldata(user), cast('calldata', 'refund(address)', user));
  assert.equal(
    depositToSpotCalldata(3, 4),
    cast('calldata', 'depositToSpot(uint256,uint256)', '3', '4')
  );
  assert.equal(
    redeemCalldata(5, user, true),
    cast('calldata', 'redeem(uint256,address,bool)', '5', user, 'true')
  );
  assert.equal(approveCalldata(spender, 6), cast('calldata', 'approve(address,uint256)', spender, '6'));
});

test('ragequit normalizes and exposes the exact sorted unique extra-asset list', () => {
  const user = address(9);
  const extra1 = address(1);
  const extra2 = address(2).toUpperCase().replace('0X', '0x');
  const plan = prepareRagequit(7, user, [extra2, extra1, extra2]);
  assert.deepEqual(plan.extras, [extra1, address(2)]);
  assert.equal(
    plan.calldata,
    cast('calldata', 'ragequit(uint256,address,address[])', '7', user, `[${extra1},${address(2)}]`)
  );
  assert.deepEqual(Object.keys(plan), ['extras', 'calldata']);
});

test('permissionless no-argument lifecycle calls use exact selectors', () => {
  for (const [action, signature] of [
    ['seal', 'seal()'],
    ['finalize', 'finalize()'],
    ['fail', 'fail()'],
    ['startNextEvaluation', 'startNextEvaluation()'],
    ['bootstrap', 'bootstrap()']
  ]) {
    assert.equal(lifecycleCalldata(action), cast('sig', signature));
    assert.equal(SELECTORS[action], cast('sig', signature));
  }
  assert.throws(() => lifecycleCalldata('approve'), /unsupported/);
});

test('chain, address, and hex validation fail closed', () => {
  assert.equal(assertChainId('0xaa36a7', 11155111), 11155111n);
  assert.equal(normalizeAddress(address(10).toUpperCase().replace('0X', '0x')), address(10));
  assert.equal(normalizeHex('0xABCD', 2), '0xabcd');
  assert.throws(() => assertChainId(0), /positive/);
  assert.throws(() => assertChainId(1, 11155111), /wrong chain/);
  assert.throws(() => normalizeAddress(address(0)), /zero address/);
  assert.throws(() => normalizeHex('abcd'), /0x-prefixed/);
  assert.throws(() => normalizeHex('0xabc'), /even-length/);
});

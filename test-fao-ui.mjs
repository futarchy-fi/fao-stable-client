import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  deriveNetworkGate,
  instanceTrustLabel,
  parseExtraAssetInput,
  verifyRuntimeCode,
  visibleInstances
} from './fao-ui.js';
import { keccak256 } from './fao.js';

const address = (value) => `0x${value.toString(16).padStart(40, '0')}`;
const hash = (byte) => `0x${byte.repeat(32)}`;

test('pre-deployment is a deliberate read-only state', async () => {
  const gate = deriveNetworkGate({ deploymentStatus: 'pre-deployment' });
  assert.equal(gate.state, 'pre-deployment');
  assert.equal(gate.canTransact, false);

  let calls = 0;
  const result = await verifyRuntimeCode({ status: 'pre-deployment' }, async () => { calls += 1; });
  assert.equal(result.status, 'unavailable');
  assert.equal(calls, 0);
});

test('writes fail closed on RPC disagreement, wrong chain, and unverified code', () => {
  const base = { deploymentStatus: 'active', account: address(1) };
  assert.equal(deriveNetworkGate({ ...base, walletChainId: 11155111, rpcChainId: 1 }).state, 'rpc-disagreement');
  assert.equal(deriveNetworkGate({ ...base, walletChainId: 1, rpcChainId: 1 }).state, 'wrong-chain');
  assert.equal(deriveNetworkGate({ ...base, walletChainId: 11155111, rpcChainId: 11155111 }).state, 'code-unchecked');
  assert.deepEqual(
    deriveNetworkGate({ ...base, walletChainId: '0xaa36a7', rpcChainId: '11155111', codeState: 'verified' }),
    { state: 'ready', canTransact: true, message: 'Sepolia, RPC agreement, and every manifest runtime hash are verified.' }
  );
});

test('runtime verification requires an exact hash map and matches every contract', async () => {
  const manifest = {
    status: 'active',
    contracts: { first: address(1), second: address(2) },
    runtimeCodeHashes: { first: keccak256('0x6001'), second: keccak256('0x6002') }
  };
  const codes = new Map([[address(1), '0x6001'], [address(2), '0x6002']]);
  const request = async (method, params) => {
    assert.equal(method, 'eth_getCode');
    return codes.get(params[0]);
  };
  assert.deepEqual((await verifyRuntimeCode(manifest, request)).checked, ['first', 'second']);

  await assert.rejects(
    verifyRuntimeCode({ ...manifest, runtimeCodeHashes: { first: hash('11') } }, request),
    /exactly match/
  );
  await assert.rejects(
    verifyRuntimeCode({ ...manifest, runtimeCodeHashes: { ...manifest.runtimeCodeHashes, second: hash('33') } }, request),
    /does not match/
  );
});

test('instance browser defaults to curated or code-verified records', () => {
  const records = [
    { address: address(1), name: 'Curated', curated: true },
    { address: address(2), name: 'Verified code', codeVerified: true },
    { address: address(3), name: 'Caller claim' }
  ];
  const defaults = visibleInstances(records);
  assert.deepEqual(defaults.map((item) => item.address), [address(1), address(2)]);
  assert.equal(visibleInstances(records, true).length, 3);
  assert.match(instanceTrustLabel(visibleInstances(records, true)[2]), /Unverified registrar record/);
  assert.match(instanceTrustLabel(defaults[0]), /not organization endorsement/);
});

test('ragequit extra assets are exact, sorted, and unique', () => {
  assert.deepEqual(
    parseExtraAssetInput(`${address(2)}\n${address(0)}, ${address(1)} ${address(2)}`),
    [address(0), address(1), address(2)]
  );
});

test('semantic shell exposes every requested lane and explicit curation opt-in', async () => {
  const html = await readFile(new URL('./fao.html', import.meta.url), 'utf8');
  for (const text of [
    'Create or resume an FAO',
    'Stage 1',
    'Stage 2',
    'Stage 3',
    'Show unverified registrar instances',
    'Launch sale',
    'Deposit to spot FLM',
    'Permissionless sync',
    'Exact additional assets',
    'Release and treasury dashboard'
  ]) assert.match(html, new RegExp(text));
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /data-write[^>]*disabled/);
});

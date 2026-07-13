import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BUYBACK_ACTION_STATES,
  buybackActionStateAfterRefresh,
  creationInputFromDraft,
  deriveNetworkGate,
  instanceTrustLabel,
  parseExtraAssetInput,
  readBuybackModel,
  submitBuybackOnce,
  validateCreationBundle,
  verifyTreasuryManifest,
  verifyRuntimeCode,
  visibleInstances
} from './fao-ui.js';
import { BUYBACK_SELECTORS, addressWord, encodeCalldata, keccak256, uintWord } from './fao.js';
import { treasuryRuntimeRecords, validateTreasuryManifest } from './economic-manifest.mjs';

const address = (value) => `0x${value.toString(16).padStart(40, '0')}`;
const hash = (byte) => `0x${byte.repeat(32)}`;
const word = (value) => `0x${'0'.repeat(24)}${value.slice(2)}`;

function treasuryManifest() {
  const contractNames = [
    'space', 'arbitration', 'vault', 'treasuryExecutor', 'companyToken', 'proposalGateway',
    'releaseStrategy', 'votingStrategy', 'evaluator', 'orchestrator', 'resolver',
    'futarchyFactory', 'spotPool', 'relay', 'spotAdapter', 'conditionalAdapter', 'guard',
    'router', 'manager'
  ];
  const contracts = Object.fromEntries(contractNames.map((name, index) => [name, address(index + 1)]));
  contracts.vestingWallets = [];
  return {
    schemaVersion: 3, creationRoute: 'registrar', status: 'live', network: 'sepolia',
    chainId: 11155111, transactions: {}, receipt: {}, prerequisites: {}, coreConfig: {},
    grants: [], flmConfig: {}, feeTier: 500, poolInitCodeHash: hash('aa'),
    observationCardinality: 120, contracts, codeBlobs: {},
    runtimeCodeHashes: { treasuryExecutor: keccak256('0x6001') }, finalization: {}
  };
}

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
    registrar: { address: address(1), runtimeCodeKeccak256: keccak256('0x6001') },
    prerequisites: {
      proposalImplementation: { address: address(2), runtimeCodeKeccak256: keccak256('0x6002') },
      stackDeployer: { address: address(3), runtimeCodeKeccak256: keccak256('0x6003') }
    }
  };
  const codes = new Map([[address(1), '0x6001'], [address(2), '0x6002'], [address(3), '0x6003']]);
  const request = async (method, params) => {
    assert.equal(method, 'eth_getCode');
    return codes.get(params[0]);
  };
  assert.deepEqual((await verifyRuntimeCode(manifest, request, {})).checked, ['registrar', 'proposalImplementation', 'stackDeployer']);

  await assert.rejects(
    verifyRuntimeCode({ ...manifest, registrar: { ...manifest.registrar, runtimeCodeKeccak256: hash('33') } }, request, {}),
    /does not match/
  );
});

test('schema-v3 treasury manifest verifies executor runtime and four-way wiring', async () => {
  const manifest = treasuryManifest();
  const records = treasuryRuntimeRecords(validateTreasuryManifest(manifest));
  const request = async (method, params) => {
    if (method === 'eth_getCode') return '0x6001';
    assert.equal(method, 'eth_call');
    const [{ to, data }] = params;
    if (to === records.vault && data === '0x0d618c81') return word(records.executor);
    if (to === records.executor && data === '0x411557d1') return word(records.vault);
    if (to === records.gateway && data === '0xfbfa77cf') return word(records.vault);
    if (to === records.gateway && data === '0x9b732350') return word(records.arbitration);
    throw new Error('unexpected call');
  };
  assert.deepEqual(await verifyTreasuryManifest(manifest, request), {
    status: 'verified', ...records
  });
  await assert.rejects(
    verifyTreasuryManifest({
      ...manifest, runtimeCodeHashes: { treasuryExecutor: hash('11') }
    }, request),
    /runtime bytecode/
  );
});

test('buyback read is one-block, chain/address-bound, and rejects malformed ABI words', async () => {
  const vault = address(2);
  const executor = address(3);
  const weth = address(4);
  const values = new Map([
    [BUYBACK_SELECTORS.weth, word(weth)],
    [BUYBACK_SELECTORS.phase, `0x${uintWord(2)}`],
    [BUYBACK_SELECTORS.effectiveSupply, `0x${uintWord(100n * 10n ** 18n)}`],
    [BUYBACK_SELECTORS.window, `0x${uintWord(86_400)}`],
    [BUYBACK_SELECTORS.dailyCap, `0x${uintWord(10n ** 16n)}`],
    [BUYBACK_SELECTORS.dailyBps, `0x${uintWord(100)}`],
    [BUYBACK_SELECTORS.navBps, `0x${uintWord(9_500)}`],
    [BUYBACK_SELECTORS.twapWindow, `0x${uintWord(1_800)}`],
    [BUYBACK_SELECTORS.maxTickDeviation, `0x${uintWord(50)}`],
    [BUYBACK_SELECTORS.windowStart, `0x${uintWord(1_000)}`],
    [BUYBACK_SELECTORS.wethSpent, `0x${uintWord(2n * 10n ** 15n)}`]
  ]);
  const balanceData = encodeCalldata(BUYBACK_SELECTORS.balanceOf, [addressWord(executor)]);
  const request = async (method, params) => {
    if (method === 'eth_getBlockByNumber') return { number: '0x10', timestamp: '0x7d0' };
    assert.equal(method, 'eth_call');
    const [{ to, data }, blockTag] = params;
    assert.equal(blockTag, '0x10');
    if (to === weth && data === balanceData) return `0x${uintWord(5n * 10n ** 17n)}`;
    assert.ok(to === vault || to === executor);
    if (!values.has(data)) throw new Error(`unexpected selector ${data}`);
    return values.get(data);
  };
  const model = await readBuybackModel({
    chainId: 11155111, vault, executor, request
  });
  assert.equal(model.executorWeth, 5n * 10n ** 17n);
  assert.equal(model.effectiveSupply, 100n * 10n ** 18n);
  assert.equal(model.available, 3n * 10n ** 15n);
  assert.equal(model.isLive, true);

  await assert.rejects(
    readBuybackModel({ chainId: 1, vault, executor, request }),
    /wrong chain/
  );
  await assert.rejects(
    readBuybackModel({ chainId: 11155111, vault: '0x1234', executor, request }),
    /address/
  );
  await assert.rejects(
    readBuybackModel({
      chainId: 11155111,
      vault,
      executor,
      request: async (method, params) => {
        if (method === 'eth_getBlockByNumber') return { number: '0x10', timestamp: '0x7d0' };
        if (params[0].data === BUYBACK_SELECTORS.phase) return '0x01';
        return request(method, params);
      }
    }),
    /exactly 32 bytes/
  );
});

test('buyback double-click keeps one transaction in flight and sends only once', async () => {
  let actionState = BUYBACK_ACTION_STATES.ready;
  let sends = 0;
  let releasePreflight;
  const preflight = new Promise((resolve) => { releasePreflight = resolve; });
  const operations = {
    getActionState: () => actionState,
    setActionState: (next) => { actionState = next; },
    refreshBeforeSend: () => preflight,
    send: async () => { sends += 1; return hash('11'); },
    wait: async () => ({ status: '0x1' }),
    decode: () => ({ companyBurned: 1n }),
    onConfirmed: () => {},
    refreshAfterConfirmed: async () => {}
  };

  const first = submitBuybackOnce(operations);
  assert.equal(actionState, BUYBACK_ACTION_STATES.inFlight);
  await assert.rejects(submitBuybackOnce(operations), /disabled until.*refreshed/);
  assert.equal(sends, 0);
  releasePreflight({ canSubmit: true, deterministicReasons: [] });
  const result = await first;
  assert.equal(result.hash, hash('11'));
  assert.equal(sends, 1);
  assert.equal(actionState, BUYBACK_ACTION_STATES.ready);
});

test('confirmed buyback stays disabled through refresh failure and recovers only after a later refresh', async () => {
  let actionState = BUYBACK_ACTION_STATES.ready;
  let sends = 0;
  const order = [];
  const operations = {
    getActionState: () => actionState,
    setActionState: (next) => { actionState = next; order.push(next); },
    refreshBeforeSend: async () => ({ canSubmit: true, deterministicReasons: [] }),
    send: async () => { sends += 1; return hash('22'); },
    wait: async () => ({ status: '0x1' }),
    decode: () => ({ companyBurned: 2n }),
    onConfirmed: () => {
      assert.equal(actionState, BUYBACK_ACTION_STATES.confirmedRefreshNeeded);
      order.push('confirmed-rendered');
    },
    refreshAfterConfirmed: async () => {
      assert.equal(actionState, BUYBACK_ACTION_STATES.confirmedRefreshNeeded);
      order.push('post-confirmation-refresh');
      throw new Error('RPC unavailable after confirmation');
    }
  };

  const result = await submitBuybackOnce(operations);
  assert.match(result.refreshError.message, /RPC unavailable/);
  assert.equal(result.decodeError, null);
  assert.equal(actionState, BUYBACK_ACTION_STATES.confirmedRefreshNeeded);
  assert.ok(order.indexOf('confirmed-rendered') < order.indexOf('post-confirmation-refresh'));
  await assert.rejects(submitBuybackOnce(operations), /disabled until.*refreshed/);
  assert.equal(sends, 1);

  actionState = buybackActionStateAfterRefresh(actionState);
  assert.equal(actionState, BUYBACK_ACTION_STATES.ready);
  assert.throws(
    () => buybackActionStateAfterRefresh(BUYBACK_ACTION_STATES.inFlight),
    /cannot be cleared/
  );
});

test('draft becomes one frozen canonical registrar input', () => {
  const record = (id) => ({ address: address(id), runtimeCodeKeccak256: hash(id.toString(16).padStart(2, '0')) });
  const manifest = {
    status: 'active', registrar: record(1),
    prerequisites: { proposalImplementation: record(2), stackDeployer: record(3) }
  };
  const cid = `ipfs://b${'a'.repeat(58)}`;
  const draft = {
    tokenName: 'Example FAO', tokenSymbol: 'EFAO',
    governedRepository: 'https://github.com/example/fao', governedSite: 'https://example.pages.dev',
    saleDuration: '3600', bootstrapDuration: '86400', saleCap: '100000000000000000000',
    initialPrice: '10000000000000', slope: '0', minimumRaise: '500000000000000',
    tokenMaxSupply: '201000000000000000000', bootstrapBps: '5000',
    daoURI: cid, metadataURI: cid, votingStrategyMetadataURI: cid,
    proposalValidationStrategyMetadataURI: cid
  };
  const input = creationInputFromDraft(draft, manifest, 2_000_000_000n);
  assert.equal(input.registrar, address(1));
  assert.equal(input.currentTimestamp, '2000000000');
  assert.equal(input.coreConfig.saleEnd, '2000003600');
  assert.equal(input.coreConfig.bootstrapDeadline, '2000090000');
  assert.equal(input.coreConfig.stackDeployer.target, address(3));
  assert.equal(input.coreConfig.proposalImplementation.target, address(2));
  assert.deepEqual(input.coreConfig.assetPolicies, [{
    asset: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14',
    c1: '10000000000000000', c2: '100000000000000000',
    tapBudget: '10000000000000000', tapBudgetMax: '100000000000000000'
  }]);
  assert.deepEqual(input.grants, []);
});

test('creation bundle verifies every receipt, core, and FLM blob', () => {
  const codes = {
    receipt: '0x6000',
    core: Object.fromEntries(['ARBITRATION', 'VAULT', 'RELEASE_STRATEGY', 'ZERO_VOTING', 'ECON_GATEWAY', 'ECON_EVALUATOR'].map((key, index) => [key, `0x60${(index + 1).toString(16).padStart(2, '0')}`])),
    flm: Object.fromEntries(['RELAY', 'ADAPTER', 'GUARD', 'ROUTER', 'MANAGER'].map((key, index) => [key, `0x61${(index + 1).toString(16).padStart(2, '0')}`]))
  };
  const hashes = {
    receipt: keccak256(codes.receipt),
    core: Object.fromEntries(Object.entries(codes.core).map(([key, code]) => [key, keccak256(code)])),
    flm: Object.fromEntries(Object.entries(codes.flm).map(([key, code]) => [key, keccak256(code)]))
  };
  const bundle = {
    schemaVersion: 1,
    evidence: {
      economicManifestPath: 'metadata/economic-core-code-hashes.json',
      economicManifestKeccak256: hash('11'),
      flmManifestPath: 'metadata/sepolia-flm-code-hashes.json',
      flmManifestKeccak256: hash('22')
    },
    codeHashes: hashes,
    creationCodes: codes
  };
  assert.equal(validateCreationBundle(bundle), bundle);
  bundle.creationCodes.core.VAULT = '0x6009';
  assert.throws(() => validateCreationBundle(bundle), /pinned hash/);
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
    'Release and treasury dashboard',
    'Verify one active FAO treasury',
    'Executor custody',
    'Low transfer · unchallenged YES',
    'Bounded parameter',
    'Round 1 evaluated YES',
    'Exact treasury transaction flow',
    'Fixed-policy buyback',
    'controls timing only',
    'Accepted queued WETH payments are not reserved',
    'Transaction state',
    'Call buyback',
    'Agent task → receipt → payment evidence',
    'predicted\\s+CREATE2 address is not a deployment',
    'Accepted is authorization, not payment',
    'unverified—not paid'
  ]) assert.match(html, new RegExp(text));
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /data-write[^>]*disabled/);
});

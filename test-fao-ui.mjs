import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  BUYBACK_ACTION_STATES,
  buybackActionStateAfterRefresh,
  creationInputFromDraft,
  deriveNetworkGate,
  instanceTrustLabel,
  latestRequestGate,
  parseExtraAssetInput,
  readBuybackModel,
  singleFlightGate,
  submitBuybackOnce,
  validateCreationBundle,
  verifyAgentWorkProvenance,
  verifyTreasuryManifest,
  verifyRuntimeCode,
  visibleInstances
} from './fao-ui.js';
import {
  BUYBACK_SELECTORS, addressWord, economicCommitmentHashes, encodeCalldata, keccak256,
  prepareTreasuryFlow, uintWord
} from './fao.js';
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
    schemaVersion: 4, creationRoute: 'create', status: 'live', network: 'sepolia',
    chainId: 11155111, transactions: {}, receipt: {}, prerequisites: {}, coreConfig: {},
    grants: [], flmConfig: {}, feeTier: 500, poolInitCodeHash: hash('aa'),
    observationCardinality: 120, contracts, codeBlobs: {},
    runtimeCodeHashes: {
      vault: keccak256('0x6001'), proposalGateway: keccak256('0x6001'),
      arbitration: keccak256('0x6001'), treasuryExecutor: keccak256('0x6001')
    }, finalization: {}
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

test('latest request gate discards overlapping and input-stale completions', async () => {
  const gate = latestRequestGate();
  const committed = [];
  const errors = [];
  let finishOld;
  let finishNew;
  const run = async (request, promise, snapshot) => {
    try {
      const value = await promise;
      if (gate.current(request, snapshot)) committed.push(value);
    } catch (error) {
      if (gate.current(request, snapshot)) errors.push(error.message);
    }
  };
  const oldPromise = new Promise((resolve) => { finishOld = resolve; });
  const oldRequest = gate.begin('same-input');
  const oldRun = run(oldRequest, oldPromise, 'same-input');
  const newPromise = new Promise((resolve) => { finishNew = resolve; });
  const newRequest = gate.begin('same-input');
  const newRun = run(newRequest, newPromise, 'same-input');
  finishNew('new');
  await newRun;
  finishOld('old');
  await oldRun;
  assert.deepEqual(committed, ['new']);

  const changed = gate.begin('before-input');
  assert.equal(gate.current(changed, 'after-input'), false);
  gate.invalidate();
  assert.equal(gate.current(changed, 'before-input'), false);

  let failOld;
  const oldFailure = new Promise((_, reject) => { failOld = reject; });
  const failedRequest = gate.begin('manifest-a');
  const failedRun = run(failedRequest, oldFailure, 'manifest-a');
  gate.invalidate();
  failOld(new Error('stale verification failure'));
  await failedRun;
  assert.deepEqual(errors, []);

  let finishChanged;
  const changedPromise = new Promise((resolve) => { finishChanged = resolve; });
  const changedRequest = gate.begin('manifest-a');
  const changedRun = run(changedRequest, changedPromise, 'manifest-b');
  finishChanged('stale-trust-root');
  await changedRun;
  assert.deepEqual(committed, ['new']);
  const dependentPlanner = { trustRoot: committed.at(-1) };
  assert.deepEqual(dependentPlanner, { trustRoot: 'new' });
});

test('every async positive-state writer is generation-gated against stale success and error', async () => {
  const source = await readFile(new URL('./fao-ui.js', import.meta.url), 'utf8');
  for (const name of [
    'agentWorkRequests', 'buybackRequests', 'connectionRequests', 'creationPlanRequests',
    'receiptStateRequests', 'treasuryFlowRequests', 'treasuryManifestRequests'
  ]) {
    assert.match(source, new RegExp(`const ${name} = latestRequestGate\\(\\);`));
    assert.match(source, new RegExp(`${name}\\.current\\(`));
  }

  for (const label of ['treasury', 'creation', 'receipt', 'buyback']) {
    const gate = latestRequestGate();
    const positive = [];
    const errors = [];
    const run = async (request, promise, snapshot) => {
      try {
        const value = await promise;
        if (gate.current(request, snapshot)) positive.push(value);
      } catch (error) {
        if (gate.current(request, snapshot)) errors.push(error.message);
      }
    };
    let finish;
    const staleSuccess = new Promise((resolve) => { finish = resolve; });
    const successRequest = gate.begin(`${label}-a`);
    const successRun = run(successRequest, staleSuccess, `${label}-b`);
    finish('unsafe-positive-state');
    await successRun;

    let fail;
    const staleError = new Promise((_, reject) => { fail = reject; });
    const errorRequest = gate.begin(`${label}-a`);
    const errorRun = run(errorRequest, staleError, `${label}-a`);
    gate.invalidate();
    fail(new Error('obsolete failure'));
    await errorRun;
    assert.deepEqual({ positive, errors }, { positive: [], errors: [] }, label);
  }
});

test('typed treasury edits revoke the exact prepared flow before any send', async () => {
  for (const [field, next] of [
    ['recipient', address(8)], ['amount', '2'], ['route', 'evaluated'], ['type', 'param']
  ]) {
    const input = {
      type: 'transfer', route: 'timeout', asset: address(4), recipient: address(5),
      amount: '1', salt: hash('11')
    };
    const snapshot = () => JSON.stringify(input);
    const generations = latestRequestGate();
    const sends = singleFlightGate();
    const request = generations.begin(snapshot());
    const flow = prepareTreasuryFlow({
      chainId: 11155111, vault: address(1), gateway: address(2), executor: address(3),
      type: 'transfer', route: input.route,
      action: {
        asset: input.asset, recipient: input.recipient, amount: input.amount, salt: input.salt
      }
    });
    let finishVerification;
    const verified = new Promise((resolve) => { finishVerification = resolve; });
    let broadcasts = 0;
    const send = async () => {
      if (!generations.current(request, snapshot())) return;
      const operation = sends.begin();
      if (!operation) return;
      try {
        await verified;
        if (!generations.current(request, snapshot())) return;
        assert.ok(flow.steps[0].data.startsWith('0x'));
        broadcasts += 1;
      } finally {
        sends.finish(operation);
      }
    };
    const pending = send();
    input[field] = next;
    generations.invalidate();
    finishVerification();
    await pending;
    assert.equal(broadcasts, 0, field);
  }
});

test('operation locks survive configuration changes and own completion status', async () => {
  const lock = singleFlightGate();
  let active = null;
  let actionState = BUYBACK_ACTION_STATES.ready;
  let sends = 0;
  let transactionHash = null;
  let completedBy = null;
  let manifest = 'manifest-a';
  let status = 'submitted-a';
  let finishReceipt;
  const receipt = new Promise((resolve) => { finishReceipt = resolve; });
  const call = async () => {
    const operation = lock.begin();
    if (!operation) return null;
    active = operation;
    const capturedManifest = manifest;
    try {
      return await submitBuybackOnce({
        getActionState: () => actionState,
        setActionState: (next) => { actionState = next; },
        refreshBeforeSend: async () => ({ canSubmit: true, deterministicReasons: [] }),
        send: async () => {
          sends += 1;
          transactionHash = hash('77');
          return transactionHash;
        },
        wait: async () => receipt,
        decode: () => ({ companyBurned: 1n }),
        onConfirmed: () => {
          if (!lock.current(operation)) return;
          completedBy = operation;
          if (manifest === capturedManifest) status = 'old confirmed';
        },
        refreshAfterConfirmed: async () => ({ canSubmit: false })
      });
    } finally {
      if (active === operation) active = null;
      lock.finish(operation);
    }
  };

  const first = call();
  await Promise.resolve();
  assert.equal(sends, 1);
  // Manifest edit/reload must not reset action state while the independent operation exists.
  manifest = 'manifest-b';
  status = 'new manifest';
  if (!active) actionState = BUYBACK_ACTION_STATES.refreshNeeded;
  if (!active) actionState = buybackActionStateAfterRefresh(actionState);
  const second = await call();
  assert.equal(second, null);
  assert.equal(sends, 1);
  assert.equal(transactionHash, hash('77'));
  assert.equal(actionState, BUYBACK_ACTION_STATES.inFlight);
  finishReceipt({ status: '0x1' });
  await first;
  assert.ok(completedBy);
  assert.equal(status, 'new manifest');
  assert.equal(active, null);
  assert.equal(transactionHash, hash('77'));
  assert.equal(actionState, BUYBACK_ACTION_STATES.ready);
});

test('single-flight stage sends and generation ownership suppress duplicate and stale status', async () => {
  for (const label of ['creation', 'treasury']) {
    const lock = singleFlightGate();
    const generations = latestRequestGate();
    let snapshot = `${label}-plan-a`;
    const request = generations.begin(snapshot);
    let finish;
    const receipt = new Promise((resolve) => { finish = resolve; });
    let sends = 0;
    let status = 'submitted-a';
    const run = async (fail = false) => {
      const operation = lock.begin();
      if (!operation) return;
      try {
        sends += 1;
        await receipt;
        if (fail) throw new Error('old failure');
        if (lock.current(operation) && generations.current(request, snapshot)) status = 'old success';
      } catch (error) {
        if (lock.current(operation) && generations.current(request, snapshot)) status = error.message;
      } finally {
        lock.finish(operation);
      }
    };
    const first = run(label === 'treasury');
    await run();
    assert.equal(sends, 1, label);
    snapshot = `${label}-plan-b`;
    generations.invalidate();
    status = 'new plan';
    finish();
    await first;
    assert.equal(status, 'new plan', label);
  }
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

test('schema-v4 treasury manifest verifies four runtimes and wiring at one finalized block', async () => {
  const manifest = treasuryManifest();
  const records = treasuryRuntimeRecords(validateTreasuryManifest(manifest));
  const request = async (method, params) => {
    if (method === 'eth_getCode') return '0x6001';
    if (method === 'eth_getBlockByNumber') {
      return { number: '0x10', timestamp: '0x20', hash: hash('44') };
    }
    assert.equal(method, 'eth_call');
    const [{ to, data }] = params;
    if (to === records.vault && data === '0x0d618c81') return word(records.executor);
    if (to === records.executor && data === '0x411557d1') return word(records.vault);
    if (to === records.gateway && data === '0xfbfa77cf') return word(records.vault);
    if (to === records.gateway && data === '0x9b732350') return word(records.arbitration);
    throw new Error('unexpected call');
  };
  assert.deepEqual(await verifyTreasuryManifest(manifest, request), {
    status: 'verified', ...records,
    blockNumber: 16n,
    blockHash: hash('44'),
    timestamp: 32n,
    blockTag: '0x10'
  });
  await assert.rejects(
    verifyTreasuryManifest({
      ...manifest, runtimeCodeHashes: {
        ...manifest.runtimeCodeHashes, treasuryExecutor: hash('11')
      }
    }, request),
    /runtime bytecode/
  );
  assert.throws(() => validateTreasuryManifest({ ...manifest, schemaVersion: 3 }), /version 4/);
  assert.throws(() => validateTreasuryManifest({
    ...manifest,
    runtimeCodeHashes: {
      treasuryExecutor: manifest.runtimeCodeHashes.treasuryExecutor,
      vault: manifest.runtimeCodeHashes.vault,
      proposalGateway: manifest.runtimeCodeHashes.proposalGateway,
      arbitration: manifest.runtimeCodeHashes.arbitration
    }
  }), /canonical order/);
});

test('agent lifecycle roots self-consistent stacks without unsafe JSON-number preimage claims', async () => {
  const bundle = JSON.parse(await readFile(new URL('./fao-creation-codes.json', import.meta.url), 'utf8'));
  const deploymentRecord = (id, source, contract, code) => ({
    address: address(id), source, contract,
    transaction: { hash: hash(id.toString(16).padStart(2, '0')), block: id, nonce: id, from: address(id + 100) },
    creationCodeBytes: 1, creationCodeKeccak256: keccak256(code),
    runtimeCodeBytes: (code.length - 2) / 2, runtimeCodeKeccak256: keccak256(code)
  });
  const registrarCode = '0x600a';
  const shared = {
    schemaVersion: 1, network: 'sepolia', chainId: 11155111,
    registrar: deploymentRecord(40, 'src/FaoGenesisRegistrar.sol', 'FaoGenesisRegistrar', registrarCode),
    prerequisites: {
      proposalImplementation: deploymentRecord(
        41, 'src/FAOFutarchyProposal.sol', 'FAOFutarchyProposal', '0x600b'
      ),
      stackDeployer: deploymentRecord(
        42, 'src/FAOSiteStackDeployer.sol', 'FAOSiteStackDeployer', '0x600c'
      )
    }
  };
  const cid = `ipfs://b${'a'.repeat(58)}`;
  const input = creationInputFromDraft({
    tokenName: 'Evidence FAO', tokenSymbol: 'EFAO',
    governedRepository: 'https://github.com/example/fao', governedSite: 'https://example.test',
    saleDuration: '3600', bootstrapDuration: '86400', saleCap: '100000000000000000000',
    initialPrice: '10000000000000', slope: '0', minimumRaise: '500000000000000',
    tokenMaxSupply: '201000000000000000000', bootstrapBps: '5000',
    daoURI: cid, metadataURI: cid, votingStrategyMetadataURI: cid,
    proposalValidationStrategyMetadataURI: cid
  }, { ...shared, status: 'active' }, 2_000_000_000n);
  const commitments = economicCommitmentHashes(input.coreConfig, input.grants, input.flmConfig);
  const dependencyKeys = [
    'proxyFactory', 'spaceImplementation', 'proposalValidationStrategy', 'stackDeployer',
    'proposalImplementation', 'weth', 'conditionalTokens', 'wrapped1155Factory',
    'uniswapV3Factory'
  ];
  const economicCoreConfig = { ...input.coreConfig };
  for (const key of dependencyKeys) {
    economicCoreConfig[key] = {
      target: input.coreConfig[key].target,
      runtimeCodeKeccak256: input.coreConfig[key].codehash
    };
  }
  const economicFlmConfig = {
    positionManager: {
      target: input.flmConfig.positionManager.target,
      runtimeCodeKeccak256: input.flmConfig.positionManager.codehash
    }
  };
  const base = treasuryManifest();
  const receiptAddress = address(30);
  const stager = address(31);
  const lifecycleCodes = {
    [base.contracts.vault]: '0x6101',
    [base.contracts.proposalGateway]: '0x6102',
    [base.contracts.arbitration]: '0x6103',
    [base.contracts.treasuryExecutor]: '0x6104'
  };
  const manifest = {
    ...base,
    creationRoute: 'registrar',
    transactions: {
      receiptCreate: { hash: hash('77'), block: 5, nonce: 1, from: stager },
      deployCore: { hash: hash('78'), block: 6, nonce: 2, from: stager },
      deployFlm: { hash: hash('79'), block: 7, nonce: 3, from: stager }
    },
    receipt: {
      address: receiptAddress,
      source: 'src/FaoGenesisDeployment.sol',
      contract: 'FaoGenesisDeployment',
      stageNonce: 1,
      creationCodeBytes: (bundle.creationCodes.receipt.length - 2) / 2,
      creationCodeKeccak256: keccak256(bundle.creationCodes.receipt),
      coreConfigHash: commitments.core,
      flmConfigHash: commitments.flm,
      registrar: {
        target: shared.registrar.address,
        runtimeCodeKeccak256: shared.registrar.runtimeCodeKeccak256
      }
    },
    coreConfig: economicCoreConfig,
    grants: input.grants,
    flmConfig: economicFlmConfig,
    runtimeCodeHashes: {
      vault: keccak256(lifecycleCodes[base.contracts.vault]),
      proposalGateway: keccak256(lifecycleCodes[base.contracts.proposalGateway]),
      arbitration: keccak256(lifecycleCodes[base.contracts.arbitration]),
      treasuryExecutor: keccak256(lifecycleCodes[base.contracts.treasuryExecutor])
    }
  };
  const pinnedHash = hash('88');
  const stageHash = hash('66');
  const coreBlockHash = hash('67');
  const flmBlockHash = hash('68');
  const stageLog = {
    address: shared.registrar.address,
    blockNumber: '0x5',
    blockHash: stageHash,
    transactionHash: manifest.transactions.receiptCreate.hash,
    logIndex: '0x0',
    topics: [
      '0x8973a01bba3f334d825bf89174c5a81d41623a8065f3217205ab1a3e59a104f4',
      `0x${addressWord(receiptAddress)}`,
      commitments.core,
      commitments.flm
    ],
    data: word(stager)
  };
  const coreLog = {
    address: receiptAddress,
    blockNumber: '0x6', blockHash: coreBlockHash,
    transactionHash: manifest.transactions.deployCore.hash, logIndex: '0x0',
    topics: [
      '0x14ff846bb4cfd1fc5532bfd1985c0eb4c21898c217d598c527e99057d0a37e4c',
      `0x${addressWord(manifest.contracts.vault)}`,
      `0x${addressWord(manifest.contracts.companyToken)}`,
      `0x${addressWord(manifest.contracts.space)}`
    ],
    data: `0x${[
      manifest.contracts.arbitration, manifest.contracts.evaluator, manifest.contracts.spotPool
    ].map((value) => addressWord(value)).join('')}`
  };
  const flmLog = {
    address: receiptAddress,
    blockNumber: '0x7', blockHash: flmBlockHash,
    transactionHash: manifest.transactions.deployFlm.hash, logIndex: '0x0',
    topics: [
      '0xaddc5fbefc27baeeb76557046cf0702c071bbfb91d131ff9312e6e401d6fe4e1',
      `0x${addressWord(manifest.contracts.manager)}`
    ],
    data: `0x${[
      manifest.contracts.relay, manifest.contracts.spotAdapter
    ].map((value) => addressWord(value)).join('')}`
  };
  const request = async (method, params) => {
    if (method === 'eth_getCode') {
      const target = params[0];
      if (target === shared.registrar.address) return registrarCode;
      if (target === shared.prerequisites.proposalImplementation.address) return '0x600b';
      if (target === shared.prerequisites.stackDeployer.address) return '0x600c';
      if (target === receiptAddress) return '0x6010';
      return lifecycleCodes[target] || '0x';
    }
    if (method === 'eth_getLogs') {
      const filter = params[0];
      if (filter.address === shared.registrar.address) return [stageLog];
      if (filter.topics[0] === coreLog.topics[0]) return [coreLog];
      if (filter.topics[0] === flmLog.topics[0]) return [flmLog];
    }
    if (method === 'eth_getBlockByNumber') {
      return { hash: {
        '0x5': stageHash, '0x6': coreBlockHash, '0x7': flmBlockHash
      }[params[0]] || pinnedHash };
    }
    if (method === 'eth_call') {
      const [{ to, data }] = params;
      if (to === shared.registrar.address && data === '0x831c4e7b') {
        return keccak256(bundle.creationCodes.receipt);
      }
      if (to === shared.registrar.address && data.startsWith('0x5421831b')) return word(receiptAddress);
      if (to === receiptAddress && data === '0xb1b4fc36') return commitments.core;
      if (to === receiptAddress && data === '0x1092769f') return commitments.flm;
      if (to === receiptAddress && ['0x73797f98', '0xe05abb68'].includes(data)) return `0x${uintWord(1)}`;
      if (to === receiptAddress && data === '0xfbfa77cf') return word(manifest.contracts.vault);
      if (to === receiptAddress && data === '0x04e31dfb') return word(manifest.contracts.proposalGateway);
      if (to === receiptAddress && data === '0x9b732350') return word(manifest.contracts.arbitration);
      if (to === manifest.contracts.vault && data === '0x0d618c81') return word(manifest.contracts.treasuryExecutor);
      if (to === manifest.contracts.treasuryExecutor && data === '0x411557d1') return word(manifest.contracts.vault);
      if (to === manifest.contracts.proposalGateway && data === '0xfbfa77cf') return word(manifest.contracts.vault);
      if (to === manifest.contracts.proposalGateway && data === '0x9b732350') return word(manifest.contracts.arbitration);
    }
    throw new Error(`unexpected ${method} ${JSON.stringify(params)}`);
  };
  const repoLoadedShared = { ...shared, status: 'active', explorer: 'https://sepolia.etherscan.io' };
  const verified = await verifyAgentWorkProvenance({
    manifest,
    selfServeManifest: repoLoadedShared,
    creationBundle: bundle,
    indexView: { blockNumber: 100n, blockHash: pinnedHash, timestamp: 2_000_000_100n },
    request
  });
  assert.equal(verified.receipt, receiptAddress);
  assert.equal(verified.vault, manifest.contracts.vault);

  const lossyDisplayOnly = structuredClone(manifest);
  lossyDisplayOnly.coreConfig.saleCap = Number.MAX_SAFE_INTEGER + 2;
  const hashSealed = await verifyAgentWorkProvenance({
    manifest: lossyDisplayOnly,
    selfServeManifest: repoLoadedShared,
    creationBundle: bundle,
    indexView: { blockNumber: 100n, blockHash: pinnedHash, timestamp: 2_000_000_100n },
    request
  });
  assert.equal(hashSealed.receipt, receiptAddress);

  const malicious = structuredClone(manifest);
  malicious.contracts.vault = address(50);
  malicious.contracts.proposalGateway = address(51);
  malicious.contracts.arbitration = address(52);
  malicious.contracts.treasuryExecutor = address(53);
  malicious.runtimeCodeHashes = {
    vault: keccak256('0x6201'), proposalGateway: keccak256('0x6202'),
    arbitration: keccak256('0x6203'), treasuryExecutor: keccak256('0x6204')
  };
  await assert.rejects(verifyAgentWorkProvenance({
    manifest: malicious,
    selfServeManifest: repoLoadedShared,
    creationBundle: bundle,
    indexView: { blockNumber: 100n, blockHash: pinnedHash, timestamp: 2_000_000_100n },
    request
  }), /CoreSealed|receipt lifecycle wiring/);
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
    'build prediction is not a',
    'explicitly incomplete',
    'Valid payment envelopes',
    'block-delta-consistent',
    'not a transaction-level state diff',
    'does not claim to revalidate the full economic config',
    'Accepted is authorization, not payment',
    'unverified—not paid'
  ]) assert.match(html, new RegExp(text));
  assert.match(html, /schemaVersion&quot;:4/);
  assert.doesNotMatch(html, /schemaVersion&quot;:3/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /data-write[^>]*disabled/);
});

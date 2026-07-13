import { selfServeRuntimeRecords, validateSelfServeManifest } from './selfserve-manifest.mjs';
import { treasuryRuntimeRecords, validateTreasuryManifest } from './economic-manifest.mjs';
import * as fao from './fao.js';

export const SEPOLIA_CHAIN_ID = 11155111n;
export const BUYBACK_ACTION_STATES = Object.freeze({
  refreshNeeded: 'refresh-needed',
  ready: 'ready',
  inFlight: 'in-flight',
  submittedUnknown: 'submitted-unknown',
  confirmedRefreshNeeded: 'confirmed-refresh-needed'
});

export function buybackActionStateAfterRefresh(current) {
  if (!Object.values(BUYBACK_ACTION_STATES).includes(current)) {
    throw new Error('Invalid buyback action state.');
  }
  if ([BUYBACK_ACTION_STATES.inFlight, BUYBACK_ACTION_STATES.submittedUnknown].includes(current)) {
    throw new Error('An unresolved buyback cannot be cleared by a state read.');
  }
  return BUYBACK_ACTION_STATES.ready;
}

export function latestRequestGate() {
  let generation = 0;
  return Object.freeze({
    begin(snapshot) {
      return Object.freeze({ generation: ++generation, snapshot });
    },
    invalidate() {
      generation += 1;
    },
    current(request, snapshot) {
      return request?.generation === generation && request.snapshot === snapshot;
    }
  });
}

export const TRACKED_OPERATION_STATES = Object.freeze({
  preBroadcast: 'pre-broadcast',
  walletRequested: 'wallet-requested',
  submitted: 'submitted',
  confirmed: 'confirmed',
  reverted: 'reverted',
  cancelled: 'cancelled',
  failed: 'failed'
});

const PENDING_OPERATION_STATES = new Set([
  TRACKED_OPERATION_STATES.preBroadcast,
  TRACKED_OPERATION_STATES.walletRequested,
  TRACKED_OPERATION_STATES.submitted
]);

export function trackedOperationController({ limit = 8, onChange = () => {} } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || typeof onChange !== 'function') {
    throw new Error('Tracked operation controller options are invalid.');
  }
  let nextId = 0;
  const journal = [];
  const snapshots = () => Object.freeze(journal.map((operation) => Object.freeze({ ...operation })));
  const trim = () => {
    while (journal.length > limit) {
      const index = journal.findLastIndex((operation) => !PENDING_OPERATION_STATES.has(operation.state));
      if (index === -1) return;
      journal.splice(index, 1);
    }
  };
  const changed = () => {
    trim();
    onChange(snapshots());
  };
  const known = (operation) => journal.includes(operation);
  const transition = (operation, from, state, patch = {}) => {
    if (!known(operation) || !from.includes(operation.state)) {
      throw new Error('Tracked operation transition is invalid.');
    }
    Object.assign(operation, patch, { state });
    changed();
    return operation;
  };
  return Object.freeze({
    begin(context) {
      if (!context || Array.isArray(context) || typeof context !== 'object') {
        throw new Error('Tracked operation context is required.');
      }
      const kind = String(context.kind || '').trim();
      const label = String(context.label || '').trim().slice(0, 120);
      if (!kind || !label || journal.some((operation) => (
        operation.kind === kind && PENDING_OPERATION_STATES.has(operation.state)
      ))) return null;
      const chainId_ = fao.assertChainId(context.chainId).toString();
      const account = fao.normalizeAddress(context.account);
      const vault = context.vault == null ? null : fao.normalizeAddress(context.vault);
      const target = context.target == null ? null : fao.normalizeAddress(context.target);
      if (!vault && !target) throw new Error('Tracked operation requires a vault or target.');
      const operation = {
        id: ++nextId,
        kind,
        label,
        chainId: chainId_,
        account,
        vault,
        target,
        state: TRACKED_OPERATION_STATES.preBroadcast,
        hash: null,
        key: null,
        receiptStatus: null,
        receiptBlockNumber: null,
        error: null
      };
      journal.unshift(operation);
      changed();
      return operation;
    },
    pending(kind) {
      return journal.find((operation) => (
        operation.kind === kind && PENDING_OPERATION_STATES.has(operation.state)
      )) || null;
    },
    isPending(operation) {
      return known(operation) && PENDING_OPERATION_STATES.has(operation.state);
    },
    walletRequested(operation) {
      return transition(
        operation, [TRACKED_OPERATION_STATES.preBroadcast],
        TRACKED_OPERATION_STATES.walletRequested
      );
    },
    submitted(operation, hash) {
      const normalizedHash = fao.normalizeHex(hash, 32, 'Transaction hash');
      const subject = operation.vault || operation.target;
      return transition(
        operation, [TRACKED_OPERATION_STATES.walletRequested],
        TRACKED_OPERATION_STATES.submitted,
        { hash: normalizedHash, key: `${operation.chainId}:${subject}:${normalizedHash}`, error: null }
      );
    },
    noteUnknown(operation, error) {
      if (!known(operation) || operation.state !== TRACKED_OPERATION_STATES.submitted) {
        throw new Error('Only a submitted operation can have an unknown receipt.');
      }
      operation.error = String(error?.message || error || 'Transaction receipt is unknown.').slice(0, 240);
      changed();
      return operation;
    },
    noteWalletUnknown(operation, error) {
      if (!known(operation) || operation.state !== TRACKED_OPERATION_STATES.walletRequested) {
        throw new Error('Only a wallet-requested operation can have an unknown hash.');
      }
      operation.error = String(error?.message || error || 'Wallet request outcome is unknown.').slice(0, 240);
      changed();
      return operation;
    },
    settle(operation, receipt) {
      const status = BigInt(receipt?.status);
      if (status !== 0n && status !== 1n) throw new Error('Transaction receipt status is invalid.');
      const receiptBlockNumber = receipt?.blockNumber == null
        ? null
        : rpcQuantity(receipt.blockNumber, 'Transaction receipt block number').toString();
      if (known(operation)
        && [TRACKED_OPERATION_STATES.confirmed, TRACKED_OPERATION_STATES.reverted].includes(operation.state)) {
        if (operation.receiptStatus !== status.toString()) {
          throw new Error('Resolved transaction receipts disagree.');
        }
        if (operation.receiptBlockNumber != null && receiptBlockNumber != null
          && operation.receiptBlockNumber !== receiptBlockNumber) {
          throw new Error('Resolved transaction receipt blocks disagree.');
        }
        if (operation.receiptBlockNumber == null && receiptBlockNumber != null) {
          operation.receiptBlockNumber = receiptBlockNumber;
          changed();
        }
        return operation;
      }
      return transition(
        operation, [TRACKED_OPERATION_STATES.submitted],
        status === 1n ? TRACKED_OPERATION_STATES.confirmed : TRACKED_OPERATION_STATES.reverted,
        { receiptStatus: status.toString(), receiptBlockNumber, error: null }
      );
    },
    cancel(operation, reason = 'Inputs changed before the wallet request.') {
      return transition(
        operation, [TRACKED_OPERATION_STATES.preBroadcast],
        TRACKED_OPERATION_STATES.cancelled,
        { error: String(reason).slice(0, 240) }
      );
    },
    fail(operation, error) {
      return transition(
        operation,
        [TRACKED_OPERATION_STATES.preBroadcast, TRACKED_OPERATION_STATES.walletRequested],
        TRACKED_OPERATION_STATES.failed,
        { error: String(error?.message || error || 'Operation failed.').slice(0, 240) }
      );
    },
    entries() {
      return snapshots();
    }
  });
}

function trackedResult(operation, { blocked = false, receipt = null, error = null } = {}) {
  return Object.freeze({ operation, blocked, receipt, error });
}

export async function runTrackedTransaction({
  controller, context, verify, stillCurrent, send, wait, onUpdate = () => {}
}) {
  if (!controller || typeof controller.begin !== 'function' || typeof verify !== 'function'
    || typeof stillCurrent !== 'function' || typeof send !== 'function'
    || typeof wait !== 'function' || typeof onUpdate !== 'function') {
    throw new Error('Tracked transaction operations are invalid.');
  }
  const operation = controller.begin(context);
  if (!operation) return trackedResult(controller.pending(context.kind), { blocked: true });
  const current = () => {
    try {
      return Boolean(stillCurrent());
    } catch {
      return false;
    }
  };
  const update = () => {
    if (current()) onUpdate(operation);
  };
  try {
    await verify(operation);
  } catch (error) {
    if (current()) controller.fail(operation, error);
    else controller.cancel(operation);
    update();
    return trackedResult(operation, { error });
  }
  if (!current()) {
    controller.cancel(operation);
    update();
    return trackedResult(operation);
  }
  controller.walletRequested(operation);
  update();
  let hash;
  try {
    hash = await send(operation);
    controller.submitted(operation, hash);
  } catch (error) {
    if (error?.code === 4001) controller.fail(operation, error);
    else controller.noteWalletUnknown(operation, error);
    update();
    return trackedResult(operation, { error });
  }
  update();
  let receipt;
  try {
    receipt = await wait(hash, operation);
    controller.settle(operation, receipt);
  } catch (error) {
    if (operation.state === TRACKED_OPERATION_STATES.submitted) {
      controller.noteUnknown(operation, error);
    }
    update();
    return trackedResult(operation, { error });
  }
  update();
  return trackedResult(operation, { receipt });
}

export async function reconcileTrackedOperation(controller, operation, readReceipt) {
  if (!controller?.isPending(operation) || operation.state !== TRACKED_OPERATION_STATES.submitted
    || typeof readReceipt !== 'function') {
    throw new Error('A submitted tracked operation is required for reconciliation.');
  }
  let receipt;
  try {
    receipt = await readReceipt(operation.hash, operation);
    if (!receipt) throw new Error('Transaction receipt is not available yet.');
    controller.settle(operation, receipt);
  } catch (error) {
    if (operation.state === TRACKED_OPERATION_STATES.submitted) {
      controller.noteUnknown(operation, error);
    }
    return trackedResult(operation, { error });
  }
  return trackedResult(operation, { receipt });
}

const DRAFT_KEY = 'fao-stable-client:create-draft:v1';
const PREPARED_KEY = 'fao-stable-client:create-plan:v1';
const MAX_AGENT_PAYMENT_VIEWS = 100;
const MAX_AGENT_RENDERED_RECORDS = 100;
// Display curation is intentionally independent from permissionless registrar state.
const CURATED_INSTANCES = Object.freeze([]);
export const PINNED_DEPENDENCIES = Object.freeze({
  proxyFactory: Object.freeze({ target: '0x4b4f7f64be813ccc66aefc3bfce2baa01188631c', codehash: '0x9d58d183bb98c199c270f0f2ba7c0abbda1a119caef4c136e137bbacca8c4035' }),
  spaceImplementation: Object.freeze({ target: '0xc3031a7d3326e47d49bff9d374d74f364b29ce4d', codehash: '0x4f2f90c70374b7dcd468d351747e9c865efc0d47e606eb6fdaeb2a842c148d81' }),
  proposalValidationStrategy: Object.freeze({ target: '0x9a39194f870c410633c170889e9025fba2113c79', codehash: '0xddd4560ead7f2c3de35f37de8d50c43e57f0173ad3eefd20098c3b6e08cba9d8' }),
  weth: Object.freeze({ target: '0xfff9976782d46cc05630d1f6ebab18b2324d6b14', codehash: '0xc864e10689f2da18833652a3b075d43106e87f0f90d95ee64f6f0b33bc026083' }),
  conditionalTokens: Object.freeze({ target: '0x8bdc504dc3a05310059c1c67e0a2667309d27b93', codehash: '0x962883a35da553c2d46562f362ba99f68041dad91de30a143a785b2d169c7e81' }),
  wrapped1155Factory: Object.freeze({ target: '0xd194319d1804c1051dd21ba1dc931ca72410b79f', codehash: '0x792e0ae192d66bc58541831991b449cd2ba502fe0053507d6c4493d8865371b6' }),
  uniswapV3Factory: Object.freeze({ target: '0x0227628f3f023bb0b980b67d528571c95c6dac1c', codehash: '0xacb5afea1f8877239fadd30358add13f2f9d4fb80175402c686d392295224fef' }),
  positionManager: Object.freeze({ target: '0x1238536071e1c677a632429e3655c799b22cda52', codehash: '0x390d49631aefbf890c9415457b4639243ff16092ded43ce8f885fde8a5a34868' })
});
const RECEIPT_SELECTORS = Object.freeze({
  coreHash: '0xb1b4fc36',
  flmHash: '0x1092769f',
  coreSealed: '0x73797f98',
  flmSealed: '0xe05abb68',
  vault: '0xfbfa77cf',
  proposalGateway: '0x04e31dfb',
  arbitration: '0x9b732350'
});
const REGISTRAR_RECEIPT_CODE_HASH = '0x831c4e7b';
const GENESIS_STAGED_TOPIC =
  '0x8973a01bba3f334d825bf89174c5a81d41623a8065f3217205ab1a3e59a104f4';
const CORE_SEALED_TOPIC =
  '0x14ff846bb4cfd1fc5532bfd1985c0eb4c21898c217d598c527e99057d0a37e4c';
const FLM_SEALED_TOPIC =
  '0xaddc5fbefc27baeeb76557046cf0702c071bbfb91d131ff9312e6e401d6fe4e1';
const TREASURY_VIEW_SELECTORS = Object.freeze({
  executorFromVault: '0x0d618c81',
  vaultFromExecutor: '0x411557d1',
  vaultFromGateway: '0xfbfa77cf',
  arbitrationFromGateway: '0x9b732350'
});

function exactRecord(value, keys, label) {
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || keys.some((key) => !actual.includes(key))) {
    throw new Error(`${label} must contain exactly: ${keys.join(', ')}.`);
  }
  return value;
}

export function validateCreationBundle(value) {
  exactRecord(value, ['schemaVersion', 'evidence', 'codeHashes', 'creationCodes'], 'Creation bundle');
  if (value.schemaVersion !== 1) throw new Error('Creation bundle schemaVersion must be 1.');
  exactRecord(value.evidence, [
    'economicManifestPath', 'economicManifestKeccak256', 'flmManifestPath', 'flmManifestKeccak256'
  ], 'Creation bundle evidence');
  if (value.evidence.economicManifestPath !== 'metadata/economic-core-code-hashes.json'
    || value.evidence.flmManifestPath !== 'metadata/sepolia-flm-code-hashes.json') {
    throw new Error('Creation bundle evidence paths are not canonical.');
  }
  fao.normalizeHex(value.evidence.economicManifestKeccak256, 32, 'Economic manifest hash');
  fao.normalizeHex(value.evidence.flmManifestKeccak256, 32, 'FLM manifest hash');
  for (const section of [value.codeHashes, value.creationCodes]) {
    exactRecord(section, ['receipt', 'core', 'flm'], 'Creation code section');
    exactRecord(section.core, fao.CORE_CODE_KEYS, 'Core creation codes');
    exactRecord(section.flm, fao.FLM_CODE_KEYS, 'FLM creation codes');
  }
  const verify = (code, expected, label) => {
    const normalized = fao.normalizeHex(code, undefined, `${label} creation code`);
    if (normalized === '0x') throw new Error(`${label} creation code cannot be empty.`);
    const hash = fao.normalizeHex(expected, 32, `${label} creation-code hash`);
    if (fao.keccak256(normalized) !== hash) throw new Error(`${label} creation code does not match its pinned hash.`);
  };
  verify(value.creationCodes.receipt, value.codeHashes.receipt, 'Receipt');
  for (const key of fao.CORE_CODE_KEYS) verify(value.creationCodes.core[key], value.codeHashes.core[key], key);
  for (const key of fao.FLM_CODE_KEYS) verify(value.creationCodes.flm[key], value.codeHashes.flm[key], key);
  return Object.freeze(value);
}

function chainId(value, label) {
  if (value == null) return null;
  try {
    return fao.assertChainId(value);
  } catch {
    throw new Error(`${label} returned an invalid chain ID.`);
  }
}

export function deriveNetworkGate({
  deploymentStatus,
  account = null,
  walletChainId = null,
  rpcChainId = null,
  codeState = 'unchecked'
}) {
  if (deploymentStatus === 'pre-deployment') {
    return Object.freeze({
      state: 'pre-deployment',
      canTransact: false,
      message: 'The fresh FAO deployment has not been published. Drafting and exact ragequit planning remain available.'
    });
  }
  if (deploymentStatus !== 'active') {
    return Object.freeze({ state: 'invalid-manifest', canTransact: false, message: 'The deployment manifest is invalid.' });
  }
  if (!account) {
    return Object.freeze({ state: 'disconnected', canTransact: false, message: 'Connect a wallet to verify Sepolia and runtime code.' });
  }

  const wallet = chainId(walletChainId, 'Wallet');
  const rpc = chainId(rpcChainId, 'RPC');
  if (wallet == null || rpc == null) {
    return Object.freeze({ state: 'checking', canTransact: false, message: 'Waiting for both wallet and RPC chain checks.' });
  }
  if (wallet !== rpc) {
    return Object.freeze({
      state: 'rpc-disagreement',
      canTransact: false,
      message: `RPC disagreement: wallet reports ${wallet}; net_version reports ${rpc}.`
    });
  }
  if (wallet !== SEPOLIA_CHAIN_ID) {
    return Object.freeze({
      state: 'wrong-chain',
      canTransact: false,
      message: `Wrong network: expected Sepolia ${SEPOLIA_CHAIN_ID}; received ${wallet}.`
    });
  }
  if (codeState !== 'verified') {
    const message = codeState === 'mismatch'
      ? 'Runtime bytecode does not match the manifest. Transactions are disabled.'
      : 'Runtime bytecode has not been verified.';
    return Object.freeze({ state: `code-${codeState}`, canTransact: false, message });
  }
  return Object.freeze({ state: 'ready', canTransact: true, message: 'Sepolia, RPC agreement, and every manifest runtime hash are verified.' });
}

export async function verifyRuntimeCode(manifest, request, pinnedDependencies = PINNED_DEPENDENCIES) {
  if (manifest.status === 'pre-deployment') return Object.freeze({ status: 'unavailable', checked: Object.freeze([]) });
  if (manifest.status !== 'active') throw new Error('Cannot verify a non-active deployment.');
  if (typeof request !== 'function') throw new Error('An RPC request function is required.');

  const records = {
    ...selfServeRuntimeRecords(manifest),
    ...Object.fromEntries(Object.entries(pinnedDependencies).map(([name, dependency]) => [name, {
      address: dependency.target,
      runtimeCodeKeccak256: dependency.codehash
    }]))
  };
  const checked = await Promise.all(Object.entries(records).map(async ([name, record]) => {
    const expected = fao.normalizeHex(record.runtimeCodeKeccak256, 32, `${name} runtime hash`);
    const code = fao.normalizeHex(await request('eth_getCode', [record.address, 'latest']), undefined, `${name} runtime code`);
    if (code === '0x') throw new Error(`${name} has no runtime code.`);
    const actual = fao.keccak256(code);
    if (actual !== expected) throw new Error(`${name} runtime bytecode does not match the manifest.`);
    return name;
  }));
  return Object.freeze({ status: 'verified', checked: Object.freeze(checked) });
}

function addressFromWord(value, label) {
  const word = fao.normalizeHex(value, 32, label);
  if (word.slice(2, 26) !== '0'.repeat(24)) throw new Error(`${label} returned a malformed address.`);
  return fao.normalizeAddress(`0x${word.slice(-40)}`);
}

function uintFromWord(value, label, bits = 256) {
  const word = fao.normalizeHex(value, 32, label);
  const number = BigInt(word);
  if (number >= (1n << BigInt(bits))) throw new Error(`${label} does not fit uint${bits}.`);
  return number;
}

function rpcQuantity(value, label) {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    throw new Error(`${label} is not a canonical RPC quantity.`);
  }
  return BigInt(value);
}

export async function readBuybackModel(value) {
  const input = exactRecord(value, ['chainId', 'vault', 'executor', 'request'], 'Buyback read input');
  fao.assertChainId(input.chainId, fao.BUYBACK_CHAIN_ID);
  const vault = fao.normalizeAddress(input.vault);
  const executor = fao.normalizeAddress(input.executor);
  if (typeof input.request !== 'function') throw new Error('An RPC request function is required.');

  const block = await input.request('eth_getBlockByNumber', ['latest', false]);
  if (!block || typeof block.number !== 'string' || typeof block.timestamp !== 'string') {
    throw new Error('RPC returned an invalid latest block.');
  }
  const blockTag = block.number;
  const blockNumber = rpcQuantity(blockTag, 'Buyback block number');
  const timestamp = rpcQuantity(block.timestamp, 'Buyback block timestamp');
  const call = (to, data) => input.request('eth_call', [{ to, data }, blockTag]);
  const selectors = fao.BUYBACK_SELECTORS;
  const [wethWord, phase, effectiveSupply, buybackWindow, buybackDailyCap,
    buybackDailyBps, buybackNavBps, buybackTwapWindow, buybackMaxTickDeviation,
    buybackWindowStart, buybackWethSpent] = await Promise.all([
    call(vault, selectors.weth),
    call(vault, selectors.phase),
    call(vault, selectors.effectiveSupply),
    call(executor, selectors.window),
    call(executor, selectors.dailyCap),
    call(executor, selectors.dailyBps),
    call(executor, selectors.navBps),
    call(executor, selectors.twapWindow),
    call(executor, selectors.maxTickDeviation),
    call(executor, selectors.windowStart),
    call(executor, selectors.wethSpent)
  ]);
  const weth = addressFromWord(wethWord, 'vault.WETH');
  const executorWeth = await call(
    weth, fao.encodeCalldata(selectors.balanceOf, [fao.addressWord(executor)])
  );
  return Object.freeze({ blockNumber, ...fao.deriveBuybackModel({
    timestamp,
    phase: uintFromWord(phase, 'vault.phase', 8),
    executorWeth: uintFromWord(executorWeth, 'WETH.balanceOf(executor)'),
    effectiveSupply: uintFromWord(effectiveSupply, 'vault.effectiveSupply'),
    buybackWindowStart: uintFromWord(buybackWindowStart, 'executor.buybackWindowStart', 64),
    buybackWethSpent: uintFromWord(buybackWethSpent, 'executor.buybackWethSpent', 192),
    buybackWindow: uintFromWord(buybackWindow, 'executor.BUYBACK_WINDOW'),
    buybackDailyCap: uintFromWord(buybackDailyCap, 'executor.BUYBACK_DAILY_CAP'),
    buybackDailyBps: uintFromWord(buybackDailyBps, 'executor.BUYBACK_DAILY_BPS'),
    buybackNavBps: uintFromWord(buybackNavBps, 'executor.BUYBACK_NAV_BPS'),
    buybackTwapWindow: uintFromWord(buybackTwapWindow, 'executor.BUYBACK_TWAP_WINDOW', 32),
    buybackMaxTickDeviation: uintFromWord(
      buybackMaxTickDeviation, 'executor.BUYBACK_MAX_TICK_DEVIATION', 23
    )
  }) });
}

function assertBuybackStateCoversReceipt(model, receipt, operation) {
  if (!model || typeof model.blockNumber !== 'bigint') {
    throw new Error('Buyback current-state read did not expose its block number.');
  }
  let receiptBlock;
  if (receipt?.blockNumber != null) {
    receiptBlock = rpcQuantity(receipt.blockNumber, 'Buyback receipt block number');
  } else if (typeof operation?.receiptBlockNumber === 'string'
    && /^(?:0|[1-9][0-9]*)$/.test(operation.receiptBlockNumber)) {
    receiptBlock = BigInt(operation.receiptBlockNumber);
  } else {
    throw new Error('Resolved buyback receipt did not expose its block number.');
  }
  if (model.blockNumber < receiptBlock) {
    throw new Error('Buyback current-state read predates the resolved transaction receipt.');
  }
}

export async function verifyTreasuryManifest(manifest, request, pinnedBlock = null) {
  if (typeof request !== 'function') throw new Error('An RPC request function is required.');
  const records = treasuryRuntimeRecords(validateTreasuryManifest(manifest));
  const block = pinnedBlock || await request('eth_getBlockByNumber', ['finalized', false]);
  if (!block || typeof block !== 'object') throw new Error('RPC returned no pinned finalized block.');
  const blockNumber = rpcQuantity(block.number, 'Treasury pinned block number');
  const blockHash = fao.normalizeHex(block.hash, 32, 'Treasury pinned block hash');
  const timestamp = rpcQuantity(block.timestamp, 'Treasury pinned block timestamp');
  const blockTag = `0x${blockNumber.toString(16)}`;
  const call = (to, data) => request('eth_call', [{ to, data }, blockTag]);
  const [vaultCode, gatewayCode, arbitrationCode, executorCode,
    executorFromVault, vaultFromExecutor, vaultFromGateway, arbitrationFromGateway] =
    await Promise.all([
      request('eth_getCode', [records.vault, blockTag]),
      request('eth_getCode', [records.gateway, blockTag]),
      request('eth_getCode', [records.arbitration, blockTag]),
      request('eth_getCode', [records.executor, blockTag]),
      call(records.vault, TREASURY_VIEW_SELECTORS.executorFromVault),
      call(records.executor, TREASURY_VIEW_SELECTORS.vaultFromExecutor),
      call(records.gateway, TREASURY_VIEW_SELECTORS.vaultFromGateway),
      call(records.gateway, TREASURY_VIEW_SELECTORS.arbitrationFromGateway)
    ]);
  for (const [label, code_, expected] of [
    ['vault', vaultCode, records.vaultRuntimeCodeKeccak256],
    ['proposal gateway', gatewayCode, records.gatewayRuntimeCodeKeccak256],
    ['arbitration', arbitrationCode, records.arbitrationRuntimeCodeKeccak256],
    ['executor', executorCode, records.executorRuntimeCodeKeccak256]
  ]) {
    const code = fao.normalizeHex(code_, undefined, `Treasury ${label} runtime code`);
    if (code === '0x' || fao.keccak256(code) !== expected) {
      throw new Error(`Treasury ${label} runtime bytecode does not match the economic manifest.`);
    }
  }
  if (addressFromWord(executorFromVault, 'vault.TREASURY_EXECUTOR') !== records.executor
    || addressFromWord(vaultFromExecutor, 'executor.VAULT') !== records.vault
    || addressFromWord(vaultFromGateway, 'gateway.vault') !== records.vault
    || addressFromWord(arbitrationFromGateway, 'gateway.arbitration') !== records.arbitration) {
    throw new Error('Treasury vault, executor, gateway, and arbitration wiring does not match the manifest.');
  }
  const after = await request('eth_getBlockByNumber', [blockTag, false]);
  if (!after || fao.normalizeHex(after.hash, 32, 'Re-read treasury block hash') !== blockHash) {
    throw new Error('Finalized block hash changed during treasury verification.');
  }
  return Object.freeze({
    status: 'verified', ...records, blockNumber, blockHash, timestamp, blockTag
  });
}

export async function verifyAgentWorkProvenance(value) {
  const input = exactRecord(value, [
    'manifest', 'selfServeManifest', 'creationBundle', 'indexView', 'request'
  ], 'Agent-work provenance input');
  if (typeof input.request !== 'function') throw new Error('An RPC request function is required.');
  const manifest = validateTreasuryManifest(input.manifest);
  if (manifest.creationRoute !== 'registrar') {
    throw new Error('Positive agent-work lifecycle status requires canonical registrar provenance.');
  }
  const { explorer: _explorer, status: normalizedStatus, ...sharedFields } = input.selfServeManifest;
  const sharedInput = normalizedStatus === 'pre-deployment'
    ? { ...sharedFields, status: normalizedStatus }
    : sharedFields;
  const shared = validateSelfServeManifest(sharedInput);
  if (shared.status !== 'active') throw new Error('The canonical ownerless registrar is not deployed.');
  const bundle = validateCreationBundle(input.creationBundle);
  const view = input.indexView;
  if (!view || typeof view !== 'object') throw new Error('A pinned AgentWorkIndex view is required.');
  const blockNumber = BigInt(view.blockNumber);
  const blockTag = `0x${blockNumber.toString(16)}`;
  const blockHash = fao.normalizeHex(view.blockHash, 32, 'Agent-work pinned block hash');
  const receipt = manifest.receipt;
  const registrar = shared.registrar;
  if (receipt.registrar.target !== registrar.address
    || receipt.registrar.runtimeCodeKeccak256 !== registrar.runtimeCodeKeccak256) {
    throw new Error('Economic receipt does not bind the canonical self-serve registrar.');
  }
  const receiptBaseCode = fao.normalizeHex(
    bundle.creationCodes.receipt, undefined, 'Embedded receipt creation code'
  );
  if ((receiptBaseCode.length - 2) / 2 !== receipt.creationCodeBytes
    || fao.keccak256(receiptBaseCode) !== receipt.creationCodeKeccak256) {
    throw new Error('Economic receipt does not bind the embedded receipt base blob.');
  }
  // JSON numbers above 2^53 are not lossless in browsers. The stable client verifies the
  // hash-sealed deployment and wiring; FAO's Python validator verifies the full config preimage.
  const hashes = Object.freeze({ core: receipt.coreConfigHash, flm: receipt.flmConfigHash });
  const expectedDependencies = {
    ...PINNED_DEPENDENCIES,
    proposalImplementation: {
      target: shared.prerequisites.proposalImplementation.address,
      codehash: shared.prerequisites.proposalImplementation.runtimeCodeKeccak256
    },
    stackDeployer: {
      target: shared.prerequisites.stackDeployer.address,
      codehash: shared.prerequisites.stackDeployer.runtimeCodeKeccak256
    }
  };
  for (const [key, expected] of Object.entries(expectedDependencies)) {
    const actual = key === 'positionManager' ? manifest.flmConfig.positionManager : manifest.coreConfig[key];
    if (!actual || fao.normalizeAddress(actual.target) !== expected.target
      || Object.keys(actual).length !== 2
      || !Object.hasOwn(actual, 'runtimeCodeKeccak256')
      || fao.normalizeHex(
        actual.runtimeCodeKeccak256, 32, `${key} configured runtime code hash`
      ) !== expected.codehash) {
      throw new Error(`Economic receipt does not bind the stable client's canonical ${key}.`);
    }
  }
  const call = (to, data) => input.request('eth_call', [{ to, data }, blockTag]);
  const [registrarCode, proposalCode, stackCode, registrarReceiptHash, predictedWord] = await Promise.all([
    input.request('eth_getCode', [registrar.address, blockTag]),
    input.request('eth_getCode', [shared.prerequisites.proposalImplementation.address, blockTag]),
    input.request('eth_getCode', [shared.prerequisites.stackDeployer.address, blockTag]),
    call(registrar.address, REGISTRAR_RECEIPT_CODE_HASH),
    call(registrar.address, fao.predictCalldata(hashes.core, hashes.flm, receiptBaseCode))
  ]);
  const normalizedRegistrarCode = fao.normalizeHex(
    registrarCode, undefined, 'Canonical registrar runtime code'
  );
  if (normalizedRegistrarCode === '0x'
    || fao.keccak256(normalizedRegistrarCode) !== registrar.runtimeCodeKeccak256) {
    throw new Error('Canonical registrar runtime bytecode does not match selfserve-deployment.json.');
  }
  for (const [label, code_, record] of [
    ['proposal implementation', proposalCode, shared.prerequisites.proposalImplementation],
    ['stack deployer', stackCode, shared.prerequisites.stackDeployer]
  ]) {
    const code = fao.normalizeHex(code_, undefined, `Canonical ${label} runtime code`);
    if (code === '0x' || fao.keccak256(code) !== record.runtimeCodeKeccak256) {
      throw new Error(`Canonical ${label} runtime bytecode does not match selfserve-deployment.json.`);
    }
  }
  if (fao.normalizeHex(registrarReceiptHash, 32, 'Registrar receipt base hash')
    !== fao.keccak256(receiptBaseCode)) {
    throw new Error('Canonical registrar immutable receipt hash does not match the embedded blob.');
  }
  if (addressFromWord(predictedWord, 'Registrar predicted receipt') !== receipt.address) {
    throw new Error('Economic receipt is not the canonical registrar CREATE2 prediction.');
  }
  const stageBlock = BigInt(manifest.transactions.receiptCreate.block);
  if (stageBlock > blockNumber) throw new Error('Receipt staging postdates the pinned finalized block.');
  const stageTag = `0x${stageBlock.toString(16)}`;
  const stageLogs = await input.request('eth_getLogs', [{
    address: registrar.address,
    fromBlock: stageTag,
    toBlock: stageTag,
    topics: [
      GENESIS_STAGED_TOPIC,
      `0x${fao.addressWord(receipt.address)}`,
      receipt.coreConfigHash,
      receipt.flmConfigHash
    ]
  }]);
  if (!Array.isArray(stageLogs) || stageLogs.length !== 1) {
    throw new Error('Canonical GenesisStaged provenance log is missing or ambiguous.');
  }
  const stageLog = stageLogs[0];
  rpcQuantity(stageLog.logIndex, 'GenesisStaged log index');
  const stageBlockEvidence = await input.request('eth_getBlockByNumber', [stageTag, false]);
  const expectedStageTopics = [
    GENESIS_STAGED_TOPIC,
    `0x${fao.addressWord(receipt.address)}`,
    receipt.coreConfigHash,
    receipt.flmConfigHash
  ];
  if (!stageBlockEvidence || stageLog.removed === true
    || fao.normalizeAddress(stageLog.address) !== registrar.address
    || !Array.isArray(stageLog.topics) || stageLog.topics.length !== expectedStageTopics.length
    || stageLog.topics.some((topic, index) => (
      fao.normalizeHex(topic, 32, `GenesisStaged topic ${index}`) !== expectedStageTopics[index]
    ))
    || fao.normalizeHex(stageLog.blockHash, 32, 'GenesisStaged block hash')
      !== fao.normalizeHex(stageBlockEvidence.hash, 32, 'GenesisStaged canonical block hash')
    || BigInt(stageLog.blockNumber) !== stageBlock
    || fao.normalizeHex(stageLog.transactionHash, 32, 'GenesisStaged transaction hash')
      !== manifest.transactions.receiptCreate.hash
    || addressFromWord(stageLog.data, 'GenesisStaged stager')
      !== manifest.transactions.receiptCreate.from) {
    throw new Error('GenesisStaged event does not match canonical transaction provenance.');
  }
  for (const spec of [
    {
      label: 'CoreSealed',
      topic: CORE_SEALED_TOPIC,
      transaction: manifest.transactions.deployCore,
      topics: [
        CORE_SEALED_TOPIC,
        `0x${fao.addressWord(manifest.contracts.vault)}`,
        `0x${fao.addressWord(manifest.contracts.companyToken)}`,
        `0x${fao.addressWord(manifest.contracts.space)}`
      ],
      data: `0x${[
        manifest.contracts.arbitration, manifest.contracts.evaluator, manifest.contracts.spotPool
      ].map((address) => fao.addressWord(address)).join('')}`
    },
    {
      label: 'FlmSealed',
      topic: FLM_SEALED_TOPIC,
      transaction: manifest.transactions.deployFlm,
      topics: [FLM_SEALED_TOPIC, `0x${fao.addressWord(manifest.contracts.manager)}`],
      data: `0x${[
        manifest.contracts.relay, manifest.contracts.spotAdapter
      ].map((address) => fao.addressWord(address)).join('')}`
    }
  ]) {
    const eventBlock = BigInt(spec.transaction.block);
    if (eventBlock > blockNumber) throw new Error(`${spec.label} postdates the pinned finalized block.`);
    const eventTag = `0x${eventBlock.toString(16)}`;
    const [logs, canonicalBlock] = await Promise.all([
      input.request('eth_getLogs', [{
        address: receipt.address,
        fromBlock: eventTag,
        toBlock: eventTag,
        topics: [spec.topic]
      }]),
      input.request('eth_getBlockByNumber', [eventTag, false])
    ]);
    const log = Array.isArray(logs) && logs.length === 1 ? logs[0] : null;
    if (log) rpcQuantity(log.logIndex, `${spec.label} log index`);
    if (!log || !canonicalBlock || log.removed === true
      || fao.normalizeAddress(log.address) !== receipt.address
      || BigInt(log.blockNumber) !== eventBlock
      || fao.normalizeHex(log.blockHash, 32, `${spec.label} block hash`)
        !== fao.normalizeHex(canonicalBlock.hash, 32, `${spec.label} canonical block hash`)
      || fao.normalizeHex(log.transactionHash, 32, `${spec.label} transaction hash`)
        !== spec.transaction.hash
      || !Array.isArray(log.topics) || log.topics.length !== spec.topics.length
      || log.topics.some((topic, index) => (
        fao.normalizeHex(topic, 32, `${spec.label} topic ${index}`) !== spec.topics[index]
      ))
      || fao.normalizeHex(log.data, spec.data.length / 2 - 1, `${spec.label} data`) !== spec.data) {
      throw new Error(`${spec.label} event does not match canonical receipt provenance.`);
    }
  }
  const [receiptCode, coreHash, flmHash, coreSealed, flmSealed,
    receiptVault, receiptGateway, receiptArbitration] = await Promise.all([
    input.request('eth_getCode', [receipt.address, blockTag]),
    call(receipt.address, RECEIPT_SELECTORS.coreHash),
    call(receipt.address, RECEIPT_SELECTORS.flmHash),
    call(receipt.address, RECEIPT_SELECTORS.coreSealed),
    call(receipt.address, RECEIPT_SELECTORS.flmSealed),
    call(receipt.address, RECEIPT_SELECTORS.vault),
    call(receipt.address, RECEIPT_SELECTORS.proposalGateway),
    call(receipt.address, RECEIPT_SELECTORS.arbitration)
  ]);
  if (fao.normalizeHex(receiptCode, undefined, 'Receipt runtime code') === '0x'
    || fao.normalizeHex(coreHash, 32, 'Receipt core hash') !== hashes.core
    || fao.normalizeHex(flmHash, 32, 'Receipt FLM hash') !== hashes.flm
    || uintFromWord(coreSealed, 'Receipt coreSealed') !== 1n
    || uintFromWord(flmSealed, 'Receipt flmSealed') !== 1n) {
    throw new Error('Canonical receipt code or sealed commitments do not match.');
  }
  const records = treasuryRuntimeRecords(manifest);
  if (addressFromWord(receiptVault, 'Receipt vault') !== records.vault
    || addressFromWord(receiptGateway, 'Receipt proposal gateway') !== records.gateway
    || addressFromWord(receiptArbitration, 'Receipt arbitration') !== records.arbitration) {
    throw new Error('Canonical receipt lifecycle wiring does not match the economic manifest.');
  }
  const verified = await verifyTreasuryManifest(manifest, input.request, {
    number: blockTag,
    hash: blockHash,
    timestamp: `0x${BigInt(view.timestamp).toString(16)}`
  });
  const after = await input.request('eth_getBlockByNumber', [blockTag, false]);
  if (!after || fao.normalizeHex(after.hash, 32, 'Re-read provenance block hash') !== blockHash) {
    throw new Error('Finalized block hash changed during registrar provenance verification.');
  }
  return Object.freeze({ ...verified, receipt: receipt.address, registrar: registrar.address });
}

export function creationInputFromDraft(draft, manifest, currentTimestamp) {
  if (manifest.status !== 'active') throw new Error('The canonical self-serve registrar is not deployed.');
  exactRecord(draft, [
    'tokenName', 'tokenSymbol', 'governedRepository', 'governedSite', 'saleDuration',
    'bootstrapDuration', 'saleCap', 'initialPrice', 'slope', 'minimumRaise',
    'tokenMaxSupply', 'bootstrapBps', 'daoURI', 'metadataURI',
    'votingStrategyMetadataURI', 'proposalValidationStrategyMetadataURI'
  ], 'Creation draft');
  const timestamp = BigInt(currentTimestamp);
  const saleEnd = timestamp + BigInt(draft.saleDuration);
  const bootstrapDeadline = saleEnd + BigInt(draft.bootstrapDuration);
  const dependency = (record) => ({ target: record.address, codehash: record.runtimeCodeKeccak256 });
  return Object.freeze({
    registrar: manifest.registrar.address,
    currentTimestamp: timestamp.toString(),
    coreConfig: Object.freeze({
      proxyFactory: PINNED_DEPENDENCIES.proxyFactory,
      spaceImplementation: PINNED_DEPENDENCIES.spaceImplementation,
      proposalValidationStrategy: PINNED_DEPENDENCIES.proposalValidationStrategy,
      stackDeployer: dependency(manifest.prerequisites.stackDeployer),
      proposalImplementation: dependency(manifest.prerequisites.proposalImplementation),
      weth: PINNED_DEPENDENCIES.weth,
      conditionalTokens: PINNED_DEPENDENCIES.conditionalTokens,
      wrapped1155Factory: PINNED_DEPENDENCIES.wrapped1155Factory,
      uniswapV3Factory: PINNED_DEPENDENCIES.uniswapV3Factory,
      graduationThreshold: '1000000000000000',
      arbitrationTimeout: '1800',
      siteMinActivationBond: '100000000000000',
      treasuryMinActivationBond: '100000000000000',
      assetPolicies: Object.freeze([Object.freeze({
        asset: PINNED_DEPENDENCIES.weth.target,
        c1: '10000000000000000',
        c2: '100000000000000000',
        tapBudget: '10000000000000000',
        tapBudgetMax: '100000000000000000'
      })]),
      twapTimeout: '1800',
      twapWindow: '900',
      spaceSaltNonce: timestamp.toString(),
      daoURI: draft.daoURI,
      metadataURI: draft.metadataURI,
      votingStrategyMetadataURI: draft.votingStrategyMetadataURI,
      proposalValidationStrategyMetadataURI: draft.proposalValidationStrategyMetadataURI,
      tokenName: draft.tokenName,
      tokenSymbol: draft.tokenSymbol,
      saleEnd: saleEnd.toString(),
      bootstrapDeadline: bootstrapDeadline.toString(),
      saleCap: draft.saleCap,
      minimumRaise: draft.minimumRaise,
      tokenMaxSupply: draft.tokenMaxSupply,
      initialPrice: draft.initialPrice,
      slope: draft.slope,
      bootstrapBps: draft.bootstrapBps
    }),
    grants: Object.freeze([]),
    flmConfig: Object.freeze({ positionManager: PINNED_DEPENDENCIES.positionManager })
  });
}

function normalizeInstance(instance) {
  if (!instance || Array.isArray(instance) || typeof instance !== 'object') throw new Error('Invalid registrar instance.');
  const address = fao.normalizeAddress(instance.address);
  const name = typeof instance.name === 'string' && instance.name.trim()
    ? instance.name.trim().slice(0, 120)
    : `${address.slice(0, 8)}…${address.slice(-6)}`;
  return Object.freeze({
    address,
    name,
    curated: instance.curated === true,
    codeVerified: instance.codeVerified === true
  });
}

export function instanceTrustLabel(instance) {
  if (instance.curated) return 'Curated client listing · code status shown separately · not organization endorsement';
  if (instance.codeVerified) return 'Runtime code verified · not organization endorsement';
  return 'Unverified registrar record · not organization endorsement';
}

export function visibleInstances(instances, showUnverified = false) {
  if (!Array.isArray(instances)) throw new Error('Registrar instances must be an array.');
  return instances.map(normalizeInstance).filter((instance) => (
    showUnverified || instance.curated || instance.codeVerified
  ));
}

export function parseExtraAssetInput(value) {
  if (typeof value !== 'string') throw new Error('Additional assets must be text.');
  const addresses = value.split(/[\s,]+/).filter(Boolean);
  return fao.normalizeRagequitExtras(addresses);
}

function errorMessage(error) {
  return String(error?.data?.message || error?.cause?.message || error?.message || 'The operation failed.').slice(0, 600);
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

let elements;
let state = {
  manifest: null,
  account: null,
  walletChainId: null,
  rpcChainId: null,
  codeState: 'unchecked',
  codeMessage: 'Not checked',
  creationBundle: null,
  instances: [],
  ragequitPlan: null,
  preparedInput: null,
  creationPlan: null,
  predictedReceipt: null,
  receiptExists: false,
  coreSealed: false,
  flmSealed: false,
  treasuryManifest: null,
  treasuryRecords: null,
  treasuryFlow: null,
  treasuryFlowForm: null,
  treasuryFlowRequest: null,
  buybackModel: null,
  buybackActionState: BUYBACK_ACTION_STATES.refreshNeeded,
  agentWork: null
};
const agentWorkRequests = latestRequestGate();
const buybackRequests = latestRequestGate();
const buybackRefreshRequests = latestRequestGate();
const connectionRequests = latestRequestGate();
const creationPlanRequests = latestRequestGate();
const receiptStateRequests = latestRequestGate();
const treasuryFlowRequests = latestRequestGate();
const treasuryManifestRequests = latestRequestGate();
const trackedOperations = trackedOperationController({
  onChange: () => {
    if (!elements?.operationJournal) return;
    renderOperationJournal();
    if (elements.stageButtons) renderStages();
    if (elements.treasuryForms) renderTreasuryGate();
  }
});

function rpc(method, params = []) {
  if (!window.ethereum) throw new Error('No injected wallet was detected.');
  return window.ethereum.request({ method, params });
}

function currentGate() {
  return deriveNetworkGate({
    deploymentStatus: state.manifest?.status,
    account: state.account,
    walletChainId: state.walletChainId,
    rpcChainId: state.rpcChainId,
    codeState: state.codeState
  });
}

function setMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function agentWorkInputSnapshot() {
  return JSON.stringify([
    state.account,
    state.walletChainId?.toString() || null,
    state.rpcChainId?.toString() || null,
    elements.treasuryManifestForm.elements.manifest.value,
    [...new FormData(elements.agentWorkForm).entries()]
  ]);
}

function treasuryManifestInputSnapshot() {
  return JSON.stringify([
    state.account,
    state.walletChainId?.toString() || null,
    state.rpcChainId?.toString() || null,
    elements.treasuryManifestForm.elements.manifest.value
  ]);
}

function buybackRefreshInputSnapshot() {
  return JSON.stringify([
    treasuryManifestInputSnapshot(),
    state.treasuryRecords?.vault || null,
    state.treasuryRecords?.executor || null
  ]);
}

function treasuryFlowInputSnapshot(form) {
  return JSON.stringify([
    form.id,
    state.treasuryRecords?.vault || null,
    state.treasuryRecords?.gateway || null,
    state.treasuryRecords?.executor || null,
    [...new FormData(form).entries()]
  ]);
}

function creationPlanInputSnapshot() {
  return JSON.stringify([
    state.account,
    state.walletChainId?.toString() || null,
    state.rpcChainId?.toString() || null,
    state.codeState,
    [...new FormData(elements.createForm).entries()]
  ]);
}

function receiptStateSnapshot(plan = state.creationPlan, predictedReceipt = state.predictedReceipt) {
  return plan && predictedReceipt
    ? JSON.stringify([
      state.account,
      state.walletChainId?.toString() || null,
      state.rpcChainId?.toString() || null,
      predictedReceipt,
      plan.hashes.core,
      plan.hashes.flm
    ])
    : null;
}

function renderGate() {
  const gate = currentGate();
  elements.connectionBadge.textContent = gate.state.replaceAll('-', ' ');
  elements.connectionBadge.className = `status ${gate.canTransact ? 'verified' : gate.state.includes('wrong') || gate.state.includes('mismatch') || gate.state.includes('invalid') || gate.state.includes('disagreement') ? 'error' : 'unverified'}`;
  elements.deploymentState.textContent = state.manifest?.status || 'Manifest error';
  elements.walletAccount.textContent = state.account || 'Not connected';
  elements.walletChain.textContent = state.walletChainId == null ? '—' : String(state.walletChainId);
  elements.rpcChain.textContent = state.rpcChainId == null ? '—' : String(state.rpcChainId);
  elements.codeState.textContent = state.codeMessage;
  elements.creationCodeState.textContent = state.creationBundle ? '12 / 12 creation blobs verified' : 'Unavailable';
  elements.refresh.disabled = !window.ethereum;
  elements.preparePlan.disabled = !gate.canTransact || !state.creationBundle;
  for (const button of document.querySelectorAll('[data-write]')) {
    if (button.hasAttribute('data-stage')) continue;
    const needsCreationBundle = button.hasAttribute('data-stage');
    button.disabled = !gate.canTransact || (needsCreationBundle && !state.creationBundle)
      || (button === elements.executeRagequit && !state.ragequitPlan);
  }
  setMessage(elements.connectionMessage, gate.message, gate.state.includes('wrong') || gate.state.includes('mismatch') || gate.state.includes('invalid') || gate.state.includes('disagreement'));
  if (elements.stageButtons) renderStages();
  if (elements.treasuryForms) renderTreasuryGate();
}

function treasuryNetworkReady() {
  return state.account && state.walletChainId === SEPOLIA_CHAIN_ID
    && state.rpcChainId === SEPOLIA_CHAIN_ID && state.treasuryRecords;
}

function buybackOperationOwnsCurrentCard(operation) {
  if (!operation || operation.kind !== 'buyback' || !state.account || !state.treasuryRecords
    || state.walletChainId !== SEPOLIA_CHAIN_ID || state.rpcChainId !== SEPOLIA_CHAIN_ID) return false;
  let account;
  try {
    account = fao.normalizeAddress(state.account);
  } catch {
    return false;
  }
  return operation.chainId === SEPOLIA_CHAIN_ID.toString()
    && operation.account === account
    && operation.vault === state.treasuryRecords.vault;
}

function resetBuybackCard(message) {
  setBuybackActionState(BUYBACK_ACTION_STATES.refreshNeeded);
  setMessage(elements.buybackStatus, message);
}

function alignBuybackCardWithPending() {
  const operation = trackedOperations.pending('buyback');
  if (!operation) return false;
  if (!buybackOperationOwnsCurrentCard(operation)) {
    resetBuybackCard(
      'A separately captured buyback operation remains in the transaction journal. This treasury card is not labeled with that operation.'
    );
    return true;
  }
  if (operation.state === TRACKED_OPERATION_STATES.submitted) {
    setBuybackActionState(BUYBACK_ACTION_STATES.submittedUnknown);
    setMessage(
      elements.buybackStatus,
      `${operation.label} submitted: ${operation.hash}. Its receipt remains unknown; refresh to reconcile before retry.`,
      true
    );
  } else {
    setBuybackActionState(BUYBACK_ACTION_STATES.inFlight);
    setMessage(
      elements.buybackStatus,
      `${operation.label}: the captured wallet request has not returned a transaction hash. No retry is enabled.`,
      Boolean(operation.error)
    );
  }
  return true;
}

function renderTreasuryGate() {
  const enabled = Boolean(treasuryNetworkReady());
  const pendingBuyback = trackedOperations.pending('buyback');
  const canReconcileBuyback = pendingBuyback?.state === TRACKED_OPERATION_STATES.submitted
    && state.walletChainId?.toString() === pendingBuyback.chainId
    && state.rpcChainId?.toString() === pendingBuyback.chainId;
  for (const form of elements.treasuryForms) form.querySelector('button[type="submit"]').disabled = !enabled;
  for (const button of elements.treasurySteps.querySelectorAll('button')) {
    button.disabled = !enabled || Boolean(trackedOperations.pending('treasury'));
  }
  elements.refreshBuyback.disabled = (!enabled && !canReconcileBuyback)
    || state.buybackActionState === BUYBACK_ACTION_STATES.inFlight;
  elements.executeBuyback.disabled = !enabled || !state.buybackModel?.canSubmit
    || Boolean(pendingBuyback)
    || state.buybackActionState !== BUYBACK_ACTION_STATES.ready;
}

function invalidateTreasuryFlow(message = '') {
  treasuryFlowRequests.invalidate();
  state.treasuryFlow = null;
  state.treasuryFlowForm = null;
  state.treasuryFlowRequest = null;
  elements.treasuryPlan.hidden = true;
  elements.treasuryAcceptance.textContent = '';
  elements.treasurySteps.replaceChildren();
  renderTreasuryGate();
  if (message) setMessage(elements.treasuryStatus, message);
}

function setBuybackActionState(next) {
  if (!Object.values(BUYBACK_ACTION_STATES).includes(next)) throw new Error('Invalid buyback action state.');
  state.buybackActionState = next;
  elements.buybackTransactionState.textContent = {
    [BUYBACK_ACTION_STATES.refreshNeeded]: 'Refresh needed',
    [BUYBACK_ACTION_STATES.ready]: 'Ready to submit',
    [BUYBACK_ACTION_STATES.inFlight]: 'Transaction in flight',
    [BUYBACK_ACTION_STATES.submittedUnknown]: 'Submitted · receipt unknown',
    [BUYBACK_ACTION_STATES.confirmedRefreshNeeded]: 'Confirmed · refresh needed'
  }[next];
  renderTreasuryGate();
}

function format18(value) {
  if (value == null) return '—';
  const number = BigInt(value);
  const whole = number / (10n ** 18n);
  const fraction = (number % (10n ** 18n)).toString().padStart(18, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''}`;
}

function formatTimestamp(value) {
  const milliseconds = BigInt(value) * 1000n;
  if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return String(value);
  const date = new Date(Number(milliseconds));
  return Number.isNaN(date.valueOf()) ? String(value) : date.toISOString();
}

function renderBuybackModel() {
  const model = state.buybackModel;
  elements.buybackPhase.textContent = model ? (model.isLive ? 'LIVE' : `Not LIVE (phase ${model.phase})`) : '—';
  elements.buybackWeth.textContent = model ? `${format18(model.executorWeth)} WETH` : '—';
  elements.buybackSupply.textContent = model ? `${format18(model.effectiveSupply)} FAO` : '—';
  elements.buybackNav.textContent = model?.navWethPerTokenWad == null
    ? '—'
    : `${format18(model.navWethPerTokenWad)} WETH (95%: ${format18(model.triggerWethPerTokenWad)})`;
  elements.buybackSpent.textContent = model
    ? `${format18(model.actualSpent)} WETH${model.windowActive ? ` · ends ${formatTimestamp(model.windowEndsAt)}` : ' · no active window'}`
    : '—';
  elements.buybackPercentCap.textContent = model ? `${format18(model.percentCap)} WETH` : '—';
  elements.buybackRawCap.textContent = model ? `${format18(model.rawCap)} WETH` : '—';
  elements.buybackAvailable.textContent = model ? `${format18(model.available)} WETH` : '—';
  elements.buybackChecks.replaceChildren();
  if (model) {
    for (const reason of [...model.deterministicReasons, ...model.marketChecks]) {
      const item = document.createElement('li');
      item.textContent = reason;
      elements.buybackChecks.append(item);
    }
  }
  renderTreasuryGate();
}

function renderOperationJournal() {
  const labels = {
    [TRACKED_OPERATION_STATES.preBroadcast]: 'Pre-broadcast verification',
    [TRACKED_OPERATION_STATES.walletRequested]: 'Wallet request invoked · hash pending',
    [TRACKED_OPERATION_STATES.submitted]: 'Submitted · receipt unknown',
    [TRACKED_OPERATION_STATES.confirmed]: 'Confirmed · receipt status 1',
    [TRACKED_OPERATION_STATES.reverted]: 'Reverted · receipt status 0',
    [TRACKED_OPERATION_STATES.cancelled]: 'Cancelled before wallet request',
    [TRACKED_OPERATION_STATES.failed]: 'Failed before transaction hash'
  };
  const entries = trackedOperations.entries();
  elements.operationJournal.replaceChildren();
  elements.operationJournalEmpty.hidden = entries.length !== 0;
  for (const operation of entries) {
    const item = document.createElement('li');
    item.className = 'stage-card';
    const title = document.createElement('strong');
    const identity = document.createElement('code');
    const hash = document.createElement('code');
    const detail = document.createElement('p');
    title.textContent = `${operation.label} · ${labels[operation.state]}`;
    identity.textContent = `chain ${operation.chainId} · ${operation.vault ? `vault ${operation.vault}` : `target ${operation.target}`} · account ${operation.account}`;
    hash.textContent = operation.hash || `operation ${operation.id} · no hash yet`;
    detail.className = 'details';
    detail.textContent = [
      operation.key,
      operation.receiptBlockNumber == null ? null : `receipt block ${operation.receiptBlockNumber}`,
      operation.error
    ].filter(Boolean).join(' · ');
    item.append(title, identity, hash, detail);
    elements.operationJournal.append(item);
  }
}

function agentWorkDetail(label, value) {
  const row = document.createElement('p');
  const strong = document.createElement('strong');
  const code = document.createElement('code');
  strong.textContent = `${label}: `;
  code.textContent = value;
  row.append(strong, code);
  return row;
}

function renderAgentWork() {
  const view = state.agentWork;
  elements.agentWorkResults.hidden = !view;
  elements.agentWorkVerification.textContent = view ? 'Code + provenance verified' : 'Not configured';
  elements.agentWorkVerification.className = `status ${view ? 'verified' : 'unverified'}`;
  elements.agentWorkBlock.textContent = view ? view.blockNumber.toString() : '—';
  elements.agentWorkTaskCount.textContent = view ? String(view.tasks.length) : '—';
  elements.agentWorkReceiptCount.textContent = view ? String(view.receipts.length) : '—';
  elements.agentWorkPaymentCount.textContent = view ? String(view.payments.length) : '—';
  elements.agentWorkRejectedCount.textContent = view ? String(view.rejected.length) : '—';
  elements.agentWorkTasks.replaceChildren();
  elements.agentWorkPayments.replaceChildren();
  elements.agentWorkRejected.replaceChildren();
  if (!view) return;

  for (const task of view.renderedTasks) {
    const receipts = view.renderedReceipts.filter((entry) => entry.value.task === task.documentDigest);
    const item = document.createElement('li');
    item.className = 'stage-card';
    const body = document.createElement('div');
    const heading = document.createElement('h4');
    heading.textContent = task.value.title;
    body.append(heading, agentWorkDetail('Task digest', task.documentDigest));
    if (task.duplicateCount) {
      const duplicates = document.createElement('p');
      duplicates.className = 'details';
      duplicates.textContent = `${task.duplicateCount + 1} identical on-chain publications; shown once by digest.`;
      body.append(duplicates);
    }
    const receiptList = document.createElement('ul');
    for (const receipt of receipts) {
      const row = document.createElement('li');
      row.textContent = `${receipt.value.summary} · ${receipt.documentDigest}`
        + `${receipt.duplicateCount ? ` · ${receipt.duplicateCount + 1} identical publications` : ''}`
        + `${receipt.conflictingReceipt ? ' · conflicting receipt' : ''}`;
      receiptList.append(row);
    }
    if (receipts.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'details';
      empty.textContent = 'No valid receipt in the configured range.';
      body.append(empty);
    } else body.append(receiptList);
    item.append(body);
    elements.agentWorkTasks.append(item);
  }

  for (const entry of view.paymentViews) {
    const { record, state: payment, plan, error } = entry;
    const item = document.createElement('li');
    item.className = 'stage-card';
    const body = document.createElement('div');
    const heading = document.createElement('h4');
    heading.textContent = `${record.value.amount} raw units → ${record.value.recipient}`;
    const meanings = document.createElement('p');
    meanings.className = 'details';
    meanings.textContent = error
      ? `Lifecycle verification: unverified · ${error}`
      : `Acceptance: ${payment.acceptance.state}${payment.acceptance.route ? ` (${payment.acceptance.route})` : ''} · Executability: ${payment.execution.state} · Payment: ${payment.paymentState.state}${payment.paymentState.state === 'paid' ? ' · block-delta-consistent' : ''}.`;
    body.append(
      heading,
      agentWorkDetail('Envelope', record.documentDigest),
      agentWorkDetail('Proposal / action', payment?.actionHash || 'Unverified'),
      meanings
    );
    if (!plan) {
      item.append(body);
      elements.agentWorkPayments.append(item);
      continue;
    }
    const exact = document.createElement('details');
    const summary = document.createElement('summary');
    const steps = document.createElement('ol');
    summary.textContent = 'State-gated calldata references';
    const omissions = document.createElement('p');
    omissions.className = 'details';
    omissions.textContent = plan.omissions;
    for (const step of plan.steps) {
      const row = document.createElement('li');
      const label = document.createElement('strong');
      const target = document.createElement('code');
      const data = document.createElement('code');
      const gate = document.createElement('span');
      label.textContent = `${step.label} · ${step.available ? 'available' : 'not available'}`;
      gate.textContent = step.gate;
      target.textContent = step.target;
      data.textContent = step.data;
      row.append(label, document.createElement('br'), gate, document.createElement('br'), target, document.createElement('br'), data);
      steps.append(row);
    }
    exact.append(summary, omissions, steps);
    body.append(exact);
    item.append(body);
    elements.agentWorkPayments.append(item);
  }
  if (view.paymentViews.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No valid payment lineage in the configured range.';
    elements.agentWorkPayments.append(empty);
  }
  for (const rejected of view.renderedRejected) {
    const item = document.createElement('li');
    item.textContent = `${rejected.transactionHash || 'Unknown transaction'} · ${rejected.reason}`;
    elements.agentWorkRejected.append(item);
  }
}

function renderInstances() {
  const shown = visibleInstances(state.instances, elements.showUnverified.checked);
  elements.instancesList.replaceChildren();
  elements.instancesList.hidden = shown.length === 0;
  elements.instancesEmpty.hidden = shown.length !== 0;
  elements.instanceCount.textContent = `${shown.length} shown`;
  elements.instancesEmpty.textContent = elements.showUnverified.checked
    ? 'No registrar instances are published yet.'
    : 'No canonical or code-verified FAO is published yet.';

  for (const instance of shown) {
    const item = document.createElement('li');
    const heading = document.createElement('h3');
    const address = document.createElement('code');
    const trust = document.createElement('p');
    heading.textContent = instance.name;
    address.textContent = instance.address;
    trust.className = instance.curated || instance.codeVerified ? 'details verified' : 'details unverified';
    trust.textContent = instanceTrustLabel(instance);
    item.append(heading, address, trust);
    if (state.manifest?.explorer) {
      const link = document.createElement('a');
      link.href = `${state.manifest.explorer}/address/${instance.address}`;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = `Inspect ${shortAddress(instance.address)}`;
      item.append(link);
    }
    elements.instancesList.append(item);
  }
}

function renderStages() {
  elements.stageDetails.receipt.textContent = state.creationPlan
    ? `${state.receiptExists ? 'Staged' : 'Predicted'} ${state.predictedReceipt}`
    : 'Prepare and review an exact plan first.';
  elements.stageDetails.core.textContent = state.coreSealed
    ? 'Core is sealed on-chain.'
    : state.receiptExists ? 'Receipt verified; core can be deployed by anyone.' : 'Waiting for the staged receipt.';
  elements.stageDetails.flm.textContent = state.flmSealed
    ? 'FLM is sealed on-chain.'
    : state.coreSealed ? 'Core verified; FLM can be deployed by anyone.' : 'Waiting for the sealed core.';
  elements.planSummary.hidden = !state.creationPlan;
  if (state.creationPlan) {
    elements.planReceipt.textContent = state.predictedReceipt;
    elements.planCoreHash.textContent = state.creationPlan.hashes.core;
    elements.planFlmHash.textContent = state.creationPlan.hashes.flm;
  }
  const ready = currentGate().canTransact && state.creationBundle && state.creationPlan
    && !trackedOperations.pending('creation');
  elements.stageButtons.receipt.disabled = !ready || state.receiptExists;
  elements.stageButtons.core.disabled = !ready || !state.receiptExists || state.coreSealed;
  elements.stageButtons.flm.disabled = !ready || !state.coreSealed || state.flmSealed;
}

async function loadManifest() {
  const [manifestResponse, codesResponse] = await Promise.all([
    fetch('/selfserve-deployment.json', { cache: 'no-store' }),
    fetch('/fao-creation-codes.json', { cache: 'no-store' })
  ]);
  if (!manifestResponse.ok) throw new Error(`Self-serve deployment manifest HTTP ${manifestResponse.status}.`);
  if (!codesResponse.ok) throw new Error(`Creation bundle HTTP ${codesResponse.status}.`);
  state.manifest = validateSelfServeManifest(await manifestResponse.json());
  state.creationBundle = validateCreationBundle(await codesResponse.json());
  state.instances = CURATED_INSTANCES;
  renderInstances();
  renderStages();
  renderGate();
}

async function syncConnection(requestAccounts = false, request = connectionRequests.begin(null)) {
  agentWorkRequests.invalidate();
  buybackRequests.invalidate();
  buybackRefreshRequests.invalidate();
  creationPlanRequests.invalidate();
  receiptStateRequests.invalidate();
  invalidateTreasuryFlow();
  treasuryManifestRequests.invalidate();
  state.walletChainId = null;
  state.rpcChainId = null;
  state.codeState = 'unchecked';
  state.codeMessage = 'Checking wallet and RPC state…';
  resetBuybackCard('Wallet context changed. Refresh the current treasury state before any buyback.');
  renderGate();
  if (!window.ethereum) {
    return;
  }
  let accounts;
  let walletValue;
  let rpcValue;
  try {
    accounts = await rpc(requestAccounts ? 'eth_requestAccounts' : 'eth_accounts');
    [walletValue, rpcValue] = await Promise.all([rpc('eth_chainId'), rpc('net_version')]);
  } catch (error) {
    if (!connectionRequests.current(request, null)) return;
    throw error;
  }
  if (!connectionRequests.current(request, null)) return;
  state.account = accounts[0] || null;
  state.walletChainId = chainId(walletValue, 'Wallet');
  state.rpcChainId = chainId(rpcValue, 'RPC');
  state.codeMessage = 'Not checked';
  renderGate();

  if (state.manifest?.status === 'active' && state.account && state.walletChainId === state.rpcChainId
    && state.walletChainId === SEPOLIA_CHAIN_ID) {
    state.codeMessage = 'Checking manifest hashes…';
    renderGate();
    try {
      const result = await verifyRuntimeCode(state.manifest, rpc);
      if (!connectionRequests.current(request, null)) return;
      state.codeState = result.status;
      state.codeMessage = `${result.checked.length} / ${result.checked.length} runtime hashes verified`;
    } catch (error) {
      if (!connectionRequests.current(request, null)) return;
      state.codeState = 'mismatch';
      state.codeMessage = errorMessage(error);
    }
  }
  alignBuybackCardWithPending();
  renderGate();
}

function syncConnectionForUser(requestAccounts = false) {
  const request = connectionRequests.begin(null);
  return syncConnection(requestAccounts, request).catch((error) => {
    if (connectionRequests.current(request, null)) {
      setMessage(elements.connectionMessage, errorMessage(error), true);
    }
  });
}

function draftFromForm() {
  return Object.fromEntries(new FormData(elements.createForm).entries());
}

function parseReturnedAddress(value) {
  return addressFromWord(value, 'predicted receipt');
}

function parseReturnedBool(value, label) {
  const word = fao.normalizeHex(value, 32, label);
  if (word === `0x${'0'.repeat(64)}`) return false;
  if (word === `0x${'0'.repeat(63)}1`) return true;
  throw new Error(`${label} returned a non-boolean word.`);
}

async function readReceiptState(plan, predictedReceipt) {
  const code = fao.normalizeHex(
    await rpc('eth_getCode', [predictedReceipt, 'latest']), undefined, 'receipt runtime code'
  );
  const receiptExists = code !== '0x';
  let coreSealed = false;
  let flmSealed = false;
  if (receiptExists) {
    const call = (data) => rpc('eth_call', [{ to: predictedReceipt, data }, 'latest']);
    const [coreHash, flmHash, coreSealedWord, flmSealedWord] = await Promise.all([
      call(RECEIPT_SELECTORS.coreHash), call(RECEIPT_SELECTORS.flmHash),
      call(RECEIPT_SELECTORS.coreSealed), call(RECEIPT_SELECTORS.flmSealed)
    ]);
    if (fao.normalizeHex(coreHash, 32, 'receipt core hash') !== plan.hashes.core
      || fao.normalizeHex(flmHash, 32, 'receipt FLM hash') !== plan.hashes.flm) {
      throw new Error('Predicted receipt code does not bind the prepared configuration.');
    }
    coreSealed = parseReturnedBool(coreSealedWord, 'coreSealed');
    flmSealed = parseReturnedBool(flmSealedWord, 'flmSealed');
    if (flmSealed && !coreSealed) throw new Error('Receipt reports FLM sealed before core.');
  }
  return Object.freeze({ receiptExists, coreSealed, flmSealed });
}

async function refreshReceiptState() {
  const plan = state.creationPlan;
  const predictedReceipt = state.predictedReceipt;
  if (!plan || !predictedReceipt) return false;
  const request = receiptStateRequests.begin(receiptStateSnapshot(plan, predictedReceipt));
  let receipt;
  try {
    receipt = await readReceiptState(plan, predictedReceipt);
  } catch (error) {
    if (!receiptStateRequests.current(request, receiptStateSnapshot())) return false;
    throw error;
  }
  if (!receiptStateRequests.current(request, receiptStateSnapshot())) return false;
  Object.assign(state, receipt);
  renderStages();
  return true;
}

async function installPreparedInput(input, { persist = true, request } = {}) {
  const creationBundle = state.creationBundle;
  if (!creationBundle) throw new Error('Creation bytecode is unavailable.');
  const plan = fao.createPlan({
    ...input,
    creationCodes: creationBundle.creationCodes
  });
  const result = await rpc('eth_call', [{
    to: plan.registrar.target,
    data: plan.registrar.predict
  }, 'latest']);
  const predictedReceipt = parseReturnedAddress(result);
  const receipt = await readReceiptState(plan, predictedReceipt);
  if (request && !creationPlanRequests.current(request, creationPlanInputSnapshot())) return false;
  state.preparedInput = input;
  state.creationPlan = plan;
  state.predictedReceipt = predictedReceipt;
  Object.assign(state, receipt);
  if (persist) localStorage.setItem(PREPARED_KEY, JSON.stringify(input));
  renderStages();
  return true;
}

function invalidatePreparedPlan(message = '') {
  creationPlanRequests.invalidate();
  receiptStateRequests.invalidate();
  localStorage.removeItem(PREPARED_KEY);
  state.preparedInput = null;
  state.creationPlan = null;
  state.predictedReceipt = null;
  state.receiptExists = false;
  state.coreSealed = false;
  state.flmSealed = false;
  renderStages();
  if (message) setMessage(elements.stageStatus, message);
}

async function prepareCreationPlan(request) {
  const gate = currentGate();
  if (!gate.canTransact) throw new Error(gate.message);
  const draft = draftFromForm();
  const manifest = state.manifest;
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!block || typeof block.timestamp !== 'string') throw new Error('RPC returned no latest block timestamp.');
  const input = creationInputFromDraft(draft, manifest, BigInt(block.timestamp));
  await fao.verifyAssetPolicyContracts(input.coreConfig, rpc);
  if (!await installPreparedInput(input, { request })) return;
  setMessage(
    elements.stageStatus,
    `Exact plan prepared for ${state.predictedReceipt}. Review both configuration hashes before staging.`
  );
}

async function restorePreparedPlan() {
  const raw = localStorage.getItem(PREPARED_KEY);
  if (!raw || !window.ethereum || state.manifest?.status !== 'active') return;
  const request = creationPlanRequests.begin(creationPlanInputSnapshot());
  try {
    if (!await installPreparedInput(JSON.parse(raw), { persist: false, request })) return;
    setMessage(elements.stageStatus, `Restored exact plan for ${state.predictedReceipt}. On-chain stages were re-read.`);
  } catch (error) {
    if (!creationPlanRequests.current(request, creationPlanInputSnapshot())) return;
    invalidatePreparedPlan();
    setMessage(elements.stageStatus, `Saved plan rejected: ${errorMessage(error)}`, true);
  }
}

async function waitForReceipt(hash) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const receipt = await rpc('eth_getTransactionReceipt', [hash]);
    if (receipt) return receipt;
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`Timed out waiting for ${hash}. The operation journal retains this submitted hash for reconciliation.`);
}

async function sendCreationStage(event) {
  const stage = event.currentTarget.dataset.stage;
  const plan = state.creationPlan;
  const predictedReceipt = state.predictedReceipt;
  const preparedInput = state.preparedInput;
  const account = state.account;
  if (!plan || !predictedReceipt || !preparedInput || !account) {
    setMessage(elements.stageStatus, 'Prepare and review an exact creation plan first.', true);
    return;
  }
  const steps = {
    receipt: { target: plan.registrar.target, data: plan.registrar.stage },
    core: { target: predictedReceipt, data: plan.receipt.deployCore },
    flm: { target: predictedReceipt, data: plan.receipt.deployFlm }
  };
  const step = steps[stage];
  if (!step) {
    setMessage(elements.stageStatus, 'Unknown creation stage.', true);
    return;
  }
  const ownsCard = () => state.creationPlan === plan
    && state.predictedReceipt === predictedReceipt
    && state.preparedInput === preparedInput
    && state.account === account
    && state.walletChainId === SEPOLIA_CHAIN_ID
    && state.rpcChainId === SEPOLIA_CHAIN_ID;
  const onUpdate = (operation) => {
    if (operation.state === TRACKED_OPERATION_STATES.walletRequested) {
      setMessage(
        elements.stageStatus,
        operation.error
          ? `${stage}: wallet submission was invoked, but no transaction hash was returned. No retry is enabled. ${operation.error}`
          : `${stage}: wallet submission requested. Waiting for its transaction hash…`,
        Boolean(operation.error)
      );
    } else if (operation.state === TRACKED_OPERATION_STATES.submitted) {
      setMessage(
        elements.stageStatus,
        operation.error
          ? `${stage} submitted: ${operation.hash}. Receipt remains unknown. ${operation.error}`
          : `${stage} submitted: ${operation.hash}. Waiting for confirmation…`,
        Boolean(operation.error)
      );
    } else if (operation.state === TRACKED_OPERATION_STATES.reverted) {
      setMessage(elements.stageStatus, `${stage} reverted: ${operation.hash}.`, true);
    } else if (operation.state === TRACKED_OPERATION_STATES.failed) {
      setMessage(elements.stageStatus, operation.error, true);
    }
  };
  const result = await runTrackedTransaction({
    controller: trackedOperations,
    context: {
      kind: 'creation', label: `Creation · ${stage}`, chainId: SEPOLIA_CHAIN_ID,
      account, target: step.target
    },
    verify: async () => {
      if (!await refreshReceiptState() || !ownsCard() || !currentGate().canTransact) {
        throw new Error('Creation plan or wallet state changed during stage verification.');
      }
      const ready = stage === 'receipt'
        ? !state.receiptExists
        : stage === 'core'
          ? state.receiptExists && !state.coreSealed
          : state.coreSealed && !state.flmSealed;
      if (!ready) throw new Error(`${stage} is not the next resumable stage.`);
      if (stage === 'core') {
        const block = await rpc('eth_getBlockByNumber', ['latest', false]);
        if (!block || BigInt(block.timestamp) >= BigInt(preparedInput.coreConfig.saleEnd)) {
          throw new Error('The prepared sale end is no longer in the future. Prepare a new FAO configuration.');
        }
      }
    },
    stillCurrent: () => ownsCard() && currentGate().canTransact,
    send: () => rpc('eth_sendTransaction', [{ from: account, to: step.target, data: step.data }]),
    wait: waitForReceipt,
    onUpdate
  });
  if (result.operation?.state === TRACKED_OPERATION_STATES.confirmed && ownsCard()) {
    try {
      if (await refreshReceiptState() && ownsCard()) {
        setMessage(
          elements.stageStatus,
          `${stage} confirmed: ${result.operation.hash}. Any account may continue the remaining stages.`
        );
      }
    } catch (error) {
      if (ownsCard()) {
        setMessage(
          elements.stageStatus,
          `${stage} confirmed: ${result.operation.hash}, but the later state refresh failed. ${errorMessage(error)}`,
          true
        );
      }
    }
  }
}

function restoreDraft() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
  } catch {
    localStorage.removeItem(DRAFT_KEY);
  }
  if (!draft || Array.isArray(draft) || typeof draft !== 'object') return;
  for (const [name, value] of Object.entries(draft)) {
    const input = elements.createForm.elements.namedItem(name);
    if (input instanceof HTMLInputElement && typeof value === 'string') input.value = value;
  }
  setMessage(elements.draftStatus, 'Restored the browser draft. No transaction was sent.');
}

function saveDraft(event) {
  event.preventDefault();
  if (!elements.createForm.reportValidity()) return;
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draftFromForm()));
  setMessage(elements.draftStatus, 'Draft saved in this browser. No transaction was sent.');
}

function clearDraft() {
  localStorage.removeItem(DRAFT_KEY);
  elements.createForm.reset();
  invalidatePreparedPlan();
  setMessage(elements.draftStatus, 'Browser draft cleared.');
}

function prepareRagequit(event) {
  event.preventDefault();
  if (!elements.ragequitForm.reportValidity()) return;
  try {
    const form = elements.ragequitForm.elements;
    const extras = parseExtraAssetInput(form.extras.value);
    const plan = fao.prepareRagequit(form.amount.value, form.recipient.value, extras);
    state.ragequitPlan = plan;
    elements.ragequitAssets.replaceChildren();
    for (const asset of plan.extras) {
      const item = document.createElement('li');
      item.textContent = asset === `0x${'0'.repeat(40)}` ? `${asset} (native ETH)` : asset;
      elements.ragequitAssets.append(item);
    }
    elements.ragequitEmpty.hidden = plan.extras.length !== 0;
    elements.ragequitAssets.hidden = plan.extras.length === 0;
    elements.ragequitCalldata.textContent = plan.calldata;
    elements.ragequitPlan.hidden = false;
    setMessage(elements.liquidityStatus, `Prepared ${plan.extras.length} explicit additional asset${plan.extras.length === 1 ? '' : 's'}. Review the exact list before execution.`);
  } catch (error) {
    state.ragequitPlan = null;
    elements.ragequitPlan.hidden = true;
    setMessage(elements.liquidityStatus, errorMessage(error), true);
  }
  renderGate();
}

async function loadTreasuryManifest(form, request) {
  if (!state.account || state.walletChainId !== SEPOLIA_CHAIN_ID || state.rpcChainId !== SEPOLIA_CHAIN_ID) {
    throw new Error('Connect a wallet with matching Sepolia wallet and RPC chain IDs first.');
  }
  state.treasuryManifest = null;
  state.treasuryRecords = null;
  invalidateTreasuryFlow();
  state.buybackModel = null;
  state.agentWork = null;
  agentWorkRequests.invalidate();
  buybackRequests.invalidate();
  resetBuybackCard('Treasury manifest verification changed this card identity. Earlier operations remain in the journal.');
  renderBuybackModel();
  renderAgentWork();
  const manifest = JSON.parse(form.elements.manifest.value);
  const records = await verifyTreasuryManifest(manifest, rpc);
  const buybackModel = await readBuybackModel({
    chainId: SEPOLIA_CHAIN_ID,
    vault: records.vault,
    executor: records.executor,
    request: rpc
  });
  if (!treasuryManifestRequests.current(request, treasuryManifestInputSnapshot())) return;
  state.treasuryManifest = manifest;
  state.treasuryRecords = records;
  state.buybackModel = buybackModel;
  elements.treasuryExecutor.textContent = records.executor;
  elements.treasuryVault.textContent = records.vault;
  renderBuybackModel();
  if (!alignBuybackCardWithPending()) {
    setBuybackActionState(buybackActionStateAfterRefresh(state.buybackActionState));
  }
  setMessage(elements.treasuryStatus, 'Four lifecycle runtimes, custody wiring, and buyback state verified on finalized Sepolia.');
  renderTreasuryGate();
}

async function loadAgentWork(form, request) {
  if (!treasuryNetworkReady() || !state.treasuryManifest) {
    throw new Error('Verify an active FAO treasury on matching Sepolia first.');
  }
  state.agentWork = null;
  renderAgentWork();
  const values = Object.fromEntries(new FormData(form).entries());
  const manifest = validateTreasuryManifest(state.treasuryManifest);
  const view = await fao.readAgentWorkIndex({
    request: rpc,
    config: { address: values.address, startBlock: values.startBlock },
    chainId: SEPOLIA_CHAIN_ID,
    vault: manifest.contracts.vault
  });
  const fresh = await verifyAgentWorkProvenance({
    manifest,
    selfServeManifest: state.manifest,
    creationBundle: state.creationBundle,
    indexView: view,
    request: rpc
  });
  const inspectedPayments = fao.selectAgentPayments(view.payments, {
    limit: MAX_AGENT_PAYMENT_VIEWS,
    digest: values.lookupDigest
  });
  const paymentViews = await fao.inspectAgentPayments(inspectedPayments, 3, async (record) => {
    const payment = await fao.readAgentPaymentState({
      request: rpc,
      chainId: SEPOLIA_CHAIN_ID,
      vault: fresh.vault,
      gateway: fresh.gateway,
      arbitration: fresh.arbitration,
      executor: fresh.executor,
      startBlock: view.config.startBlock,
      blockNumber: view.blockNumber,
      blockHash: view.blockHash,
      timestamp: view.timestamp,
      payment: record.document
    });
    return Object.freeze({
      record,
      state: payment,
      plan: fao.prepareAgentPaymentTransactions({
        index: view.config.address,
        gateway: fresh.gateway,
        vault: fresh.vault,
        chainId: SEPOLIA_CHAIN_ID,
        payment: record.document,
        state: payment
      })
    });
  });
  const exactPayment = values.lookupDigest
    ? view.payments.find((record) => record.documentDigest === values.lookupDigest.toLowerCase())
    : null;
  const exactReceipt = exactPayment
    ? view.receipts.find((record) => record.documentDigest === exactPayment.value.receipt)
    : null;
  const exactTask = exactPayment
    ? view.tasks.find((record) => record.documentDigest === exactPayment.value.task)
    : null;
  const cappedWith = (records, exact) => {
    const selected = records.slice(-MAX_AGENT_RENDERED_RECORDS);
    if (exact && !selected.some((record) => record.documentDigest === exact.documentDigest)) {
      if (selected.length === MAX_AGENT_RENDERED_RECORDS) selected.shift();
      selected.push(exact);
    }
    return Object.freeze(selected);
  };
  const omittedPayments = view.payments.length - inspectedPayments.length;
  if (!agentWorkRequests.current(request, agentWorkInputSnapshot())) return;
  state.agentWork = Object.freeze({
    ...view,
    paymentViews,
    renderedTasks: cappedWith(view.tasks, exactTask),
    renderedReceipts: cappedWith(view.receipts, exactReceipt),
    renderedRejected: Object.freeze(view.rejected.slice(-MAX_AGENT_RENDERED_RECORDS)),
    omittedPayments
  });
  renderAgentWork();
  setMessage(
    elements.agentWorkStatus,
    `Verified canonical registrar provenance, receipt, lifecycle code, wiring, and index code through finalized Sepolia block ${view.blockNumber}. The caller-selected start block makes this an explicitly incomplete discovery range; rejected records remain inert. Rendered record lists are capped at ${MAX_AGENT_RENDERED_RECORDS}.${omittedPayments ? ` Lifecycle reads show ${inspectedPayments.length} of ${view.payments.length} envelopes; use exact digest lookup for an older envelope.` : ''}`
  );
}

async function refreshBuybackState(reverify = true) {
  const manifest = state.treasuryManifest;
  const records = state.treasuryRecords;
  if (!treasuryNetworkReady() || !manifest || !records) {
    throw new Error('Reconnect and verify the treasury manifest before reading buyback state.');
  }
  const request = buybackRequests.begin(treasuryManifestInputSnapshot());
  try {
    if (reverify) {
      const fresh = await verifyTreasuryManifest(manifest, rpc);
      if (fresh.vault !== records.vault || fresh.executor !== records.executor) {
        throw new Error('Treasury manifest wiring changed.');
      }
    }
    const model = await readBuybackModel({
      chainId: SEPOLIA_CHAIN_ID,
      vault: records.vault,
      executor: records.executor,
      request: rpc
    });
    if (!buybackRequests.current(request, treasuryManifestInputSnapshot())
      || state.treasuryManifest !== manifest
      || state.treasuryRecords !== records) return null;
    state.buybackModel = model;
    renderBuybackModel();
    return model;
  } catch (error) {
    if (!buybackRequests.current(request, treasuryManifestInputSnapshot())
      || state.treasuryManifest !== manifest
      || state.treasuryRecords !== records) return null;
    throw error;
  }
}

async function refreshBuybackForUser(request) {
  let resolved = null;
  const pending = trackedOperations.pending('buyback');
  if (pending) {
    if (pending.state !== TRACKED_OPERATION_STATES.submitted || !pending.hash) {
      alignBuybackCardWithPending();
      return null;
    }
    resolved = await reconcileTrackedOperation(
      trackedOperations,
      pending,
      (hash) => rpc('eth_getTransactionReceipt', [hash])
    );
    if (!buybackRefreshRequests.current(request, buybackRefreshInputSnapshot())) return null;
    const ownsResolvedCard = buybackOperationOwnsCurrentCard(resolved.operation);
    if (resolved.operation.state === TRACKED_OPERATION_STATES.submitted) {
      if (ownsResolvedCard) {
        setBuybackActionState(BUYBACK_ACTION_STATES.submittedUnknown);
        setMessage(
          elements.buybackStatus,
          `Transaction ${pending.hash} remains submitted with no canonical receipt yet. No new buyback can be sent. ${pending.error || ''}`,
          true
        );
      } else {
        resetBuybackCard(
          'A separately captured buyback remains unresolved in the transaction journal. This treasury card is not labeled with that operation.'
        );
      }
      return null;
    }
    setBuybackActionState(
      ownsResolvedCard && resolved.operation.state === TRACKED_OPERATION_STATES.confirmed
        ? BUYBACK_ACTION_STATES.confirmedRefreshNeeded
        : BUYBACK_ACTION_STATES.refreshNeeded
    );
  } else if (state.buybackActionState === BUYBACK_ACTION_STATES.inFlight) {
    throw new Error('Wait for the wallet submission request to return.');
  }
  const resolvedOwnsCard = resolved && buybackOperationOwnsCurrentCard(resolved.operation);
  const wasConfirmed = (resolvedOwnsCard
    && resolved.operation.state === TRACKED_OPERATION_STATES.confirmed)
    || (!resolved && state.buybackActionState === BUYBACK_ACTION_STATES.confirmedRefreshNeeded);
  if (!wasConfirmed) setBuybackActionState(BUYBACK_ACTION_STATES.refreshNeeded);
  const model = await refreshBuybackState(true);
  if (!model || !buybackRefreshRequests.current(request, buybackRefreshInputSnapshot())) return null;
  if (resolved) assertBuybackStateCoversReceipt(model, resolved.receipt, resolved.operation);
  setBuybackActionState(buybackActionStateAfterRefresh(state.buybackActionState));
  setMessage(
    elements.buybackStatus,
    resolvedOwnsCard
      ? `${resolved.operation.label} ${resolved.operation.state}: ${resolved.operation.hash}. Current buyback state refreshed from Sepolia.`
      : resolved
        ? 'Current buyback state refreshed from Sepolia. A separately captured operation was reconciled only in the transaction journal.'
        : wasConfirmed
          ? 'Confirmed transaction state refreshed. A new submission is enabled only if the current policy allows it.'
          : 'Buyback state refreshed from one Sepolia block.'
  );
  return model;
}

function refreshBuybackForUserEvent() {
  const request = buybackRefreshRequests.begin(buybackRefreshInputSnapshot());
  return refreshBuybackForUser(request).catch((error) => {
    if (buybackRefreshRequests.current(request, buybackRefreshInputSnapshot())) {
      setMessage(elements.buybackStatus, errorMessage(error), true);
    }
  });
}

async function sendBuyback() {
  const manifest = state.treasuryManifest;
  const records = state.treasuryRecords;
  const account = state.account;
  if (!manifest || !records || !account || trackedOperations.pending('buyback')
    || state.buybackActionState !== BUYBACK_ACTION_STATES.ready) {
    setMessage(elements.buybackStatus, 'Verify and refresh treasury custody before calling buyback.', true);
    return null;
  }
  const plan = fao.prepareBuyback({ chainId: SEPOLIA_CHAIN_ID, vault: records.vault });
  const ownsCard = () => state.treasuryManifest === manifest
    && state.treasuryRecords === records
    && state.account === account
    && state.walletChainId === SEPOLIA_CHAIN_ID
    && state.rpcChainId === SEPOLIA_CHAIN_ID;
  const onUpdate = (operation) => {
    if (operation.state === TRACKED_OPERATION_STATES.submitted) {
      setBuybackActionState(BUYBACK_ACTION_STATES.submittedUnknown);
    } else if (operation.state === TRACKED_OPERATION_STATES.confirmed) {
      setBuybackActionState(
        ownsCard() ? BUYBACK_ACTION_STATES.confirmedRefreshNeeded : BUYBACK_ACTION_STATES.refreshNeeded
      );
    } else if (operation.state === TRACKED_OPERATION_STATES.reverted
      || operation.state === TRACKED_OPERATION_STATES.cancelled) {
      setBuybackActionState(BUYBACK_ACTION_STATES.refreshNeeded);
    } else if (operation.state === TRACKED_OPERATION_STATES.failed) {
      setBuybackActionState(BUYBACK_ACTION_STATES.refreshNeeded);
    }
    if (operation.state === TRACKED_OPERATION_STATES.walletRequested) {
      setMessage(
        elements.buybackStatus,
        operation.error
          ? `${plan.label}: wallet submission was invoked, but no transaction hash was returned. No retry is enabled. ${operation.error}`
          : `${plan.label}: wallet submission requested. Waiting for its hash…`,
        Boolean(operation.error)
      );
    } else if (operation.state === TRACKED_OPERATION_STATES.submitted) {
      setMessage(
        elements.buybackStatus,
        operation.error
          ? `${plan.label} submitted: ${operation.hash}. Receipt remains unknown; use Refresh buyback state to reconcile. ${operation.error}`
          : `${plan.label} submitted: ${operation.hash}. Waiting for confirmation…`,
        Boolean(operation.error)
      );
    } else if (operation.state === TRACKED_OPERATION_STATES.reverted) {
      setMessage(elements.buybackStatus, `${plan.label} reverted: ${operation.hash}.`, true);
    } else if (operation.state === TRACKED_OPERATION_STATES.failed) {
      setMessage(elements.buybackStatus, operation.error, true);
    }
  };
  setBuybackActionState(BUYBACK_ACTION_STATES.inFlight);
  const result = await runTrackedTransaction({
    controller: trackedOperations,
    context: {
      kind: 'buyback', label: plan.label, chainId: SEPOLIA_CHAIN_ID,
      account, vault: records.vault, target: plan.target
    },
    verify: async () => {
      const model = await refreshBuybackState(true);
      if (!model || !ownsCard() || !treasuryNetworkReady()) {
        throw new Error('Treasury configuration or wallet state changed during buyback verification.');
      }
      if (!model.canSubmit) {
        throw new Error(model.deterministicReasons.join(' ') || 'Buyback is not currently callable.');
      }
    },
    stillCurrent: () => ownsCard() && treasuryNetworkReady(),
    send: () => rpc('eth_sendTransaction', [{ from: account, to: plan.target, data: plan.data }]),
    wait: waitForReceipt,
    onUpdate
  });
  const operation = result.operation;
  if (!operation || !ownsCard()
    || ![TRACKED_OPERATION_STATES.confirmed, TRACKED_OPERATION_STATES.reverted].includes(operation.state)) {
    return result;
  }
  let event = null;
  let decodeError = null;
  if (operation.state === TRACKED_OPERATION_STATES.confirmed) {
    try {
      const log = result.receipt.logs?.find((entry) => (
        typeof entry?.address === 'string'
        && entry.address.toLowerCase() === plan.target
        && entry.topics?.[0]?.toLowerCase() === fao.BUYBACK_EVENT_TOPIC
      ));
      if (!log) throw new Error('Confirmed transaction did not emit the expected Buyback event.');
      event = fao.decodeBuybackLog(log, plan.target);
    } catch (error) {
      decodeError = error;
    }
  }
  try {
    const model = await refreshBuybackState(false);
    if (!model || !ownsCard()) return result;
    assertBuybackStateCoversReceipt(model, result.receipt, operation);
    setBuybackActionState(BUYBACK_ACTION_STATES.ready);
    if (operation.state === TRACKED_OPERATION_STATES.reverted) {
      setMessage(
        elements.buybackStatus,
        `${plan.label} reverted: ${operation.hash}. Current state refreshed; policy permits a later retry only if still callable.`,
        true
      );
    } else if (decodeError) {
      setMessage(
        elements.buybackStatus,
        `${plan.label} confirmed: ${operation.hash}. Current state refreshed, but the Buyback event could not be decoded. ${errorMessage(decodeError)}`,
        true
      );
    } else {
      elements.buybackLatest.textContent =
        `Latest: ${format18(event.wethSpent)} WETH spent and ${format18(event.companyBurned)} FAO burned by ${event.caller}.`;
      setMessage(
        elements.buybackStatus,
        `${plan.label} confirmed: ${operation.hash}. ${format18(event.companyBurned)} FAO was literally burned; state refreshed.`
      );
    }
  } catch (error) {
    if (ownsCard()) {
      setMessage(
        elements.buybackStatus,
        `${plan.label} ${operation.state}: ${operation.hash}. The receipt is resolved, but current-state refresh failed. ${errorMessage(error)}`,
        true
      );
    }
  }
  return result;
}

function prepareTreasury(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  if (!state.treasuryRecords) throw new Error('Verify an active economic deployment manifest first.');
  const form = event.currentTarget;
  invalidateTreasuryFlow();
  const request = treasuryFlowRequests.begin(treasuryFlowInputSnapshot(form));
  const values = Object.fromEntries(new FormData(form).entries());
  let type;
  let route;
  let action;
  if (form === elements.treasuryTransferForm) {
    ({ route } = values);
    type = 'transfer';
    action = { asset: values.asset, recipient: values.recipient, amount: values.amount, salt: values.salt };
  } else if (form === elements.treasuryParamForm) {
    type = 'param';
    route = 'evaluated';
    action = {
      key: fao.keccak256('FAO_ECON_TAP_BUDGET_V1'), asset: values.asset,
      value: values.value, salt: values.salt
    };
  } else {
    type = 'critical';
    route = 'evaluated';
    action = { target: values.target, value: values.value, data: values.data, salt: values.salt };
  }
  const records = state.treasuryRecords;
  const flow = fao.prepareTreasuryFlow({
    chainId: SEPOLIA_CHAIN_ID,
    vault: records.vault,
    gateway: records.gateway,
    executor: records.executor,
    type,
    route,
    action
  });
  state.treasuryFlow = flow;
  state.treasuryFlowForm = form;
  state.treasuryFlowRequest = request;
  elements.treasuryAcceptance.textContent = flow.acceptance;
  flow.steps.forEach((step, index) => {
    const item = document.createElement('li');
    item.className = 'stage-card';
    const detail = document.createElement('div');
    const title = document.createElement('h4');
    const target = document.createElement('code');
    const calldata = document.createElement('details');
    const summary = document.createElement('summary');
    const data = document.createElement('code');
    const button = document.createElement('button');
    title.textContent = `${index + 1}. ${step.label}`;
    target.textContent = step.target;
    summary.textContent = 'Exact calldata';
    data.textContent = step.data;
    calldata.append(summary, data);
    detail.append(title, target, calldata);
    button.type = 'button';
    button.textContent = 'Send this step';
    button.addEventListener('click', () => sendTreasuryStep(index, flow, form, request));
    item.append(detail, button);
    elements.treasurySteps.append(item);
  });
  elements.treasuryPlan.hidden = false;
  setMessage(
    elements.treasuryStatus,
    `Prepared ${flow.steps.length} exact ${type} steps. Send only the next on-chain-ready step.`
  );
  renderTreasuryGate();
}

async function sendTreasuryStep(index, flow, form, request) {
  if (state.treasuryFlow !== flow || state.treasuryFlowForm !== form
    || state.treasuryFlowRequest !== request
    || !treasuryFlowRequests.current(request, treasuryFlowInputSnapshot(form))) return;
  const manifest = state.treasuryManifest;
  const records = state.treasuryRecords;
  const account = state.account;
  const step = flow.steps[index];
  if (!step || !manifest || !records || !account) {
    setMessage(elements.treasuryStatus, 'Reconnect and verify the treasury manifest before sending.', true);
    return;
  }
  const ownsCard = () => state.treasuryManifest === manifest
    && state.treasuryRecords === records
    && state.treasuryFlow === flow
    && state.treasuryFlowForm === form
    && state.treasuryFlowRequest === request
    && state.account === account
    && state.walletChainId === SEPOLIA_CHAIN_ID
    && state.rpcChainId === SEPOLIA_CHAIN_ID
    && treasuryFlowRequests.current(request, treasuryFlowInputSnapshot(form));
  const onUpdate = (operation) => {
    if (operation.state === TRACKED_OPERATION_STATES.walletRequested) {
      setMessage(
        elements.treasuryStatus,
        operation.error
          ? `${step.label}: wallet submission was invoked, but no transaction hash was returned. No retry is enabled. ${operation.error}`
          : `${step.label}: wallet submission requested. Waiting for its hash…`,
        Boolean(operation.error)
      );
    } else if (operation.state === TRACKED_OPERATION_STATES.submitted) {
      setMessage(
        elements.treasuryStatus,
        operation.error
          ? `${step.label} submitted: ${operation.hash}. Receipt remains unknown. ${operation.error}`
          : `${step.label} submitted: ${operation.hash}. Waiting for confirmation…`,
        Boolean(operation.error)
      );
    } else if (operation.state === TRACKED_OPERATION_STATES.confirmed) {
      setMessage(
        elements.treasuryStatus,
        `${step.label} confirmed: ${operation.hash}. Re-check acceptance and timing before sending the next step.`
      );
    } else if (operation.state === TRACKED_OPERATION_STATES.reverted) {
      setMessage(elements.treasuryStatus, `${step.label} reverted: ${operation.hash}.`, true);
    } else if (operation.state === TRACKED_OPERATION_STATES.failed) {
      setMessage(elements.treasuryStatus, operation.error, true);
    }
  };
  await runTrackedTransaction({
    controller: trackedOperations,
    context: {
      kind: 'treasury', label: step.label, chainId: SEPOLIA_CHAIN_ID,
      account, vault: records.vault, target: step.target
    },
    verify: async () => {
      const fresh = await verifyTreasuryManifest(manifest, rpc);
      if (fresh.vault !== records.vault || fresh.executor !== records.executor) {
        throw new Error('Treasury manifest wiring changed.');
      }
    },
    stillCurrent: () => ownsCard() && treasuryNetworkReady(),
    send: () => rpc('eth_sendTransaction', [{ from: account, to: step.target, data: step.data }]),
    wait: waitForReceipt,
    onUpdate
  });
}

function unavailableAction(event) {
  event.preventDefault();
  const target = event.currentTarget;
  const section = target.closest('section');
  const output = section?.querySelector('[role="status"]');
  if (output) setMessage(output, 'Transaction sending is not yet published in this stable-client shell. No transaction was sent.');
}

function bindElements() {
  const byId = (id) => document.getElementById(id);
  elements = {
    connectionBadge: byId('connection-badge'), deploymentState: byId('deployment-state'),
    walletAccount: byId('wallet-account'), walletChain: byId('wallet-chain'), rpcChain: byId('rpc-chain'),
    codeState: byId('code-state'), creationCodeState: byId('creation-code-state'), connect: byId('connect'), refresh: byId('refresh'),
    connectionMessage: byId('connection-message'), createForm: byId('create-form'), preparePlan: byId('prepare-plan'), clearDraft: byId('clear-draft'),
    draftStatus: byId('draft-status'), stageStatus: byId('stage-status'), showUnverified: byId('show-unverified'),
    instanceCount: byId('instance-count'), instancesList: byId('instances-list'), instancesEmpty: byId('instances-empty'),
    ragequitForm: byId('ragequit-form'), executeRagequit: byId('execute-ragequit'),
    ragequitPlan: byId('ragequit-plan'), ragequitEmpty: byId('ragequit-empty'), ragequitAssets: byId('ragequit-assets'),
    ragequitCalldata: byId('ragequit-calldata'), liquidityStatus: byId('liquidity-status'),
    stageDetails: { receipt: byId('receipt-detail'), core: byId('core-detail'), flm: byId('flm-detail') },
    stageButtons: Object.fromEntries(Array.from(document.querySelectorAll('[data-stage]')).map((button) => [button.dataset.stage, button])),
    planSummary: byId('creation-plan'), planReceipt: byId('plan-receipt'),
    planCoreHash: byId('plan-core-hash'), planFlmHash: byId('plan-flm-hash'),
    treasuryManifestForm: byId('treasury-manifest-form'),
    treasuryExecutor: byId('treasury-executor'), treasuryVault: byId('treasury-vault'),
    treasuryStatus: byId('treasury-status'), treasuryPlan: byId('treasury-plan'),
    treasuryAcceptance: byId('treasury-acceptance'), treasurySteps: byId('treasury-steps'),
    treasuryTransferForm: byId('treasury-transfer-form'),
    treasuryParamForm: byId('treasury-param-form'),
    treasuryCriticalForm: byId('treasury-critical-form'),
    refreshBuyback: byId('refresh-buyback'), executeBuyback: byId('execute-buyback'),
    buybackTransactionState: byId('buyback-transaction-state'),
    buybackPhase: byId('buyback-phase'), buybackWeth: byId('buyback-weth'),
    buybackSupply: byId('buyback-supply'), buybackNav: byId('buyback-nav'),
    buybackSpent: byId('buyback-spent'), buybackPercentCap: byId('buyback-percent-cap'),
    buybackRawCap: byId('buyback-raw-cap'), buybackAvailable: byId('buyback-available'),
    buybackChecks: byId('buyback-checks'), buybackStatus: byId('buyback-status'),
    buybackLatest: byId('buyback-latest'),
    operationJournal: byId('operation-journal'),
    operationJournalEmpty: byId('operation-journal-empty'),
    agentWorkForm: byId('agent-work-form'),
    agentWorkVerification: byId('agent-work-verification'),
    agentWorkBlock: byId('agent-work-block'),
    agentWorkTaskCount: byId('agent-work-task-count'),
    agentWorkReceiptCount: byId('agent-work-receipt-count'),
    agentWorkPaymentCount: byId('agent-work-payment-count'),
    agentWorkRejectedCount: byId('agent-work-rejected-count'),
    agentWorkStatus: byId('agent-work-status'), agentWorkResults: byId('agent-work-results'),
    agentWorkTasks: byId('agent-work-tasks'), agentWorkPayments: byId('agent-work-payments'),
    agentWorkRejected: byId('agent-work-rejected')
  };
  elements.treasuryForms = Object.freeze([
    elements.treasuryTransferForm, elements.treasuryParamForm, elements.treasuryCriticalForm
  ]);
}

async function initialize() {
  bindElements();
  renderOperationJournal();
  elements.createForm.addEventListener('submit', saveDraft);
  elements.createForm.addEventListener('input', () => invalidatePreparedPlan('Draft changed. Prepare a new exact plan before staging.'));
  elements.preparePlan.addEventListener('click', () => {
    if (!elements.createForm.reportValidity()) return;
    const request = creationPlanRequests.begin(creationPlanInputSnapshot());
    prepareCreationPlan(request).catch((error) => {
      if (!creationPlanRequests.current(request, creationPlanInputSnapshot())) return;
      setMessage(elements.stageStatus, errorMessage(error), true);
    });
  });
  elements.clearDraft.addEventListener('click', clearDraft);
  elements.ragequitForm.addEventListener('submit', prepareRagequit);
  elements.treasuryManifestForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const request = treasuryManifestRequests.begin(treasuryManifestInputSnapshot());
    loadTreasuryManifest(event.currentTarget, request).catch((error) => {
      if (!treasuryManifestRequests.current(request, treasuryManifestInputSnapshot())) return;
      setMessage(elements.treasuryStatus, errorMessage(error), true);
    });
  });
  elements.treasuryManifestForm.addEventListener('input', () => {
    treasuryManifestRequests.invalidate();
    agentWorkRequests.invalidate();
    buybackRequests.invalidate();
    buybackRefreshRequests.invalidate();
    state.treasuryManifest = null;
    state.treasuryRecords = null;
    invalidateTreasuryFlow();
    state.buybackModel = null;
    state.agentWork = null;
    resetBuybackCard('Treasury configuration changed. Earlier operations remain labeled only in the transaction journal.');
    elements.treasuryExecutor.textContent = 'Not verified';
    elements.treasuryVault.textContent = 'Not verified';
    renderBuybackModel();
    renderAgentWork();
  });
  elements.agentWorkForm.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const request = agentWorkRequests.begin(agentWorkInputSnapshot());
    loadAgentWork(event.currentTarget, request).catch((error) => {
      if (!agentWorkRequests.current(request, agentWorkInputSnapshot())) return;
      state.agentWork = null;
      renderAgentWork();
      setMessage(elements.agentWorkStatus, errorMessage(error), true);
    });
  });
  elements.agentWorkForm.addEventListener('input', () => {
    agentWorkRequests.invalidate();
    state.agentWork = null;
    renderAgentWork();
    setMessage(elements.agentWorkStatus, 'Configuration changed. Verify the deployed index again.');
  });
  for (const form of elements.treasuryForms) form.addEventListener('submit', (event) => {
    try {
      prepareTreasury(event);
    } catch (error) {
      setMessage(elements.treasuryStatus, errorMessage(error), true);
    }
  });
  for (const form of elements.treasuryForms) form.addEventListener('input', () => {
    invalidateTreasuryFlow('Treasury action changed. Prepare and review a new exact flow before sending.');
  });
  elements.refreshBuyback.addEventListener('click', refreshBuybackForUserEvent);
  elements.executeBuyback.addEventListener('click', sendBuyback);
  elements.showUnverified.addEventListener('change', renderInstances);
  elements.connect.addEventListener('click', () => syncConnectionForUser(true));
  elements.refresh.addEventListener('click', () => syncConnectionForUser(false));
  for (const form of document.querySelectorAll('#buy-form, #deposit-form, #redeem-form')) form.addEventListener('submit', unavailableAction);
  for (const button of document.querySelectorAll('[data-stage]')) {
    button.addEventListener('click', sendCreationStage);
  }
  for (const button of document.querySelectorAll('[data-action], #execute-ragequit')) button.addEventListener('click', unavailableAction);

  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', () => syncConnectionForUser(false));
    window.ethereum.on('chainChanged', () => syncConnectionForUser(false));
  }

  restoreDraft();
  try {
    await loadManifest();
    await syncConnection(false);
    await restorePreparedPlan();
  } catch (error) {
    state.manifest = null;
    state.codeState = 'mismatch';
    state.codeMessage = errorMessage(error);
    renderGate();
  }
}

if (typeof document !== 'undefined') initialize();

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AGENT_PAYMENT_COPY,
  AGENT_WORK_EVENTS,
  AGENT_WORK_INDEX,
  AGENT_WORK_KINDS,
  agentDocumentDigest,
  agentPaymentTransferAction,
  buildAgentReceipt,
  buildAgentTask,
  inspectAgentPayments,
  keccak256,
  prepareAgentPaymentTransactions,
  readAgentPaymentState,
  readAgentWorkIndex,
  reconstructAgentWorkLogs,
  selectAgentPayments,
  uintWord,
  validateAgentPaymentBinding
} from './fao.js';

const fixture = JSON.parse(readFileSync(new URL('./agent-document-golden.json', import.meta.url)));
const cast = (...args) => execFileSync('cast', args, { encoding: 'utf8' }).trim();
const address = (byte) => `0x${byte.repeat(20)}`;
const digest = (byte) => `0x${byte.repeat(32)}`;
const q = (value) => `0x${BigInt(value).toString(16)}`;
const addressTopic = (value) => `0x${value.slice(2).padStart(64, '0')}`;
const words = (...values) => `0x${values.map((value) => uintWord(value)).join('')}`;
const tx = (byte) => digest(byte);

const INDEX = address('11');
const GATEWAY = address('22');
const ARBITRATION = address('33');
const EXECUTOR = address('44');
const PUBLISHER = address('69');
const VAULT = fixture.payment.input.vault.toLowerCase();
const BLOCK_HASH = digest('55');
const INDEX_RUNTIME = '0x608060408181526004361015610013575f80fd5b5f91823560e01c6352bf8ff214610028575f80fd5b3461013c57606036600319011261013c5760443567ffffffffffffffff80821161013857366023830112156101385781600401359281841161013457602483019260248536920101116101345783156101255750601f1980601f85011691855191603f840116820190828210908211176101115785528381526020956060959493929187810190858583378289878301015251902095848795875195338752888b880152818988015283870137840101527f9b8065b31fd378509bae92224c8f432ce836e42765fe48ed19a4c94713cc24a460243592606081600435948101030190a451908152f35b634e487b7160e01b87526041600452602487fd5b6362c3368960e01b8152600490fd5b8580fd5b8480fd5b8280fdfea2646970667358221220ff7c280a44e3bacfe8b95363943ae27fea7bf6fa1781cf7c6c3369397ab20d3164736f6c63430008140033';
assert.equal(keccak256(INDEX_RUNTIME), AGENT_WORK_INDEX.runtimeCodeKeccak256);

function boundPaymentState(state, payment = fixture.payment.canonicalHex) {
  const action = agentPaymentTransferAction(payment);
  const binding = validateAgentPaymentBinding(payment, {
    chainId: 11155111, vault: VAULT, action
  });
  return {
    payment, action, actionHash: binding.actionHash, proposalId: binding.proposalId, ...state
  };
}

function publishedLog(type, document, parentDigest, blockNumber, logIndex = 0n) {
  const kind = AGENT_WORK_KINDS[type];
  const documentDigest = agentDocumentDigest(document);
  return {
    address: INDEX,
    blockNumber: q(blockNumber),
    blockHash: BLOCK_HASH,
    logIndex: q(logIndex),
    transactionHash: tx((Number(blockNumber) + Number(logIndex)).toString(16).padStart(2, '0')),
    topics: [AGENT_WORK_INDEX.publishedTopic, kind, parentDigest, documentDigest],
    data: cast('abi-encode', 'f(address,bytes)', PUBLISHER, document)
  };
}

test('lineage reconstruction rejects hostile/replayed docs and shows duplicates and conflicts', () => {
  const task = fixture.task.canonicalHex;
  const receipt = fixture.receipt.canonicalHex;
  const conflicting = `0x${Buffer.from(buildAgentReceipt({
    ...fixture.receipt.input,
    summary: 'Independent conflicting result',
    salt: digest('12')
  })).toString('hex')}`;
  const replay = `0x${Buffer.from(buildAgentTask({
    ...fixture.task.input, chainId: '1', salt: digest('13')
  })).toString('hex')}`;
  const hostile = fixture.nonCanonical.hex;
  const logs = [
    publishedLog('task', task, digest('00'), 1n),
    publishedLog('receipt', receipt, fixture.task.digest, 2n),
    publishedLog('receipt', receipt, fixture.task.digest, 3n),
    publishedLog('receipt', conflicting, fixture.task.digest, 4n),
    publishedLog('payment', fixture.payment.canonicalHex, fixture.receipt.digest, 5n),
    publishedLog('task', replay, digest('00'), 6n),
    publishedLog('task', hostile, digest('00'), 7n)
  ];
  const view = reconstructAgentWorkLogs(logs, {
    index: INDEX, chainId: 11155111n, vault: VAULT
  });
  assert.equal(view.tasks.length, 1);
  assert.equal(view.receipts.length, 2);
  assert.equal(view.receipts.every((entry) => entry.conflictingReceipt), true);
  assert.equal(view.receipts.find((entry) => entry.documentDigest === fixture.receipt.digest).duplicateCount, 1);
  assert.equal(view.payments.length, 1);
  assert.equal(view.rejected.length, 2);
  assert.match(view.rejected[0].reason, /replay/);
  assert.match(view.rejected[1].reason, /canonical/);
});

test('bad lineage remains inert and cannot become a payment view', () => {
  const logs = [publishedLog('payment', fixture.payment.canonicalHex, fixture.receipt.digest, 1n)];
  const view = reconstructAgentWorkLogs(logs, {
    index: INDEX, chainId: 11155111n, vault: VAULT
  });
  assert.equal(view.payments.length, 0);
  assert.match(view.rejected[0].reason, /lineage/);
});

test('configured index requires actual matching code and never promotes a predicted address', async () => {
  const request = async (method) => {
    if (method === 'eth_chainId') return q(11155111);
    if (method === 'eth_getBlockByNumber') return { number: q(10), timestamp: q(20), hash: BLOCK_HASH };
    if (method === 'eth_getCode') return '0x';
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(() => readAgentWorkIndex({
    request,
    config: { address: INDEX, startBlock: '1' },
    chainId: 11155111,
    vault: VAULT
  }), /predicted address is not a deployment/);
});

test('index verification pins code and logs to the finalized block', async () => {
  const code = INDEX_RUNTIME;
  const calls = [];
  const request = async (method, params) => {
    calls.push([method, params]);
    if (method === 'eth_chainId') return q(11155111);
    if (method === 'eth_getBlockByNumber') return { number: q(25001), timestamp: q(20), hash: BLOCK_HASH };
    if (method === 'eth_getCode') return code;
    if (method === 'eth_getLogs') return [];
    throw new Error(`unexpected ${method}`);
  };
  const view = await readAgentWorkIndex({
    request,
    config: { address: INDEX, startBlock: '1' },
    chainId: 11155111,
    vault: VAULT
  });
  assert.equal(view.blockNumber, 25001n);
  assert.deepEqual(calls.find(([method]) => method === 'eth_getBlockByNumber')[1], ['finalized', false]);
  assert.deepEqual(calls.find(([method]) => method === 'eth_getCode')[1], [INDEX, q(25001)]);
  assert.deepEqual(
    calls.filter(([method]) => method === 'eth_getLogs').map(([, [filter]]) => (
      [filter.fromBlock, filter.toBlock]
    )),
    [[q(1), q(10000)], [q(10001), q(20000)], [q(20001), q(25001)]]
  );
  assert.equal(view.rangeCompleteness, 'caller-selected-incomplete');
});

test('permissionless history fails closed at the block and log resource bounds', async () => {
  const request = (logs, blockNumber) => async (method) => {
    if (method === 'eth_chainId') return q(11155111);
    if (method === 'eth_getBlockByNumber') {
      return { number: q(blockNumber), timestamp: q(20), hash: BLOCK_HASH };
    }
    if (method === 'eth_getCode') return INDEX_RUNTIME;
    if (method === 'eth_getLogs') return logs;
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(readAgentWorkIndex({
    request: request([], 50_000n),
    config: { address: INDEX, startBlock: '0' },
    chainId: 11155111,
    vault: VAULT
  }), /50000-block client limit/);

  const log = publishedLog('task', fixture.task.canonicalHex, digest('00'), 1n);
  await assert.rejects(readAgentWorkIndex({
    request: request(Array(5_001).fill(log), 1n),
    config: { address: INDEX, startBlock: '1' },
    chainId: 11155111,
    vault: VAULT
  }), /5000-log client limit/);
});

test('log scan rejects out-of-range/conflicting identities and finalized hash changes', async () => {
  const run = (logs, afterHash = BLOCK_HASH) => {
    let blockReads = 0;
    return readAgentWorkIndex({
      request: async (method) => {
        if (method === 'eth_chainId') return q(11155111);
        if (method === 'eth_getBlockByNumber') {
          blockReads += 1;
          return { number: q(10), timestamp: q(20), hash: blockReads === 1 ? BLOCK_HASH : afterHash };
        }
        if (method === 'eth_getCode') return INDEX_RUNTIME;
        if (method === 'eth_getLogs') return logs;
        throw new Error(`unexpected ${method}`);
      },
      config: { address: INDEX, startBlock: '1' },
      chainId: 11155111,
      vault: VAULT
    });
  };
  const log = publishedLog('task', fixture.task.canonicalHex, digest('00'), 1n);
  await assert.rejects(run([{ ...log, blockNumber: q(0) }]), /outside the requested range/);
  await assert.rejects(run([log, { ...log, data: '0x00' }]), /conflicting logs/);
  await assert.rejects(run([], digest('66')), /Finalized block hash changed/);
});

function eventLog(address_, topicList, data, blockNumber = 10n, logIndex = 0n) {
  return {
    address: address_, topics: topicList, data,
    blockNumber: q(blockNumber), blockHash: BLOCK_HASH,
    logIndex: q(logIndex), transactionHash: tx('77')
  };
}

function lifecycleFixture({ accepted = true, queue = 'none', paid = false } = {}) {
  const payment = fixture.payment.input;
  const action = agentPaymentTransferAction(payment);
  const binding = validateAgentPaymentBinding(payment, {
    chainId: payment.chainId, vault: payment.vault, action
  });
  const proposal = eventLog(GATEWAY, [
    AGENT_WORK_EVENTS.transferProposed,
    binding.actionHash,
    addressTopic(PUBLISHER),
    addressTopic(action.asset)
  ], `0x${addressTopic(action.recipient).slice(2)}${uintWord(action.amount)}${action.salt.slice(2)}`, 2n);
  const settlement = eventLog(ARBITRATION, [
    AGENT_WORK_EVENTS.finalizedByTimeout,
    binding.actionHash,
    addressTopic(PUBLISHER)
  ], words(accepted ? 1n : 0n, 1n), 3n);
  const executeAfter = 100n;
  const expiresAt = 200n;
  const queued = queue === 'none' ? [] : [eventLog(VAULT, [
    AGENT_WORK_EVENTS.transferQueued, binding.actionHash, binding.actionHash
  ], words(executeAfter, expiresAt), 4n)];
  const executed = paid ? [eventLog(VAULT, [
    AGENT_WORK_EVENTS.transferExecuted,
    binding.actionHash,
    addressTopic(action.asset),
    addressTopic(action.recipient)
  ], words(action.amount), 10n)] : [];
  return { action, binding, proposal, settlement, queued, executed, executeAfter, expiresAt };
}

function lifecycleRequest(scenario, {
  proposalAccepted = true, proposalSettled = true, proposalState = 5n,
  queueExpiresAt = scenario.expiresAt, timestamp = 150n, staticError = null,
  balanceMismatch = false, queueExecuted = scenario.executed.length !== 0,
  queueExpired = false, proposalExists = true, proposalLogs = true, settlementLogs = true,
  proposalStaticError = null
} = {}) {
  const proposalWords = [
    0n, 0n, 0n, 0n, 0n, proposalState, 3n,
    proposalSettled ? 1n : 0n, proposalAccepted ? 1n : 0n, 0n, proposalExists ? 1n : 0n
  ];
  const hasQueue = scenario.queued.length === 1;
  const queueWords = [
    hasQueue ? scenario.executeAfter : 0n,
    hasQueue ? queueExpiresAt : 0n,
    queueExecuted ? 1n : 0n,
    queueExpired ? 1n : 0n
  ];
  return async (method, params) => {
    if (method === 'eth_getLogs') {
      const { address: target, topics } = params[0];
      if (target === GATEWAY) return proposalLogs ? [scenario.proposal] : [];
      if (target === ARBITRATION) return settlementLogs ? [scenario.settlement] : [];
      if (topics[0] === AGENT_WORK_EVENTS.transferQueued) return scenario.queued;
      if (topics[0] === AGENT_WORK_EVENTS.transferExecuted) return scenario.executed;
    }
    if (method === 'eth_call') {
      const [{ to, data }, block] = params;
      if (to === ARBITRATION) return words(...proposalWords);
      if (to === GATEWAY) {
        if (proposalStaticError) throw new Error(proposalStaticError);
        return '0x';
      }
      if (to === VAULT && data.startsWith('0xf3df92bf')) return words(...queueWords);
      if (to === VAULT) {
        if (staticError) throw new Error(staticError);
        return '0x';
      }
      if (to === scenario.action.asset) {
        const account = `0x${data.slice(-40)}`;
        const amount = scenario.action.amount;
        if (account === EXECUTOR) return words(block === q(9) ? amount : 0n);
        if (account === scenario.action.recipient) {
          return words(block === q(9) ? 0n : amount + (balanceMismatch ? 1n : 0n));
        }
      }
    }
    if (method === 'eth_getBlockByNumber') return { hash: BLOCK_HASH };
    throw new Error(`unexpected ${method} ${JSON.stringify(params)}`);
  };
}

async function readLifecycle(scenario, options = {}) {
  return readAgentPaymentState({
    request: lifecycleRequest(scenario, options),
    chainId: 11155111,
    vault: VAULT,
    gateway: GATEWAY,
    arbitration: ARBITRATION,
    executor: EXECUTOR,
    startBlock: 1,
    blockNumber: 20,
    blockHash: BLOCK_HASH,
    timestamp: options.timestamp ?? 150,
    payment: fixture.payment.canonicalHex
  });
}

test('acceptance is not payment and underfunding blocks only executability', async () => {
  const accepted = await readLifecycle(lifecycleFixture());
  assert.equal(accepted.acceptance.state, 'accepted');
  assert.equal(accepted.execution.state, 'not-queued');
  assert.equal(accepted.paymentState.state, 'not-paid');
  assert.match(AGENT_PAYMENT_COPY.accepted, /no payment has occurred/);

  const underfunded = await readLifecycle(
    lifecycleFixture({ queue: 'active' }), { staticError: 'ERC20: transfer amount exceeds balance' }
  );
  assert.equal(underfunded.acceptance.state, 'accepted');
  assert.equal(underfunded.execution.state, 'blocked-at-pinned-block');
  assert.equal(underfunded.paymentState.paid, false);
});

test('expiry and view/log disagreement both fail closed', async () => {
  const expired = await readLifecycle(lifecycleFixture({ queue: 'active' }), { timestamp: 201n });
  assert.equal(expired.execution.state, 'expired');
  const disagreement = await readLifecycle(lifecycleFixture(), { proposalAccepted: false });
  assert.equal(disagreement.acceptance.state, 'disagreement');
  assert.equal(disagreement.execution.executableNow, false);

  const omittedHistory = await readLifecycle(lifecycleFixture(), {
    proposalLogs: false, settlementLogs: false
  });
  assert.equal(omittedHistory.acceptance.state, 'disagreement');
  assert.equal(omittedHistory.proposalCall.callable, false);
});

test('proposal flags and queue widths must match canonical lifecycle states', async () => {
  const scenario = lifecycleFixture({ queue: 'active' });
  await assert.rejects(
    readLifecycle(scenario, { proposalState: 4n, proposalSettled: true }),
    /state flags are incoherent/
  );
  await assert.rejects(
    readLifecycle(scenario, { proposalState: 5n, proposalSettled: false }),
    /state flags are incoherent/
  );
  await assert.rejects(
    readLifecycle(scenario, {
      proposalState: 1n, proposalSettled: false, proposalAccepted: true
    }),
    /state flags are incoherent/
  );
  await assert.rejects(
    readLifecycle(scenario, { queueExpiresAt: scenario.executeAfter }),
    /window is invalid/
  );
  await assert.rejects(
    readLifecycle(scenario, { queueExecuted: true, queueExpired: true }),
    /window is invalid/
  );
  await assert.rejects(
    readLifecycle(lifecycleFixture(), { queueExpired: true }),
    /window is invalid/
  );
});

test('paid requires exact execution proof and block-delta-consistent aggregate balances', async () => {
  const state = await readLifecycle(lifecycleFixture({ queue: 'active', paid: true }));
  assert.equal(state.acceptance.state, 'accepted');
  assert.equal(state.paymentState.state, 'paid');
  assert.equal(state.paymentState.evidence.blockDeltaConsistent, true);
  assert.equal(state.execution.state, 'paid');

  const ambiguous = await readLifecycle(
    lifecycleFixture({ queue: 'active', paid: true }), { balanceMismatch: true }
  );
  assert.equal(ambiguous.paymentState.state, 'unverified');
  assert.equal(ambiguous.paymentState.paid, false);
  assert.equal(ambiguous.execution.state, 'payment-unverified');
});

test('payment planner exposes exact calldata only and binds every step to one proposal', () => {
  const plan = prepareAgentPaymentTransactions({
    index: INDEX,
    gateway: GATEWAY,
    vault: VAULT,
    chainId: 11155111,
    payment: fixture.payment.canonicalHex,
    state: boundPaymentState({
      proposed: true,
      acceptance: { state: 'accepted', accepted: true, route: 'timeout' },
      queue: { executeAfter: 0n, expiresAt: 0n, executed: false, expired: false },
      queueCall: { callable: true, reason: null },
      execution: { state: 'not-queued', executableNow: false },
      paymentState: { state: 'not-paid', paid: false }
    })
  });
  assert.equal(plan.actionHash, fixture.payment.actionHash);
  assert.equal(plan.proposalId, fixture.payment.proposalId);
  assert.deepEqual(plan.steps.map(({ target }) => target), [INDEX, GATEWAY, VAULT, VAULT]);
  assert.equal(plan.steps.some((step) => Object.hasOwn(step, 'send')), false);
  assert.deepEqual(plan.steps.map(({ available }) => available), [false, false, true, false]);
  assert.match(plan.omissions, /Bond-token approval/);
});

test('payment planner fails closed on lifecycle disagreement or unverified evidence', () => {
  const plan = (state) => prepareAgentPaymentTransactions({
    index: INDEX, gateway: GATEWAY, vault: VAULT, chainId: 11155111,
    payment: fixture.payment.canonicalHex, state: boundPaymentState(state)
  });
  const pending = plan({
    proposed: false,
    acceptance: { state: 'pending', accepted: false, route: null },
    proposalCall: { callable: true, reason: null },
    queue: { executeAfter: 0n, expiresAt: 0n, executed: false, expired: false },
    execution: { state: 'not-accepted', executableNow: false },
    paymentState: { state: 'not-paid', paid: false }
  });
  const proposalDisagreement = plan({
    proposed: false,
    acceptance: { state: 'disagreement', accepted: false, route: null },
    proposalCall: { callable: false, reason: null },
    queue: { executeAfter: 0n, expiresAt: 0n, executed: false, expired: false },
    execution: { state: 'not-accepted', executableNow: false },
    paymentState: { state: 'not-paid', paid: false }
  });
  const queueDisagreement = plan({
    proposed: true,
    acceptance: { state: 'accepted', accepted: true, route: 'evaluated' },
    queue: { executeAfter: 0n, expiresAt: 0n, executed: false, expired: false },
    execution: { state: 'disagreement', executableNow: false },
    paymentState: { state: 'not-paid', paid: false }
  });
  const unverified = plan({
    proposed: false,
    acceptance: { state: 'pending', accepted: false, route: null },
    queue: { executeAfter: 0n, expiresAt: 0n, executed: false, expired: false },
    execution: { state: 'not-accepted', executableNow: false },
    paymentState: { state: 'unverified' }
  });
  const contradictory = plan({
    proposed: false,
    acceptance: { state: 'pending', accepted: true, route: null },
    queue: { executeAfter: 0n, expiresAt: 0n, executed: false, expired: false },
    execution: { state: 'not-accepted', executableNow: true },
    paymentState: { state: 'not-paid', paid: true }
  });
  const executable = plan({
    proposed: true,
    acceptance: { state: 'accepted', accepted: true, route: 'timeout' },
    queue: { executeAfter: 10n, expiresAt: 20n, executed: false, expired: false },
    execution: { state: 'executable-now', executableNow: true },
    paymentState: { state: 'not-paid', paid: false }
  });
  const falseExecutable = plan({
    proposed: true,
    acceptance: { state: 'disagreement', accepted: false, route: null },
    queue: { executeAfter: 10n, expiresAt: 20n, executed: false, expired: false },
    execution: { state: 'disagreement', executableNow: true },
    paymentState: { state: 'unverified', paid: false }
  });
  const stringQueue = plan({
    proposed: true,
    acceptance: { state: 'accepted', accepted: true, route: 'timeout' },
    queue: { executeAfter: '10', expiresAt: '20', executed: false, expired: false },
    execution: { state: 'executable-now', executableNow: true },
    paymentState: { state: 'not-paid', paid: false }
  });
  const zeroWidthQueue = plan({
    proposed: true,
    acceptance: { state: 'accepted', accepted: true, route: 'timeout' },
    queue: { executeAfter: 10n, expiresAt: 10n, executed: false, expired: false },
    execution: { state: 'executable-now', executableNow: true },
    paymentState: { state: 'not-paid', paid: false }
  });
  assert.equal(pending.steps[1].available, true);
  assert.equal(proposalDisagreement.steps[1].available, false);
  assert.equal(queueDisagreement.steps[2].available, false);
  assert.deepEqual(unverified.steps.slice(1).map((step) => step.available), [false, false, false]);
  assert.deepEqual(contradictory.steps.slice(1).map((step) => step.available), [false, false, false]);
  assert.equal(executable.steps[3].available, true);
  assert.equal(falseExecutable.steps[3].available, false);
  assert.equal(stringQueue.steps[3].available, false);
  assert.equal(zeroWidthQueue.steps[3].available, false);

  const identity = boundPaymentState({
    proposed: false,
    acceptance: { state: 'pending', accepted: false, route: null },
    proposalCall: { callable: true, reason: null },
    queue: { executeAfter: 0n, expiresAt: 0n, executed: false, expired: false },
    execution: { state: 'not-accepted', executableNow: false },
    paymentState: { state: 'not-paid', paid: false }
  });
  const prepare = (state) => prepareAgentPaymentTransactions({
    index: INDEX, gateway: GATEWAY, vault: VAULT, chainId: 11155111,
    payment: fixture.payment.canonicalHex, state
  });
  assert.throws(() => prepare({ ...identity, actionHash: digest('99') }), /does not bind/);
  assert.throws(
    () => prepare({ ...identity, proposalId: (BigInt(identity.proposalId) + 1n).toString() }),
    /does not bind/
  );
  assert.throws(() => prepare({
    ...identity,
    payment: { ...fixture.payment.input, recipient: address('ab') }
  }), /does not bind/);
});

test('payment selection keeps exact older digests and bounded inspection isolates failures', async () => {
  const records = Array.from({ length: 120 }, (_, index) => ({
    documentDigest: `0x${index.toString(16).padStart(64, '0')}`
  }));
  const selected = selectAgentPayments(records, { limit: 10, digest: records[0].documentDigest });
  assert.equal(selected.length, 10);
  assert.equal(selected.some((record) => record === records[0]), true);
  assert.throws(
    () => selectAgentPayments(records, { limit: 10, digest: digest('ff') }),
    /incomplete range/
  );
  let active = 0;
  let maximum = 0;
  const inspected = await inspectAgentPayments(records.slice(0, 8), 3, async (record) => {
    active += 1;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    if (record === records[4]) throw new Error('isolated RPC failure');
    return { record, state: 'ok' };
  });
  assert.ok(maximum <= 3);
  assert.equal(inspected.length, 8);
  assert.equal(inspected[4].record, records[4]);
  assert.match(inspected[4].error, /isolated RPC failure/);
  assert.equal(inspected[5].state, 'ok');
});

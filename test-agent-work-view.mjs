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
  keccak256,
  prepareAgentPaymentTransactions,
  readAgentPaymentState,
  readAgentWorkIndex,
  reconstructAgentWorkLogs,
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

function publishedLog(type, document, parentDigest, blockNumber, logIndex = 0n) {
  const kind = AGENT_WORK_KINDS[type];
  const documentDigest = agentDocumentDigest(document);
  return {
    address: INDEX,
    blockNumber: q(blockNumber),
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
    if (method === 'eth_getBlockByNumber') return { number: q(10), timestamp: q(20) };
    if (method === 'eth_getCode') return '0x';
    throw new Error(`unexpected ${method}`);
  };
  await assert.rejects(() => readAgentWorkIndex({
    request,
    config: { address: INDEX, runtimeCodeKeccak256: keccak256('0x6000'), startBlock: '1' },
    chainId: 11155111,
    vault: VAULT
  }), /predicted address is not a deployment/);
});

test('index verification pins code and logs to the finalized block', async () => {
  const code = '0x6000';
  const calls = [];
  const request = async (method, params) => {
    calls.push([method, params]);
    if (method === 'eth_chainId') return q(11155111);
    if (method === 'eth_getBlockByNumber') return { number: q(10), timestamp: q(20) };
    if (method === 'eth_getCode') return code;
    if (method === 'eth_getLogs') return [];
    throw new Error(`unexpected ${method}`);
  };
  const view = await readAgentWorkIndex({
    request,
    config: { address: INDEX, runtimeCodeKeccak256: keccak256(code), startBlock: '1' },
    chainId: 11155111,
    vault: VAULT
  });
  assert.equal(view.blockNumber, 10n);
  assert.deepEqual(calls.find(([method]) => method === 'eth_getBlockByNumber')[1], ['finalized', false]);
  assert.deepEqual(calls.find(([method]) => method === 'eth_getCode')[1], [INDEX, q(10)]);
  assert.equal(calls.find(([method]) => method === 'eth_getLogs')[1][0].toBlock, q(10));
});

function eventLog(address_, topicList, data, blockNumber = 10n, logIndex = 0n) {
  return {
    address: address_, topics: topicList, data,
    blockNumber: q(blockNumber), logIndex: q(logIndex), transactionHash: tx('77')
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
  proposalAccepted = true, timestamp = 150n, staticError = null, balanceMismatch = false
} = {}) {
  const proposalWords = [0n, 0n, 0n, 0n, 0n, 5n, 3n, 1n, proposalAccepted ? 1n : 0n, 0n, 1n];
  const hasQueue = scenario.queued.length === 1;
  const queueWords = hasQueue
    ? [scenario.executeAfter, scenario.expiresAt, scenario.executed.length ? 1n : 0n, 0n]
    : [0n, 0n, 0n, 0n];
  return async (method, params) => {
    if (method === 'eth_getLogs') {
      const { address: target, topics } = params[0];
      if (target === GATEWAY) return [scenario.proposal];
      if (target === ARBITRATION) return [scenario.settlement];
      if (topics[0] === AGENT_WORK_EVENTS.transferQueued) return scenario.queued;
      if (topics[0] === AGENT_WORK_EVENTS.transferExecuted) return scenario.executed;
    }
    if (method === 'eth_call') {
      const [{ to, data }, block] = params;
      if (to === ARBITRATION) return words(...proposalWords);
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
});

test('paid requires exact execution log and exact conserved balance deltas', async () => {
  const state = await readLifecycle(lifecycleFixture({ queue: 'active', paid: true }));
  assert.equal(state.acceptance.state, 'accepted');
  assert.equal(state.paymentState.state, 'paid');
  assert.equal(state.paymentState.evidence.exact, true);
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
    payment: fixture.payment.canonicalHex
  });
  assert.equal(plan.actionHash, fixture.payment.actionHash);
  assert.equal(plan.proposalId, fixture.payment.proposalId);
  assert.deepEqual(plan.steps.map(({ target }) => target), [INDEX, GATEWAY, VAULT, VAULT]);
  assert.equal(plan.steps.some((step) => Object.hasOwn(step, 'send')), false);
});

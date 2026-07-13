import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  AGENT_WORK_INDEX,
  AGENT_WORK_KINDS,
  agentDocumentDigest,
  agentPaymentTransferAction,
  buildAgentPayment,
  buildAgentReceipt,
  buildAgentTask,
  canonicalAgentDocument,
  decodeAgentDocumentPublishedLog,
  parseCanonicalAgentDocument,
  prepareAgentDocumentPublication,
  publishAgentDocumentCalldata,
  transferEvaluationPayload,
  validateAgentPayment,
  validateAgentPaymentBinding,
  validateAgentTask
} from './fao.js';

const fixture = JSON.parse(readFileSync(new URL('./agent-document-golden.json', import.meta.url)));
const cast = (...args) => execFileSync('cast', args, { encoding: 'utf8' }).trim();
const hex = (value) => `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;

test('agent kind preimages and canonical documents match the cross-language fixture', () => {
  assert.deepEqual(AGENT_WORK_KINDS, fixture.kinds);
  for (const [name, builder] of [
    ['task', buildAgentTask], ['receipt', buildAgentReceipt], ['payment', buildAgentPayment]
  ]) {
    const document = builder(fixture[name].input);
    assert.equal(hex(document), fixture[name].canonicalHex);
    assert.equal(agentDocumentDigest(document), fixture[name].digest);
  }
});

test('canonicalization uses codepoint order, explicit controls, and valid UTF-8', () => {
  assert.equal(
    hex(canonicalAgentDocument(fixture.unicodeKeyOrder.value)),
    fixture.unicodeKeyOrder.canonicalHex
  );
  const task = validateAgentTask(fixture.task.input);
  assert.equal(task.vault, `0x${'aa'.repeat(20)}`);
  assert.equal(Object.hasOwn(task, 'deadline'), false);
  assert.match(new TextDecoder().decode(buildAgentTask(task)), /\\u000a.*\\u0001/);
  assert.throws(() => canonicalAgentDocument({ value: '\ud800' }), /surrogates/);
  assert.throws(() => canonicalAgentDocument({ value: 1 }), /scalar leaf/);
});

test('noncanonical exact bytes retain a raw digest but fail document validation', () => {
  assert.equal(agentDocumentDigest(fixture.nonCanonical.hex), fixture.nonCanonical.rawDigest);
  assert.throws(() => parseCanonicalAgentDocument(fixture.nonCanonical.hex), /canonical/);
  assert.throws(() => validateAgentTask(fixture.nonCanonical.hex), /canonical/);
});

test('payment envelope binds the exact transfer and proposal domain', () => {
  const payment = fixture.payment;
  const action = agentPaymentTransferAction(payment.canonicalHex);
  assert.deepEqual(
    { ...action, amount: action.amount.toString() },
    payment.transferAction
  );
  assert.equal(
    transferEvaluationPayload(payment.input.chainId, payment.input.vault, action),
    payment.transferEvaluationPayload
  );
  const binding = validateAgentPaymentBinding(payment.canonicalHex, {
    chainId: payment.input.chainId,
    vault: payment.input.vault,
    action
  });
  assert.equal(binding.documentDigest, payment.digest);
  assert.equal(binding.actionHash, payment.actionHash);
  assert.equal(binding.proposalId, payment.proposalId);

  for (const [field, replacement] of [
    ['asset', `0x${'11'.repeat(20)}`],
    ['recipient', `0x${'22'.repeat(20)}`],
    ['amount', 1n],
    ['salt', `0x${'33'.repeat(32)}`]
  ]) {
    assert.throws(() => validateAgentPaymentBinding(payment.canonicalHex, {
      chainId: payment.input.chainId,
      vault: payment.input.vault,
      action: { ...action, [field]: replacement }
    }), /exact TransferAction/);
  }
  assert.throws(() => validateAgentPaymentBinding(payment.canonicalHex, {
    chainId: 1, vault: payment.input.vault, action
  }), /chainId/);
  assert.throws(() => validateAgentPaymentBinding(payment.canonicalHex, {
    chainId: payment.input.chainId, vault: `0x${'11'.repeat(20)}`, action
  }), /vault/);
});

test('schemas reject non-decimal integers, overflow, and unknown fields', () => {
  const { spec: _spec, ...external } = fixture.task.input;
  const externalTask = validateAgentTask({
    ...external,
    specDigest: `0x${'56'.repeat(32)}`,
    specUri: 'https://example.test/spec',
    deadline: '1760000000',
    reward: { asset: `0x${'00'.repeat(20)}`, amount: '1' }
  });
  assert.equal(externalTask.reward.amount, '1');
  assert.throws(() => validateAgentPayment({ ...fixture.payment.input, amount: '01' }), /decimal/);
  assert.throws(() => validateAgentPayment({
    ...fixture.payment.input, amount: (1n << 256n).toString()
  }), /uint256/);
  assert.throws(() => validateAgentTask({ ...fixture.task.input, unknown: 'value' }), /invalid fields/);
});

test('index publish calldata and Published log decoding match the Solidity ABI', () => {
  const receipt = fixture.receipt;
  const publication = prepareAgentDocumentPublication('receipt', receipt.input);
  assert.equal(publication.kind, AGENT_WORK_KINDS.receipt);
  assert.equal(publication.parentDigest, receipt.parentDigest);
  assert.equal(publication.documentDigest, receipt.digest);
  assert.equal(
    publishAgentDocumentCalldata(AGENT_WORK_KINDS.receipt, receipt.parentDigest, receipt.canonicalHex),
    cast(
      'calldata', 'publish(bytes32,bytes32,bytes)',
      AGENT_WORK_KINDS.receipt, receipt.parentDigest, receipt.canonicalHex
    )
  );
  assert.equal(
    AGENT_WORK_INDEX.publishedTopic,
    cast('keccak', 'Published(bytes32,bytes32,bytes32,address,bytes)')
  );
  const publisher = `0x${'69'.repeat(20)}`;
  const log = {
    topics: [
      AGENT_WORK_INDEX.publishedTopic,
      AGENT_WORK_KINDS.receipt,
      receipt.parentDigest,
      receipt.digest
    ],
    data: cast('abi-encode', 'f(address,bytes)', publisher, receipt.canonicalHex)
  };
  assert.deepEqual(decodeAgentDocumentPublishedLog(log), {
    kind: AGENT_WORK_KINDS.receipt,
    parentDigest: receipt.parentDigest,
    documentDigest: receipt.digest,
    publisher,
    document: receipt.canonicalHex
  });
  assert.throws(() => decodeAgentDocumentPublishedLog({
    ...log, topics: [...log.topics.slice(0, 3), `0x${'00'.repeat(32)}`]
  }), /digest/);
});

import assert from 'node:assert/strict';
import test from 'node:test';

import { selfServeRuntimeRecords, validateSelfServeManifest } from './selfserve-manifest.mjs';

const address = (byte) => `0x${byte.repeat(40)}`;
const hash = (byte) => `0x${byte.repeat(64)}`;
const transaction = (byte, nonce) => ({ hash: hash(byte), block: 100 + nonce, nonce, from: address('f') });
const record = (key, byte, nonce) => {
  const identity = {
    registrar: ['src/FaoGenesisRegistrar.sol', 'FaoGenesisRegistrar'],
    proposalImplementation: ['src/FAOFutarchyProposal.sol', 'FAOFutarchyProposal'],
    stackDeployer: ['src/FAOSiteStackDeployer.sol', 'FAOSiteStackDeployer']
  }[key];
  return {
    address: address(byte), source: identity[0], contract: identity[1], transaction: transaction(byte, nonce),
    creationCodeBytes: 10, creationCodeKeccak256: hash('a'), runtimeCodeBytes: 5, runtimeCodeKeccak256: hash('b')
  };
};

const active = () => ({
  schemaVersion: 1,
  network: 'sepolia',
  chainId: 11155111,
  registrar: record('registrar', '1', 1),
  prerequisites: {
    proposalImplementation: record('proposalImplementation', '2', 2),
    stackDeployer: record('stackDeployer', '3', 3)
  }
});

test('pre-deployment is explicit and has no invented setup addresses', () => {
  const value = validateSelfServeManifest({
    schemaVersion: 1, status: 'pre-deployment', network: 'sepolia', chainId: 11155111,
    registrar: null, prerequisites: {}
  });
  assert.equal(value.status, 'pre-deployment');
  assert.deepEqual(selfServeRuntimeRecords(value), {});
});

test('canonical setup manifest derives active status and exact runtime records', () => {
  const value = validateSelfServeManifest(active());
  assert.equal(value.status, 'active');
  assert.deepEqual(Object.keys(selfServeRuntimeRecords(value)), [
    'registrar', 'proposalImplementation', 'stackDeployer'
  ]);
});

test('setup manifest rejects clones, ambiguity, extra keys, and malformed evidence', () => {
  const wrongIdentity = active();
  wrongIdentity.registrar.contract = 'Clone';
  assert.throws(() => validateSelfServeManifest(wrongIdentity), /compiler identity/);

  const duplicate = active();
  duplicate.prerequisites.stackDeployer.address = duplicate.registrar.address;
  assert.throws(() => validateSelfServeManifest(duplicate), /addresses must be unique/);

  const extra = active();
  extra.owner = address('9');
  assert.throws(() => validateSelfServeManifest(extra), /contain exactly/);

  const badHash = active();
  badHash.registrar.runtimeCodeKeccak256 = hash('0');
  assert.throws(() => validateSelfServeManifest(badHash), /nonzero 32-byte hash/);
});

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { REQUIRED_CONTRACTS, validateDeploymentManifest } from './deployment-manifest.mjs';

const preDeployment = JSON.parse(await readFile(new URL('./deployment.json', import.meta.url), 'utf8'));
const address = (index) => `0x${index.toString(16).padStart(40, '0')}`;
const active = {
  ...preDeployment,
  status: 'active',
  deploymentTransaction: `0x${'ab'.repeat(32)}`,
  deploymentBlock: 123,
  currencyToken: address(100),
  contracts: Object.fromEntries(REQUIRED_CONTRACTS.map((key, index) => [key, address(index + 1)]))
};

test('accepts the empty pre-deployment and complete active manifests', () => {
  assert.equal(validateDeploymentManifest(preDeployment), preDeployment);
  assert.equal(validateDeploymentManifest(active), active);
});

test('rejects incomplete, extra, invalid, or duplicate active contracts', () => {
  for (const contracts of [
    Object.fromEntries(Object.entries(active.contracts).slice(1)),
    { ...active.contracts, unexpected: address(99) },
    { ...active.contracts, siteToken: '0x0' },
    { ...active.contracts, siteToken: active.contracts.spotPool.toUpperCase().replace('0X', '0x') }
  ]) {
    assert.throws(() => validateDeploymentManifest({ ...active, contracts }), /invalid deployment manifest/);
  }
});

test('rejects malformed active deployment metadata', () => {
  for (const change of [
    { chainId: 1 },
    { deploymentTransaction: '0x12' },
    { deploymentBlock: -1 },
    { deploymentBlock: 1.5 },
    { currencyToken: address(0) }
  ]) {
    assert.throws(() => validateDeploymentManifest({ ...active, ...change }), /invalid deployment manifest/);
  }
});

test('rejects contracts in pre-deployment state', () => {
  assert.throws(
    () => validateDeploymentManifest({ ...preDeployment, contracts: { siteToken: address(1) } }),
    /pre-deployment contracts must be empty/
  );
});

test('rejects noncanonical top-level fields in either state', () => {
  assert.throws(
    () => validateDeploymentManifest({ ...preDeployment, deploymentTransaction: `0x${'ab'.repeat(32)}` }),
    /top level must contain exactly/
  );
  assert.throws(
    () => validateDeploymentManifest({ ...active, unexpected: true }),
    /top level must contain exactly/
  );
});

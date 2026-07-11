import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('./flm.js', import.meta.url), 'utf8');
const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const {
  SELECTORS, encodeCreateLiquidityManager, encodeValidationConfig, formatUnits, parseUnits
} = module;

test('manager and proposal-source proposer getters use their distinct selectors', () => {
  const selector = (signature) => execFileSync('cast', ['sig', signature], { encoding: 'utf8' }).trim();
  assert.equal(SELECTORS.managerOfficialProposer, selector('OFFICIAL_PROPOSER()'));
  assert.equal(SELECTORS.sourceOfficialProposer, selector('officialProposer()'));
});

test('embedded creation code matches every hash pinned by the canonical factory', async () => {
  const manifest = JSON.parse(await readFile(new URL('./flm-deployment.json', import.meta.url), 'utf8'));
  const bundle = JSON.parse(await readFile(new URL('./flm-codes.json', import.meta.url), 'utf8'));
  for (const [codeKey, hashKey] of [
    ['proposalSource', 'proposalSourceCreationCodeHash'],
    ['adapter', 'adapterCreationCodeHash'],
    ['manager', 'managerCreationCodeHash']
  ]) {
    const actual = execFileSync('cast', ['keccak', bundle.creationCodes[codeKey]], { encoding: 'utf8' }).trim();
    assert.equal(actual, manifest.factory[hashKey]);
    assert.equal(actual, bundle.creationCodeHashes[hashKey]);
  }
});

test('validation config matches Solidity ABI encoding', () => {
  const addresses = Array.from({ length: 6 }, (_, index) => `0x${String(index + 1).padStart(40, '0')}`);
  const config = {
    enabled: true,
    expectedProposalToken: addresses[0],
    expectedCollateralToken: addresses[1],
    conditionalTokens: addresses[2],
    trustedOracle: addresses[3],
    realitio: addresses[4],
    trustedArbitrator: addresses[5],
    maxOpeningDelay: 1,
    minTimeout: 2,
    maxTimeout: 3,
    maxMinBond: 4,
    requirePools: true
  };
  const expected = execFileSync('cast', [
    'abi-encode',
    'f((bool,address,address,address,address,address,address,uint32,uint32,uint32,uint256,bool))',
    `(true,${addresses.join(',')},1,2,3,4,true)`
  ], { encoding: 'utf8' }).trim();
  assert.equal(encodeValidationConfig(config), expected);
  assert.equal(encodeValidationConfig({ enabled: false }), '0x');
});

test('factory calldata matches cast for both dynamic tuples', () => {
  const addresses = Array.from({ length: 6 }, (_, index) => `0x${String(index + 1).padStart(40, '0')}`);
  const params = {
    organization: addresses[0],
    owner: addresses[1],
    proposalManager: addresses[2],
    bootstrapRecipient: addresses[3],
    companyToken: addresses[4],
    officialProposer: addresses[5],
    lpTokenName: 'LP Name',
    lpTokenSymbol: 'LP',
    proposalValidationConfigData: '0x0102'
  };
  const codes = { proposalSource: '0x60', adapter: '0x6162', manager: '0x' };
  const signature = 'createLiquidityManager((address,address,address,address,address,address,string,string,bytes),(bytes,bytes,bytes))';
  const expected = execFileSync('cast', [
    'calldata', signature,
    `(${addresses.join(',')},"LP Name","LP",0x0102)`,
    '(0x60,0x6162,0x)'
  ], { encoding: 'utf8' }).trim();
  assert.equal(encodeCreateLiquidityManager(params, codes), expected);
});

test('decimal token amounts round-trip without floating point', () => {
  assert.equal(parseUnits('1.230045', 18), 1230045000000000000n);
  assert.equal(formatUnits(1230045000000000000n, 18), '1.230045');
  assert.throws(() => parseUnits('0.0001', 3), /more than 3 decimals/);
});

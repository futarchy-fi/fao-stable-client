import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

import {
  CORE_CODE_KEYS,
  FLM_CODE_KEYS,
  SELECTORS,
  approveCalldata,
  assertChainId,
  boolWord,
  claimCalldata,
  createPlan,
  depositToSpotCalldata,
  encodeBytes,
  encodeCoreCommitment,
  encodeCoreConfig,
  encodeFlmConfig,
  encodeGrantConfigs,
  encodeString,
  encodeTuple,
  hashCoreConfig,
  hashFlmConfig,
  keccak256,
  lifecycleCalldata,
  normalizeAddress,
  normalizeHex,
  predictCalldata,
  prepareRagequit,
  rawIpfsUri,
  redeemCalldata,
  refundCalldata,
  stageCalldata,
  uintWord
} from './fao.js';

const address = (value) => `0x${value.toString(16).padStart(40, '0')}`;
const hash = (byte) => `0x${byte.repeat(32)}`;
const cast = (...args) => execFileSync('cast', args, { encoding: 'utf8' }).trim();

const DEPENDENCY_TYPE = '(address,bytes32)';
const CORE_TYPE = `(${Array(9).fill(DEPENDENCY_TYPE).join(',')},uint256,uint256,uint256,uint256,uint32,uint32,uint256,string,string,string,string,string,string,uint64,uint64,uint256,uint256,uint256,uint256,uint256,uint16)`;
const GRANT_TYPE = '(address,uint64,uint64,uint256)';

function creationInput() {
  const dependency = (value) => ({ target: address(value), codehash: hash(value.toString(16).padStart(2, '0')) });
  const dependencies = Array.from({ length: 9 }, (_, index) => dependency(index + 1));
  const coreConfig = {
    proxyFactory: dependencies[0],
    spaceImplementation: dependencies[1],
    proposalValidationStrategy: dependencies[2],
    stackDeployer: dependencies[3],
    proposalImplementation: dependencies[4],
    weth: dependencies[5],
    conditionalTokens: dependencies[6],
    wrapped1155Factory: dependencies[7],
    uniswapV3Factory: dependencies[8],
    graduationThreshold: 1n,
    arbitrationTimeout: 2n,
    siteMinActivationBond: 3n,
    treasuryMinActivationBond: 4n,
    twapTimeout: 1_800n,
    twapWindow: 900n,
    spaceSaltNonce: 5n,
    daoURI: `ipfs://b${'a'.repeat(58)}`,
    metadataURI: `ipfs://b${'b'.repeat(58)}`,
    votingStrategyMetadataURI: `ipfs://b${'c'.repeat(58)}`,
    proposalValidationStrategyMetadataURI: `ipfs://b${'d'.repeat(58)}`,
    tokenName: 'TestFAO',
    tokenSymbol: 'TFAO',
    saleEnd: 2_000n,
    bootstrapDeadline: 3_000n,
    saleCap: 10n ** 18n,
    minimumRaise: 1_000n,
    tokenMaxSupply: 5n * 10n ** 18n,
    initialPrice: 10n ** 16n,
    slope: 0n,
    bootstrapBps: 5_000n
  };
  const grants = [{ beneficiary: address(10), start: 1_000n, duration: 2_000n, amount: 10n ** 18n }];
  const flmConfig = { positionManager: dependency(11) };
  const creationCodes = {
    receipt: '0x60006000',
    core: Object.fromEntries(CORE_CODE_KEYS.map((key, index) => [key, `0x60${index.toString(16).padStart(2, '0')}`])),
    flm: Object.fromEntries(FLM_CODE_KEYS.map((key, index) => [key, `0x61${index.toString(16).padStart(2, '0')}00`]))
  };
  return { registrar: address(12), coreConfig, grants, flmConfig, creationCodes, currentTimestamp: 1_000n };
}

function coreCastArgument(core) {
  const dependencies = [
    core.proxyFactory,
    core.spaceImplementation,
    core.proposalValidationStrategy,
    core.stackDeployer,
    core.proposalImplementation,
    core.weth,
    core.conditionalTokens,
    core.wrapped1155Factory,
    core.uniswapV3Factory
  ].map((dependency) => `(${dependency.target},${dependency.codehash})`);
  return `(${[
    ...dependencies,
    core.graduationThreshold,
    core.arbitrationTimeout,
    core.siteMinActivationBond,
    core.treasuryMinActivationBond,
    core.twapTimeout,
    core.twapWindow,
    core.spaceSaltNonce,
    core.daoURI,
    core.metadataURI,
    core.votingStrategyMetadataURI,
    core.proposalValidationStrategyMetadataURI,
    core.tokenName,
    core.tokenSymbol,
    core.saleEnd,
    core.bootstrapDeadline,
    core.saleCap,
    core.minimumRaise,
    core.tokenMaxSupply,
    core.initialPrice,
    core.slope,
    core.bootstrapBps
  ].join(',')})`;
}

const grantsCastArgument = (grants) => `[${grants.map((grant) => (
  `(${grant.beneficiary},${grant.start},${grant.duration},${grant.amount})`
)).join(',')}]`;

test('CIDv1 raw sha256 matches the canonical no-vote metadata golden vector', async () => {
  const metadata = '{"name":"No voting","description":"Compatibility-only Snapshot X strategy. It always returns zero voting power and never determines proposal status or execution.","properties":{"symbol":"NO-VOTE","decimals":0}}';
  assert.equal(
    await rawIpfsUri(metadata),
    'ipfs://bafkreidrtlsjgiarzgjb76opphwgu7flqanrxcijqbh7o3ycefzqz22hs4'
  );
});

test('dependency-free Ethereum Keccak-256 matches canonical vectors', () => {
  assert.equal(keccak256('0x'), '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470');
  assert.equal(keccak256('abc'), '0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45');
  assert.equal(keccak256(`0x${'a5'.repeat(200)}`), cast('keccak', `0x${'a5'.repeat(200)}`));
});

test('economic config ABI encodings and hashes match Solidity abi.encode', () => {
  const { coreConfig, grants, flmConfig, currentTimestamp } = creationInput();
  const coreArgument = coreCastArgument(coreConfig);
  const grantsArgument = grantsCastArgument(grants);
  const flmArgument = `((${flmConfig.positionManager.target},${flmConfig.positionManager.codehash}))`;
  const encodedCore = cast('abi-encode', `f(${CORE_TYPE})`, coreArgument);
  const encodedGrants = cast('abi-encode', `f(${GRANT_TYPE}[])`, grantsArgument);
  const encodedCommitment = cast(
    'abi-encode', `f(${CORE_TYPE},${GRANT_TYPE}[])`, coreArgument, grantsArgument
  );
  const encodedFlm = cast('abi-encode', `f((${DEPENDENCY_TYPE}))`, flmArgument);

  assert.equal(encodeCoreConfig(coreConfig), encodedCore);
  assert.equal(encodeGrantConfigs(grants), encodedGrants);
  assert.equal(encodeCoreCommitment(coreConfig, grants, currentTimestamp), encodedCommitment);
  assert.equal(encodeFlmConfig(flmConfig), encodedFlm);
  assert.equal(hashCoreConfig(coreConfig, grants, currentTimestamp), cast('keccak', encodedCommitment));
  assert.equal(hashFlmConfig(flmConfig), cast('keccak', encodedFlm));
});

test('self-serve creation plan matches registrar and receipt cast calldata', () => {
  const input = creationInput();
  const plan = createPlan(input);
  const coreArgument = coreCastArgument(input.coreConfig);
  const grantsArgument = grantsCastArgument(input.grants);
  const flmArgument = `((${input.flmConfig.positionManager.target},${input.flmConfig.positionManager.codehash}))`;
  const coreCodes = CORE_CODE_KEYS.map((key) => input.creationCodes.core[key]);
  const flmCodes = FLM_CODE_KEYS.map((key) => input.creationCodes.flm[key]);

  assert.deepEqual(Object.keys(plan), ['displayed', 'hashes', 'registrar', 'receipt']);
  assert.equal(plan.displayed.currentTimestamp, '1000');
  assert.equal(plan.displayed.coreConfig.saleCap, (10n ** 18n).toString());
  assert.equal(plan.hashes.core, hashCoreConfig(input.coreConfig, input.grants, input.currentTimestamp));
  assert.equal(plan.hashes.flm, hashFlmConfig(input.flmConfig));
  assert.equal(
    plan.registrar.stage,
    cast('calldata', 'stage(bytes32,bytes32,bytes)', plan.hashes.core, plan.hashes.flm, input.creationCodes.receipt)
  );
  assert.equal(
    plan.registrar.predict,
    cast('calldata', 'predict(bytes32,bytes32,bytes)', plan.hashes.core, plan.hashes.flm, input.creationCodes.receipt)
  );
  assert.equal(
    plan.receipt.deployCore,
    cast(
      'calldata', `deployCore(${CORE_TYPE},${GRANT_TYPE}[],bytes[])`,
      coreArgument, grantsArgument, `[${coreCodes.join(',')}]`
    )
  );
  assert.equal(
    plan.receipt.deployFlm,
    cast(
      'calldata', `deployFlm((${DEPENDENCY_TYPE}),bytes[])`,
      flmArgument, `[${flmCodes.join(',')}]`
    )
  );
});

test('self-serve creation rejects malformed economic and bytecode inputs', () => {
  const input = creationInput();
  assert.throws(
    () => createPlan({ ...input, currentTimestamp: 1.5 }),
    /current timestamp is invalid/
  );
  assert.throws(
    () => createPlan({
      ...input,
      coreConfig: { ...input.coreConfig, bootstrapDeadline: input.coreConfig.saleEnd }
    }),
    /bootstrapDeadline/
  );
  assert.throws(
    () => createPlan({
      ...input,
      grants: Array.from({ length: 33 }, () => input.grants[0])
    }),
    /more than 32/
  );
  assert.throws(
    () => createPlan({
      ...input,
      grants: [{ ...input.grants[0], duration: 0n }]
    }),
    /duration and amount/
  );
  assert.throws(
    () => createPlan({
      ...input,
      coreConfig: { ...input.coreConfig, tokenMaxSupply: 1n }
    }),
    /tokenMaxSupply/
  );
  assert.throws(
    () => createPlan({
      ...input,
      creationCodes: {
        ...input.creationCodes,
        core: { ...input.creationCodes.core, EXTRA: '0x60' }
      }
    }),
    /must contain exactly/
  );
  assert.throws(
    () => createPlan({
      ...input,
      creationCodes: { ...input.creationCodes, receipt: '0x' }
    }),
    /1\.\.49088 bytes/
  );
  assert.throws(
    () => hashCoreConfig({
      ...input.coreConfig,
      proxyFactory: { ...input.coreConfig.proxyFactory, codehash: hash('00') }
    }, input.grants),
    /codehash cannot be zero/
  );
});

test('core ABI words and dynamic tails match cast', () => {
  assert.equal(uintWord((1n << 256n) - 1n), 'f'.repeat(64));
  assert.equal(boolWord(false), '0'.repeat(64));
  assert.equal(
    `0x${encodeTuple([uintWord(7), { dynamic: encodeString('FAO') }, { dynamic: encodeBytes('0x0102') }])}`,
    cast('abi-encode', 'f(uint256,string,bytes)', '7', 'FAO', '0x0102')
  );
  assert.throws(() => boolWord(1), /true or false/);
  assert.throws(() => uintWord(-1), /invalid|fit/);
});

test('registrar stage and prediction calldata match the settled ABI', () => {
  const core = hash('ab');
  const flm = hash('cd');
  const baseCode = '0x6001600255';
  assert.equal(
    stageCalldata(core, flm, baseCode),
    cast('calldata', 'stage(bytes32,bytes32,bytes)', core, flm, baseCode)
  );
  assert.equal(
    predictCalldata(core, flm, baseCode),
    cast('calldata', 'predict(bytes32,bytes32,bytes)', core, flm, baseCode)
  );
});

test('economic and FLM action calldata match cast', () => {
  const user = address(1);
  const spender = address(2);
  assert.equal(claimCalldata(user), cast('calldata', 'claim(address)', user));
  assert.equal(refundCalldata(user), cast('calldata', 'refund(address)', user));
  assert.equal(
    depositToSpotCalldata(3, 4),
    cast('calldata', 'depositToSpot(uint256,uint256)', '3', '4')
  );
  assert.equal(
    redeemCalldata(5, user, true),
    cast('calldata', 'redeem(uint256,address,bool)', '5', user, 'true')
  );
  assert.equal(approveCalldata(spender, 6), cast('calldata', 'approve(address,uint256)', spender, '6'));
});

test('ragequit normalizes and exposes the exact sorted unique extra-asset list', () => {
  const user = address(9);
  const extra1 = address(1);
  const extra2 = address(2).toUpperCase().replace('0X', '0x');
  const native = address(0);
  const plan = prepareRagequit(7, user, [extra2, native, extra1, extra2]);
  assert.deepEqual(plan.extras, [native, extra1, address(2)]);
  assert.equal(
    plan.calldata,
    cast(
      'calldata',
      'ragequit(uint256,address,address[])',
      '7',
      user,
      `[${native},${extra1},${address(2)}]`
    )
  );
  assert.deepEqual(Object.keys(plan), ['extras', 'calldata']);
});

test('permissionless no-argument lifecycle calls use exact selectors', () => {
  for (const [action, signature] of [
    ['seal', 'seal()'],
    ['finalize', 'finalize()'],
    ['fail', 'fail()'],
    ['startNextEvaluation', 'startNextEvaluation()'],
    ['bootstrap', 'bootstrap()']
  ]) {
    assert.equal(lifecycleCalldata(action), cast('sig', signature));
    assert.equal(SELECTORS[action], cast('sig', signature));
  }
  assert.throws(() => lifecycleCalldata('approve'), /unsupported/);
});

test('chain, address, and hex validation fail closed', () => {
  assert.equal(assertChainId('0xaa36a7', 11155111), 11155111n);
  assert.equal(normalizeAddress(address(10).toUpperCase().replace('0X', '0x')), address(10));
  assert.equal(normalizeHex('0xABCD', 2), '0xabcd');
  assert.throws(() => assertChainId(0), /positive/);
  assert.throws(() => assertChainId(1, 11155111), /wrong chain/);
  assert.throws(() => normalizeAddress(address(0)), /zero address/);
  assert.throws(() => normalizeHex('abcd'), /0x-prefixed/);
  assert.throws(() => normalizeHex('0xabc'), /even-length/);
});

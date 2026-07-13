import { selfServeRuntimeRecords, validateSelfServeManifest } from './selfserve-manifest.mjs';
import { treasuryRuntimeRecords, validateTreasuryManifest } from './economic-manifest.mjs';
import * as fao from './fao.js';

export const SEPOLIA_CHAIN_ID = 11155111n;
const DRAFT_KEY = 'fao-stable-client:create-draft:v1';
const PREPARED_KEY = 'fao-stable-client:create-plan:v1';
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
  flmSealed: '0xe05abb68'
});
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

export async function verifyTreasuryManifest(manifest, request) {
  if (typeof request !== 'function') throw new Error('An RPC request function is required.');
  const records = treasuryRuntimeRecords(validateTreasuryManifest(manifest));
  const call = (to, data) => request('eth_call', [{ to, data }, 'latest']);
  const [executorCode, executorFromVault, vaultFromExecutor, vaultFromGateway, arbitrationFromGateway] =
    await Promise.all([
      request('eth_getCode', [records.executor, 'latest']),
      call(records.vault, TREASURY_VIEW_SELECTORS.executorFromVault),
      call(records.executor, TREASURY_VIEW_SELECTORS.vaultFromExecutor),
      call(records.gateway, TREASURY_VIEW_SELECTORS.vaultFromGateway),
      call(records.gateway, TREASURY_VIEW_SELECTORS.arbitrationFromGateway)
    ]);
  const code = fao.normalizeHex(executorCode, undefined, 'Treasury executor runtime code');
  if (code === '0x' || fao.keccak256(code) !== records.executorRuntimeCodeKeccak256) {
    throw new Error('Treasury executor runtime bytecode does not match the economic manifest.');
  }
  if (addressFromWord(executorFromVault, 'vault.TREASURY_EXECUTOR') !== records.executor
    || addressFromWord(vaultFromExecutor, 'executor.VAULT') !== records.vault
    || addressFromWord(vaultFromGateway, 'gateway.vault') !== records.vault
    || addressFromWord(arbitrationFromGateway, 'gateway.arbitration') !== records.arbitration) {
    throw new Error('Treasury vault, executor, gateway, and arbitration wiring does not match the manifest.');
  }
  return Object.freeze({ status: 'verified', ...records });
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
  treasuryFlow: null
};

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

function renderTreasuryGate() {
  const enabled = Boolean(treasuryNetworkReady());
  for (const form of elements.treasuryForms) form.querySelector('button[type="submit"]').disabled = !enabled;
  for (const button of elements.treasurySteps.querySelectorAll('button')) button.disabled = !enabled;
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
  const ready = currentGate().canTransact && state.creationBundle && state.creationPlan;
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

async function syncConnection(requestAccounts = false) {
  if (!window.ethereum) {
    renderGate();
    return;
  }
  const accounts = await rpc(requestAccounts ? 'eth_requestAccounts' : 'eth_accounts');
  state.account = accounts[0] || null;
  const [walletValue, rpcValue] = await Promise.all([rpc('eth_chainId'), rpc('net_version')]);
  state.walletChainId = chainId(walletValue, 'Wallet');
  state.rpcChainId = chainId(rpcValue, 'RPC');
  state.codeState = 'unchecked';
  state.codeMessage = 'Not checked';
  renderGate();

  if (state.manifest?.status === 'active' && state.account && state.walletChainId === state.rpcChainId
    && state.walletChainId === SEPOLIA_CHAIN_ID) {
    state.codeMessage = 'Checking manifest hashes…';
    renderGate();
    try {
      const result = await verifyRuntimeCode(state.manifest, rpc);
      state.codeState = result.status;
      state.codeMessage = `${result.checked.length} / ${result.checked.length} runtime hashes verified`;
    } catch (error) {
      state.codeState = 'mismatch';
      state.codeMessage = errorMessage(error);
    }
  }
  renderGate();
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

async function refreshReceiptState() {
  if (!state.creationPlan || !state.predictedReceipt) return;
  const code = fao.normalizeHex(
    await rpc('eth_getCode', [state.predictedReceipt, 'latest']), undefined, 'receipt runtime code'
  );
  state.receiptExists = code !== '0x';
  state.coreSealed = false;
  state.flmSealed = false;
  if (state.receiptExists) {
    const call = (data) => rpc('eth_call', [{ to: state.predictedReceipt, data }, 'latest']);
    const [coreHash, flmHash, coreSealed, flmSealed] = await Promise.all([
      call(RECEIPT_SELECTORS.coreHash), call(RECEIPT_SELECTORS.flmHash),
      call(RECEIPT_SELECTORS.coreSealed), call(RECEIPT_SELECTORS.flmSealed)
    ]);
    if (fao.normalizeHex(coreHash, 32, 'receipt core hash') !== state.creationPlan.hashes.core
      || fao.normalizeHex(flmHash, 32, 'receipt FLM hash') !== state.creationPlan.hashes.flm) {
      throw new Error('Predicted receipt code does not bind the prepared configuration.');
    }
    state.coreSealed = parseReturnedBool(coreSealed, 'coreSealed');
    state.flmSealed = parseReturnedBool(flmSealed, 'flmSealed');
    if (state.flmSealed && !state.coreSealed) throw new Error('Receipt reports FLM sealed before core.');
  }
  renderStages();
}

async function installPreparedInput(input, { persist = true } = {}) {
  if (!state.creationBundle) throw new Error('Creation bytecode is unavailable.');
  state.preparedInput = input;
  state.creationPlan = fao.createPlan({
    ...input,
    creationCodes: state.creationBundle.creationCodes
  });
  const result = await rpc('eth_call', [{
    to: state.creationPlan.registrar.target,
    data: state.creationPlan.registrar.predict
  }, 'latest']);
  state.predictedReceipt = parseReturnedAddress(result);
  if (persist) localStorage.setItem(PREPARED_KEY, JSON.stringify(input));
  await refreshReceiptState();
}

function invalidatePreparedPlan(message = '') {
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

async function prepareCreationPlan() {
  if (!elements.createForm.reportValidity()) return;
  const gate = currentGate();
  if (!gate.canTransact) throw new Error(gate.message);
  const block = await rpc('eth_getBlockByNumber', ['latest', false]);
  if (!block || typeof block.timestamp !== 'string') throw new Error('RPC returned no latest block timestamp.');
  const input = creationInputFromDraft(draftFromForm(), state.manifest, BigInt(block.timestamp));
  await fao.verifyAssetPolicyContracts(input.coreConfig, rpc);
  await installPreparedInput(input);
  setMessage(
    elements.stageStatus,
    `Exact plan prepared for ${state.predictedReceipt}. Review both configuration hashes before staging.`
  );
}

async function restorePreparedPlan() {
  const raw = localStorage.getItem(PREPARED_KEY);
  if (!raw || !window.ethereum || state.manifest?.status !== 'active') return;
  try {
    await installPreparedInput(JSON.parse(raw), { persist: false });
    setMessage(elements.stageStatus, `Restored exact plan for ${state.predictedReceipt}. On-chain stages were re-read.`);
  } catch (error) {
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
  throw new Error(`Timed out waiting for ${hash}. The exact plan remains saved for resume.`);
}

async function sendCreationStage(event) {
  const stage = event.currentTarget.dataset.stage;
  if (!state.creationPlan) throw new Error('Prepare and review an exact creation plan first.');
  await refreshReceiptState();
  const steps = {
    receipt: {
      ready: !state.receiptExists,
      target: state.creationPlan.registrar.target,
      data: state.creationPlan.registrar.stage
    },
    core: {
      ready: state.receiptExists && !state.coreSealed,
      target: state.predictedReceipt,
      data: state.creationPlan.receipt.deployCore
    },
    flm: {
      ready: state.coreSealed && !state.flmSealed,
      target: state.predictedReceipt,
      data: state.creationPlan.receipt.deployFlm
    }
  };
  const step = steps[stage];
  if (!step?.ready) throw new Error(`${stage} is not the next resumable stage.`);
  if (stage === 'core') {
    const block = await rpc('eth_getBlockByNumber', ['latest', false]);
    if (!block || BigInt(block.timestamp) >= BigInt(state.preparedInput.coreConfig.saleEnd)) {
      throw new Error('The prepared sale end is no longer in the future. Prepare a new FAO configuration.');
    }
  }
  const hash = await rpc('eth_sendTransaction', [{ from: state.account, to: step.target, data: step.data }]);
  setMessage(elements.stageStatus, `${stage} submitted: ${hash}. Waiting for confirmation…`);
  const receipt = await waitForReceipt(hash);
  if (BigInt(receipt.status) !== 1n) throw new Error(`${stage} transaction reverted: ${hash}`);
  await refreshReceiptState();
  setMessage(elements.stageStatus, `${stage} confirmed: ${hash}. Any account may continue the remaining stages.`);
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

async function loadTreasuryManifest(event) {
  event.preventDefault();
  if (!elements.treasuryManifestForm.reportValidity()) return;
  if (!state.account || state.walletChainId !== SEPOLIA_CHAIN_ID || state.rpcChainId !== SEPOLIA_CHAIN_ID) {
    throw new Error('Connect a wallet with matching Sepolia wallet and RPC chain IDs first.');
  }
  const manifest = JSON.parse(elements.treasuryManifestForm.elements.manifest.value);
  const records = await verifyTreasuryManifest(manifest, rpc);
  state.treasuryManifest = manifest;
  state.treasuryRecords = records;
  state.treasuryFlow = null;
  elements.treasuryPlan.hidden = true;
  elements.treasuryExecutor.textContent = records.executor;
  elements.treasuryVault.textContent = records.vault;
  setMessage(
    elements.treasuryStatus,
    'Executor runtime and vault ↔ executor ↔ gateway ↔ arbitration wiring verified on Sepolia.'
  );
  renderTreasuryGate();
}

function prepareTreasury(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  if (!state.treasuryRecords) throw new Error('Verify an active economic deployment manifest first.');
  const values = Object.fromEntries(new FormData(event.currentTarget).entries());
  let type;
  let route;
  let action;
  if (event.currentTarget === elements.treasuryTransferForm) {
    ({ route } = values);
    type = 'transfer';
    action = { asset: values.asset, recipient: values.recipient, amount: values.amount, salt: values.salt };
  } else if (event.currentTarget === elements.treasuryParamForm) {
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
  state.treasuryFlow = fao.prepareTreasuryFlow({
    chainId: SEPOLIA_CHAIN_ID,
    vault: records.vault,
    gateway: records.gateway,
    executor: records.executor,
    type,
    route,
    action
  });
  elements.treasuryAcceptance.textContent = state.treasuryFlow.acceptance;
  elements.treasurySteps.replaceChildren();
  state.treasuryFlow.steps.forEach((step, index) => {
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
    button.addEventListener('click', () => sendTreasuryStep(index).catch((error) => (
      setMessage(elements.treasuryStatus, errorMessage(error), true)
    )));
    item.append(detail, button);
    elements.treasurySteps.append(item);
  });
  elements.treasuryPlan.hidden = false;
  setMessage(
    elements.treasuryStatus,
    `Prepared ${state.treasuryFlow.steps.length} exact ${type} steps. Send only the next on-chain-ready step.`
  );
  renderTreasuryGate();
}

async function sendTreasuryStep(index) {
  if (!treasuryNetworkReady() || !state.treasuryFlow || !state.treasuryManifest) {
    throw new Error('Reconnect and verify the treasury manifest before sending.');
  }
  const fresh = await verifyTreasuryManifest(state.treasuryManifest, rpc);
  if (fresh.vault !== state.treasuryRecords.vault || fresh.executor !== state.treasuryRecords.executor) {
    throw new Error('Treasury manifest wiring changed.');
  }
  const step = state.treasuryFlow.steps[index];
  if (!step) throw new Error('Unknown treasury step.');
  const hash = await rpc('eth_sendTransaction', [{ from: state.account, to: step.target, data: step.data }]);
  setMessage(elements.treasuryStatus, `${step.label} submitted: ${hash}. Waiting for confirmation…`);
  const receipt = await waitForReceipt(hash);
  if (BigInt(receipt.status) !== 1n) throw new Error(`${step.label} reverted: ${hash}`);
  setMessage(
    elements.treasuryStatus,
    `${step.label} confirmed: ${hash}. Re-check acceptance and timing before sending the next step.`
  );
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
    treasuryCriticalForm: byId('treasury-critical-form')
  };
  elements.treasuryForms = Object.freeze([
    elements.treasuryTransferForm, elements.treasuryParamForm, elements.treasuryCriticalForm
  ]);
}

async function initialize() {
  bindElements();
  elements.createForm.addEventListener('submit', saveDraft);
  elements.createForm.addEventListener('input', () => invalidatePreparedPlan('Draft changed. Prepare a new exact plan before staging.'));
  elements.preparePlan.addEventListener('click', () => prepareCreationPlan().catch((error) => setMessage(elements.stageStatus, errorMessage(error), true)));
  elements.clearDraft.addEventListener('click', clearDraft);
  elements.ragequitForm.addEventListener('submit', prepareRagequit);
  elements.treasuryManifestForm.addEventListener('submit', (event) => (
    loadTreasuryManifest(event).catch((error) => setMessage(elements.treasuryStatus, errorMessage(error), true))
  ));
  elements.treasuryManifestForm.addEventListener('input', () => {
    state.treasuryManifest = null;
    state.treasuryRecords = null;
    state.treasuryFlow = null;
    elements.treasuryPlan.hidden = true;
    elements.treasuryExecutor.textContent = 'Not verified';
    elements.treasuryVault.textContent = 'Not verified';
    renderTreasuryGate();
  });
  for (const form of elements.treasuryForms) form.addEventListener('submit', (event) => {
    try {
      prepareTreasury(event);
    } catch (error) {
      setMessage(elements.treasuryStatus, errorMessage(error), true);
    }
  });
  elements.showUnverified.addEventListener('change', renderInstances);
  elements.connect.addEventListener('click', () => syncConnection(true).catch((error) => setMessage(elements.connectionMessage, errorMessage(error), true)));
  elements.refresh.addEventListener('click', () => syncConnection(false).catch((error) => setMessage(elements.connectionMessage, errorMessage(error), true)));
  for (const form of document.querySelectorAll('#buy-form, #deposit-form, #redeem-form')) form.addEventListener('submit', unavailableAction);
  for (const button of document.querySelectorAll('[data-stage]')) button.addEventListener('click', (event) => sendCreationStage(event).catch((error) => setMessage(elements.stageStatus, errorMessage(error), true)));
  for (const button of document.querySelectorAll('[data-action], #execute-ragequit')) button.addEventListener('click', unavailableAction);

  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', () => syncConnection(false).catch((error) => setMessage(elements.connectionMessage, errorMessage(error), true)));
    window.ethereum.on('chainChanged', () => syncConnection(false).catch((error) => setMessage(elements.connectionMessage, errorMessage(error), true)));
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

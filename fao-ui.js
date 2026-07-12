import { validateDeploymentManifest } from './deployment-manifest.mjs';
import * as fao from './fao.js';

export const SEPOLIA_CHAIN_ID = 11155111n;
const DRAFT_KEY = 'fao-stable-client:create-draft:v1';
// Display curation is intentionally independent from permissionless registrar state.
const CURATED_INSTANCES = Object.freeze([]);

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

function runtimeHashes(manifest) {
  const hashes = manifest.runtimeCodeHashes;
  if (!hashes || Array.isArray(hashes) || typeof hashes !== 'object') {
    throw new Error('Active deployment manifest has no runtimeCodeHashes map.');
  }
  const contractKeys = Object.keys(manifest.contracts);
  const hashKeys = Object.keys(hashes);
  if (contractKeys.length !== hashKeys.length || contractKeys.some((key) => !hashKeys.includes(key))) {
    throw new Error('Runtime hash keys must exactly match deployment contract keys.');
  }
  return hashes;
}

export async function verifyRuntimeCode(manifest, request) {
  if (manifest.status === 'pre-deployment') return Object.freeze({ status: 'unavailable', checked: Object.freeze([]) });
  if (manifest.status !== 'active') throw new Error('Cannot verify a non-active deployment.');
  if (typeof request !== 'function') throw new Error('An RPC request function is required.');

  const hashes = runtimeHashes(manifest);
  const checked = await Promise.all(Object.entries(manifest.contracts).map(async ([name, address]) => {
    const expected = fao.normalizeHex(hashes[name], 32, `${name} runtime hash`);
    const code = fao.normalizeHex(await request('eth_getCode', [address, 'latest']), undefined, `${name} runtime code`);
    if (code === '0x') throw new Error(`${name} has no runtime code.`);
    const actual = fao.keccak256(code);
    if (actual !== expected) throw new Error(`${name} runtime bytecode does not match the manifest.`);
    return name;
  }));
  return Object.freeze({ status: 'verified', checked: Object.freeze(checked) });
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
  instances: [],
  ragequitPlan: null
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
  elements.refresh.disabled = !window.ethereum;
  for (const button of document.querySelectorAll('[data-write]')) {
    button.disabled = !gate.canTransact || (button === elements.executeRagequit && !state.ragequitPlan);
  }
  setMessage(elements.connectionMessage, gate.message, gate.state.includes('wrong') || gate.state.includes('mismatch') || gate.state.includes('invalid') || gate.state.includes('disagreement'));
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
  const stages = state.manifest?.deploymentStages || {};
  for (const [name, fallback] of [
    ['receipt', 'No staged receipt found.'],
    ['core', 'Waiting for a verified receipt.'],
    ['flm', 'Waiting for a verified core.']
  ]) {
    const value = stages[name];
    elements.stageDetails[name].textContent = typeof value?.description === 'string'
      ? value.description.slice(0, 240)
      : fallback;
  }
}

async function loadManifest() {
  const response = await fetch('/deployment.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Deployment manifest HTTP ${response.status}.`);
  state.manifest = validateDeploymentManifest(await response.json());
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
    codeState: byId('code-state'), connect: byId('connect'), refresh: byId('refresh'),
    connectionMessage: byId('connection-message'), createForm: byId('create-form'), clearDraft: byId('clear-draft'),
    draftStatus: byId('draft-status'), stageStatus: byId('stage-status'), showUnverified: byId('show-unverified'),
    instanceCount: byId('instance-count'), instancesList: byId('instances-list'), instancesEmpty: byId('instances-empty'),
    ragequitForm: byId('ragequit-form'), executeRagequit: byId('execute-ragequit'),
    ragequitPlan: byId('ragequit-plan'), ragequitEmpty: byId('ragequit-empty'), ragequitAssets: byId('ragequit-assets'),
    ragequitCalldata: byId('ragequit-calldata'), liquidityStatus: byId('liquidity-status'),
    stageDetails: { receipt: byId('receipt-detail'), core: byId('core-detail'), flm: byId('flm-detail') }
  };
}

async function initialize() {
  bindElements();
  elements.createForm.addEventListener('submit', saveDraft);
  elements.clearDraft.addEventListener('click', clearDraft);
  elements.ragequitForm.addEventListener('submit', prepareRagequit);
  elements.showUnverified.addEventListener('change', renderInstances);
  elements.connect.addEventListener('click', () => syncConnection(true).catch((error) => setMessage(elements.connectionMessage, errorMessage(error), true)));
  elements.refresh.addEventListener('click', () => syncConnection(false).catch((error) => setMessage(elements.connectionMessage, errorMessage(error), true)));
  for (const form of document.querySelectorAll('#buy-form, #deposit-form, #redeem-form')) form.addEventListener('submit', unavailableAction);
  for (const button of document.querySelectorAll('[data-stage], [data-action], #execute-ragequit')) button.addEventListener('click', unavailableAction);

  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', () => syncConnection(false).catch((error) => setMessage(elements.connectionMessage, errorMessage(error), true)));
    window.ethereum.on('chainChanged', () => syncConnection(false).catch((error) => setMessage(elements.connectionMessage, errorMessage(error), true)));
  }

  restoreDraft();
  try {
    await loadManifest();
    await syncConnection(false);
  } catch (error) {
    state.manifest = null;
    state.codeState = 'mismatch';
    state.codeMessage = errorMessage(error);
    renderGate();
  }
}

if (typeof document !== 'undefined') initialize();

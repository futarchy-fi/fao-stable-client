const CREATE_SELECTOR = 'c9056e87';
const CREATED_TOPIC = '0xc19b778e15f67624783a11665b3962f4251e1e09bc3492d8f8e5eb4659053cba';
const GNOSIS_CHAIN_HEX = '0x64';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const SELECTORS = {
  positionManager: '0x1bea83fe',
  algebraFactory: '0x9949da1f',
  conditionalRouter: '0xcd91811e',
  poolStabilityGuard: '0xb7a44a99',
  wrappedNative: '0xd999984d',
  defaultTickLower: '0x820c161e',
  defaultTickUpper: '0x94e49769',
  proposalSourceCreationCodeHash: '0x296bd630',
  adapterCreationCodeHash: '0x59f06526',
  managerCreationCodeHash: '0x461d4ffe',
  initialized: '0x42447a4f',
  conditionalMode: '0xe43f2504',
  emergencyExitArmedAt: '0xd13fac6e',
  owner: '0x8da5cb5b',
  bootstrapRecipient: '0x347d2de2',
  officialProposer: '0x38056b22',
  proposalSource: '0xb1b327ee',
  proposalManager: '0x02f89be2',
  companyToken: '0xca8eb0ba',
  totalSupply: '0x18160ddd',
  balanceOf: '0x70a08231',
  allowance: '0xdd62ed3e',
  approve: '0x095ea7b3',
  symbol: '0x95d89b41',
  decimals: '0x313ce567',
  depositToSpot: '0x062f6512',
  redeem: '0x5236be40'
};

export function strip0x(value) {
  return String(value).replace(/^0x/i, '');
}

function assertHex(value, label = 'hex value') {
  const hex = strip0x(value);
  if (hex.length % 2 || !/^[0-9a-fA-F]*$/.test(hex)) throw new Error(`Invalid ${label}.`);
  return hex.toLowerCase();
}

export function uintWord(value, bits = 256) {
  let number;
  try {
    number = BigInt(value);
  } catch {
    throw new Error(`Invalid unsigned integer: ${value}`);
  }
  if (number < 0n || number >= (1n << BigInt(bits))) {
    throw new Error(`Unsigned integer exceeds uint${bits}: ${value}`);
  }
  return number.toString(16).padStart(64, '0');
}

export function addressWord(value, allowZero = false) {
  const address = String(value).trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid address: ${address || 'blank'}`);
  if (!allowZero && address.toLowerCase() === ZERO_ADDRESS) throw new Error('Zero address is not allowed.');
  return strip0x(address).toLowerCase().padStart(64, '0');
}

export function boolWord(value) {
  return uintWord(value ? 1 : 0);
}

export function encodeBytes(value) {
  const hex = assertHex(value, 'bytes');
  const paddedLength = Math.ceil(hex.length / 64) * 64;
  return uintWord(hex.length / 2) + hex.padEnd(paddedLength, '0');
}

export function encodeText(value) {
  const bytes = new TextEncoder().encode(String(value));
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return encodeBytes(`0x${hex}`);
}

export function encodeTuple(fields) {
  let tailBytes = 0;
  const tails = [];
  const head = fields.map((field) => {
    if (typeof field === 'string') {
      if (!/^[0-9a-f]{64}$/.test(field)) throw new Error('Static tuple field must be one ABI word.');
      return field;
    }
    const dynamic = assertHex(field.dynamic, 'dynamic tuple field');
    if (dynamic.length % 64) throw new Error('Dynamic tuple field must be 32-byte padded.');
    const offset = fields.length * 32 + tailBytes;
    tailBytes += dynamic.length / 2;
    tails.push(dynamic);
    return uintWord(offset);
  });
  return head.join('') + tails.join('');
}

export function encodeValidationConfig(config) {
  if (!config.enabled) return '0x';
  return `0x${[
    boolWord(true),
    addressWord(config.expectedProposalToken),
    addressWord(config.expectedCollateralToken),
    addressWord(config.conditionalTokens),
    addressWord(config.trustedOracle),
    addressWord(config.realitio),
    addressWord(config.trustedArbitrator),
    uintWord(config.maxOpeningDelay, 32),
    uintWord(config.minTimeout, 32),
    uintWord(config.maxTimeout, 32),
    uintWord(config.maxMinBond),
    boolWord(config.requirePools)
  ].join('')}`;
}

export function encodeCreateLiquidityManager(params, codes) {
  const paramsTuple = encodeTuple([
    addressWord(params.organization),
    addressWord(params.owner),
    addressWord(params.proposalManager),
    addressWord(params.bootstrapRecipient),
    addressWord(params.companyToken),
    addressWord(params.officialProposer),
    { dynamic: encodeText(params.lpTokenName) },
    { dynamic: encodeText(params.lpTokenSymbol) },
    { dynamic: encodeBytes(params.proposalValidationConfigData) }
  ]);
  const codesTuple = encodeTuple([
    { dynamic: encodeBytes(codes.proposalSource) },
    { dynamic: encodeBytes(codes.adapter) },
    { dynamic: encodeBytes(codes.manager) }
  ]);
  return `0x${CREATE_SELECTOR}${encodeTuple([
    { dynamic: paramsTuple },
    { dynamic: codesTuple }
  ])}`;
}

export function parseUnits(value, decimals) {
  const text = String(value).trim();
  if (!/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(text)) throw new Error(`Invalid token amount: ${text || 'blank'}`);
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > decimals) throw new Error(`Amount has more than ${decimals} decimals.`);
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction || '').padEnd(decimals, '0') || '0');
}

export function formatUnits(value, decimals) {
  const number = BigInt(value);
  const base = 10n ** BigInt(decimals);
  const whole = number / base;
  const fraction = (number % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function callData(selector, words = []) {
  return `${selector}${words.join('')}`;
}

function readWord(data, index = 0) {
  const hex = assertHex(data, 'RPC return data');
  const word = hex.slice(index * 64, (index + 1) * 64);
  if (word.length !== 64) throw new Error('Short RPC return data.');
  return word;
}

function decodeUint(data) {
  return BigInt(`0x${readWord(data)}`);
}

function decodeAddress(data) {
  return `0x${readWord(data).slice(24)}`;
}

function decodeBool(data) {
  return decodeUint(data) !== 0n;
}

function decodeInt24(data) {
  const masked = decodeUint(data) & ((1n << 24n) - 1n);
  return Number(masked >= (1n << 23n) ? masked - (1n << 24n) : masked);
}

function decodeString(data) {
  const hex = assertHex(data, 'string return data');
  if (hex.length === 64) {
    const bytes = hex.match(/../g).map((pair) => Number.parseInt(pair, 16));
    return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/\0+$/, '');
  }
  const offset = Number(BigInt(`0x${hex.slice(0, 64)}`));
  const length = Number(BigInt(`0x${hex.slice(offset * 2, offset * 2 + 64)}`));
  const start = offset * 2 + 64;
  const bytes = hex.slice(start, start + length * 2).match(/../g) || [];
  return new TextDecoder().decode(Uint8Array.from(bytes, (pair) => Number.parseInt(pair, 16)));
}

function sameAddress(left, right) {
  return left.toLowerCase() === right.toLowerCase();
}

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function errorMessage(error) {
  const message = error?.data?.message || error?.cause?.message || error?.message || 'Transaction failed.';
  return String(message).slice(0, 600);
}

let elements;
let state = {
  manifest: null,
  codes: null,
  account: null,
  chainId: null,
  factoryVerified: false,
  canaryVerified: false,
  canary: null,
  busy: false
};

async function rpc(method, params = []) {
  if (!window.ethereum) throw new Error('No injected wallet was detected.');
  return window.ethereum.request({ method, params });
}

async function ethCall(to, data) {
  const transaction = { to, data };
  if (state.account) transaction.from = state.account;
  return rpc('eth_call', [transaction, 'latest']);
}

function explorerLink(kind, value) {
  return `${state.manifest.explorer}/${kind}/${value}`;
}

function setStatus(element, message, transactionHash) {
  element.replaceChildren(document.createTextNode(message));
  if (transactionHash) {
    element.append(document.createTextNode(' '));
    const link = document.createElement('a');
    link.href = explorerLink('tx', transactionHash);
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = shortAddress(transactionHash);
    element.append(link);
  }
}

function addressLink(address, label = address) {
  const link = document.createElement('a');
  link.href = explorerLink('address', address);
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  return link;
}

function appendDetail(label, value) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const detail = document.createElement('dd');
  term.textContent = label;
  detail.textContent = value;
  row.append(term, detail);
  elements.factoryDetails.append(row);
}

function renderManifest() {
  const { manifest } = state;
  elements.factoryAddress.textContent = manifest.factory.address;
  elements.factoryLink.href = explorerLink('address', manifest.factory.address);
  elements.factoryLink.target = '_blank';
  elements.factoryLink.rel = 'noreferrer';
  elements.sourceCommit.textContent = manifest.sourceCommit;
  elements.formSourceCommit.textContent = manifest.sourceCommit;
  elements.sourceLink.href = `${manifest.sourceRepository}/commit/${manifest.sourceCommit}`;
  elements.sourceLink.target = '_blank';
  elements.sourceLink.rel = 'noreferrer';
  elements.canaryManager.textContent = manifest.canary.manager;
  elements.canaryManagerLink.href = explorerLink('address', manifest.canary.manager);
  elements.canaryManagerLink.target = '_blank';
  elements.canaryManagerLink.rel = 'noreferrer';
  elements.canarySource.textContent = manifest.canary.proposalSource;
  elements.canarySourceLink.href = explorerLink('address', manifest.canary.proposalSource);
  elements.canarySourceLink.target = '_blank';
  elements.canarySourceLink.rel = 'noreferrer';
  elements.canaryOwner.textContent = manifest.canary.owner;
  elements.canaryProposalManager.textContent = manifest.canary.proposalManager;
  elements.canaryBootstrap.textContent = manifest.canary.bootstrapRecipient;
  elements.canaryOfficialProposer.textContent = manifest.canary.officialProposer;

  elements.factoryDetails.replaceChildren();
  for (const [label, value] of [
    ['Position manager', manifest.factory.positionManager],
    ['Algebra factory', manifest.factory.algebraFactory],
    ['Conditional router', manifest.factory.conditionalRouter],
    ['Pool stability guard', manifest.factory.poolStabilityGuard],
    ['Collateral token', manifest.factory.wrappedNative],
    ['Default ticks', `${manifest.factory.defaultTickLower} … ${manifest.factory.defaultTickUpper}`],
    ['Proposal source creation hash', manifest.factory.proposalSourceCreationCodeHash],
    ['Adapter creation hash', manifest.factory.adapterCreationCodeHash],
    ['Manager creation hash', manifest.factory.managerCreationCodeHash]
  ]) appendDetail(label, value);

  const defaults = manifest.validationDefaults;
  const form = elements.createForm.elements;
  form.expectedCollateralToken.value = defaults.expectedCollateralToken;
  form.conditionalTokens.value = defaults.conditionalTokens;
  form.realitio.value = defaults.realitio;
  form.trustedArbitrator.value = defaults.trustedArbitrator;
  form.maxOpeningDelay.value = defaults.maxOpeningDelay;
  form.minTimeout.value = defaults.minTimeout;
  form.maxTimeout.value = defaults.maxTimeout;
  form.maxMinBond.value = defaults.maxMinBond;
  form.requirePools.checked = defaults.requirePools;
}

function validateStaticFiles(manifest, codes) {
  if (manifest.schemaVersion !== 1 || manifest.chainId !== 100) throw new Error('Invalid FLM deployment manifest.');
  if (codes.schemaVersion !== 1 || codes.sourceCommit !== manifest.sourceCommit) throw new Error('Creation-code provenance mismatch.');
  for (const key of ['proposalSource', 'adapter', 'manager']) {
    const code = assertHex(codes.creationCodes[key], `${key} creation code`);
    if (!code.length) throw new Error(`Empty ${key} creation code.`);
  }
  for (const key of ['proposalSourceCreationCodeHash', 'adapterCreationCodeHash', 'managerCreationCodeHash']) {
    if (codes.creationCodeHashes[key].toLowerCase() !== manifest.factory[key].toLowerCase()) {
      throw new Error(`${key} does not match the reviewed manifest.`);
    }
  }
}

async function loadStaticFiles() {
  const [manifestResponse, codesResponse] = await Promise.all([
    fetch('/flm-deployment.json', { cache: 'no-store' }),
    fetch('/flm-codes.json', { cache: 'no-store' })
  ]);
  if (!manifestResponse.ok || !codesResponse.ok) throw new Error('Unable to load FLM deployment data.');
  const manifest = await manifestResponse.json();
  const codes = await codesResponse.json();
  validateStaticFiles(manifest, codes);
  state.manifest = manifest;
  state.codes = codes.creationCodes;
  renderManifest();
}

async function requestGnosisChain() {
  try {
    await rpc('wallet_switchEthereumChain', [{ chainId: GNOSIS_CHAIN_HEX }]);
  } catch (error) {
    if (error?.code !== 4902) throw error;
    await rpc('wallet_addEthereumChain', [{
      chainId: GNOSIS_CHAIN_HEX,
      chainName: 'Gnosis Chain',
      nativeCurrency: { name: 'xDAI', symbol: 'xDAI', decimals: 18 },
      rpcUrls: ['https://rpc.gnosischain.com'],
      blockExplorerUrls: ['https://gnosisscan.io']
    }]);
  }
}

function renderWallet() {
  const connected = Boolean(state.account);
  const correctChain = state.chainId === 100;
  elements.walletAccount.textContent = connected ? state.account : '—';
  elements.walletChain.textContent = state.chainId == null ? '—' : String(state.chainId);
  elements.walletBadge.textContent = !connected ? 'Not connected' : correctChain ? 'Connected' : 'Wrong network';
  elements.walletBadge.className = correctChain && connected ? 'status verified' : 'status unverified';
  updateButtons();
}

async function syncWallet(requestAccounts = false) {
  if (!window.ethereum) {
    setStatus(elements.walletMessage, 'No injected wallet was detected.');
    return;
  }
  const accounts = await rpc(requestAccounts ? 'eth_requestAccounts' : 'eth_accounts');
  state.account = accounts[0] || null;
  state.chainId = Number.parseInt(await rpc('eth_chainId'), 16);
  renderWallet();
}

async function connectWallet() {
  try {
    await syncWallet(true);
    if (state.chainId !== 100) {
      setStatus(elements.walletMessage, 'Requesting Gnosis Chain in the wallet…');
      await requestGnosisChain();
      await syncWallet(false);
    }
    if (state.chainId !== 100) throw new Error('Wallet is not connected to Gnosis Chain.');
    setStatus(elements.walletMessage, 'Connected. Contract reads use the injected wallet provider.');
    await refreshOnchain();
  } catch (error) {
    setStatus(elements.walletMessage, errorMessage(error));
  }
}

async function readFactory() {
  const factory = state.manifest.factory;
  const factoryAddress = factory.address;
  const code = await rpc('eth_getCode', [factoryAddress, 'latest']);
  if (code === '0x') throw new Error('Canonical factory has no code on Gnosis Chain.');

  const checks = [
    ['position manager', SELECTORS.positionManager, factory.positionManager, decodeAddress, sameAddress],
    ['Algebra factory', SELECTORS.algebraFactory, factory.algebraFactory, decodeAddress, sameAddress],
    ['conditional router', SELECTORS.conditionalRouter, factory.conditionalRouter, decodeAddress, sameAddress],
    ['pool stability guard', SELECTORS.poolStabilityGuard, factory.poolStabilityGuard, decodeAddress, sameAddress],
    ['collateral token', SELECTORS.wrappedNative, factory.wrappedNative, decodeAddress, sameAddress],
    ['lower tick', SELECTORS.defaultTickLower, factory.defaultTickLower, decodeInt24, (a, b) => a === b],
    ['upper tick', SELECTORS.defaultTickUpper, factory.defaultTickUpper, decodeInt24, (a, b) => a === b],
    ['proposal source hash', SELECTORS.proposalSourceCreationCodeHash, factory.proposalSourceCreationCodeHash, (v) => `0x${readWord(v)}`, (a, b) => a.toLowerCase() === b.toLowerCase()],
    ['adapter hash', SELECTORS.adapterCreationCodeHash, factory.adapterCreationCodeHash, (v) => `0x${readWord(v)}`, (a, b) => a.toLowerCase() === b.toLowerCase()],
    ['manager hash', SELECTORS.managerCreationCodeHash, factory.managerCreationCodeHash, (v) => `0x${readWord(v)}`, (a, b) => a.toLowerCase() === b.toLowerCase()]
  ];

  const actual = await Promise.all(checks.map(([, selector]) => ethCall(factoryAddress, selector)));
  const mismatches = checks.flatMap(([label, , expected, decode, compare], index) => {
    const value = decode(actual[index]);
    return compare(value, expected) ? [] : [`${label}: ${value}`];
  });
  if (mismatches.length) throw new Error(`Factory immutable mismatch (${mismatches.join(', ')}).`);
  state.factoryVerified = true;
  elements.factoryBadge.textContent = 'Verified on chain';
  elements.factoryBadge.className = 'status verified';
  elements.factoryChecks.textContent = '10 / 10 match reviewed manifest';
}

async function readTokenMetadata(token) {
  const [symbolResult, decimalsResult] = await Promise.all([
    ethCall(token, SELECTORS.symbol),
    ethCall(token, SELECTORS.decimals)
  ]);
  return { symbol: decodeString(symbolResult), decimals: Number(decodeUint(decimalsResult)) };
}

async function readCanary() {
  const canary = state.manifest.canary;
  const manager = canary.manager;
  const source = canary.proposalSource;
  const accountWord = addressWord(state.account);
  const allowanceWords = [accountWord, addressWord(manager)];
  const calls = await Promise.all([
    ethCall(manager, SELECTORS.initialized),
    ethCall(manager, SELECTORS.conditionalMode),
    ethCall(manager, SELECTORS.emergencyExitArmedAt),
    ethCall(manager, SELECTORS.owner),
    ethCall(manager, SELECTORS.bootstrapRecipient),
    ethCall(manager, SELECTORS.officialProposer),
    ethCall(manager, SELECTORS.proposalSource),
    ethCall(manager, SELECTORS.companyToken),
    ethCall(manager, SELECTORS.wrappedNative),
    ethCall(source, SELECTORS.owner),
    ethCall(source, SELECTORS.proposalManager),
    ethCall(manager, callData(SELECTORS.balanceOf, [accountWord])),
    ethCall(manager, SELECTORS.totalSupply),
    ethCall(canary.companyToken, callData(SELECTORS.allowance, allowanceWords)),
    ethCall(canary.collateralToken, callData(SELECTORS.allowance, allowanceWords)),
    readTokenMetadata(canary.companyToken),
    readTokenMetadata(canary.collateralToken),
    readTokenMetadata(manager)
  ]);
  const [initialized, conditionalMode, emergencyAt, managerOwner, bootstrap, official, proposalSource,
    company, collateral, sourceOwner, proposalManager, shares, supply, companyAllowance,
    collateralAllowance, companyMetadata, collateralMetadata, shareMetadata] = calls;

  const authorityChecks = [
    [decodeAddress(managerOwner), canary.owner],
    [decodeAddress(bootstrap), canary.bootstrapRecipient],
    [decodeAddress(official), canary.officialProposer],
    [decodeAddress(proposalSource), canary.proposalSource],
    [decodeAddress(company), canary.companyToken],
    [decodeAddress(collateral), canary.collateralToken],
    [decodeAddress(sourceOwner), canary.owner],
    [decodeAddress(proposalManager), canary.proposalManager]
  ];
  if (!authorityChecks.every(([actual, expected]) => sameAddress(actual, expected))) {
    throw new Error('Canary authority or immutable wiring no longer matches the reviewed manifest.');
  }

  state.canaryVerified = true;
  state.canary = {
    initialized: decodeBool(initialized),
    conditionalMode: decodeBool(conditionalMode),
    emergencyAt: decodeUint(emergencyAt),
    shares: decodeUint(shares),
    supply: decodeUint(supply),
    companyAllowance: decodeUint(companyAllowance),
    collateralAllowance: decodeUint(collateralAllowance),
    company: companyMetadata,
    collateral: collateralMetadata,
    share: shareMetadata
  };
  renderCanary();
}

function renderCanary() {
  const canary = state.canary;
  const mode = canary.conditionalMode ? 'conditional' : 'spot';
  const initialized = canary.initialized ? 'initialized' : 'not initialized';
  const emergency = canary.emergencyAt > 0n ? ` · emergency armed at ${canary.emergencyAt}` : '';
  elements.canaryMode.textContent = `${mode} · ${initialized}${emergency} · authorities verified`;
  elements.canaryPair.textContent = `${canary.company.symbol} / ${canary.collateral.symbol}`;
  elements.shareBalance.textContent = `${formatUnits(canary.shares, canary.share.decimals)} ${canary.share.symbol}`;
  elements.shareSupply.textContent = `${formatUnits(canary.supply, canary.share.decimals)} ${canary.share.symbol}`;
  elements.allowances.textContent = `${formatUnits(canary.companyAllowance, canary.company.decimals)} ${canary.company.symbol} · ${formatUnits(canary.collateralAllowance, canary.collateral.decimals)} ${canary.collateral.symbol}`;
  elements.companyInputLabel.textContent = `${canary.company.symbol} maximum`;
  elements.collateralInputLabel.textContent = `${canary.collateral.symbol} maximum`;
  updateButtons();
}

async function refreshOnchain() {
  if (!state.account || state.chainId !== 100 || !state.manifest) return;
  state.factoryVerified = false;
  state.canaryVerified = false;
  elements.factoryBadge.textContent = 'Checking';
  elements.factoryChecks.textContent = 'Reading immutable values…';
  updateButtons();
  const results = await Promise.allSettled([readFactory(), readCanary()]);
  if (results[0].status === 'rejected') {
    elements.factoryBadge.textContent = 'Mismatch';
    elements.factoryBadge.className = 'status error';
    elements.factoryChecks.textContent = errorMessage(results[0].reason);
  }
  if (results[1].status === 'rejected') {
    elements.canaryMode.textContent = errorMessage(results[1].reason);
  }
  updateButtons();
}

function validationFromForm(form) {
  const enabled = form.validationEnabled.checked;
  return {
    enabled,
    expectedProposalToken: form.expectedProposalToken.value,
    expectedCollateralToken: form.expectedCollateralToken.value,
    conditionalTokens: form.conditionalTokens.value,
    trustedOracle: form.trustedOracle.value,
    realitio: form.realitio.value,
    trustedArbitrator: form.trustedArbitrator.value,
    maxOpeningDelay: form.maxOpeningDelay.value,
    minTimeout: form.minTimeout.value,
    maxTimeout: form.maxTimeout.value,
    maxMinBond: form.maxMinBond.value,
    requirePools: form.requirePools.checked
  };
}

async function waitForReceipt(transactionHash) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const receipt = await rpc('eth_getTransactionReceipt', [transactionHash]);
    if (receipt) {
      if (BigInt(receipt.status) !== 1n) throw new Error('Transaction reverted.');
      return receipt;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Transaction is still pending; use the explorer link to follow it.');
}

async function sendTransaction(to, data, label, statusElement) {
  const transaction = { from: state.account, to, data };
  setStatus(statusElement, `Estimating ${label}…`);
  await rpc('eth_estimateGas', [transaction]);
  setStatus(statusElement, `Confirm ${label} in the wallet.`);
  const hash = await rpc('eth_sendTransaction', [transaction]);
  setStatus(statusElement, `${label} submitted.`, hash);
  const receipt = await waitForReceipt(hash);
  setStatus(statusElement, `${label} confirmed.`, hash);
  return { hash, receipt };
}

function parseCreatedBundle(receipt) {
  const log = receipt.logs.find((entry) =>
    sameAddress(entry.address, state.manifest.factory.address)
      && entry.topics[0]?.toLowerCase() === CREATED_TOPIC
  );
  if (!log || log.topics.length < 4) throw new Error('Confirmed transaction did not emit the expected factory event.');
  const data = assertHex(log.data, 'factory event data');
  if (data.length < 4 * 64) throw new Error('Short factory event data.');
  const eventAddress = (word) => `0x${word.slice(-40)}`;
  return {
    organization: eventAddress(strip0x(log.topics[1])),
    owner: eventAddress(strip0x(log.topics[2])),
    companyToken: eventAddress(strip0x(log.topics[3])),
    proposalSource: eventAddress(data.slice(0, 64)),
    spotAdapter: eventAddress(data.slice(64, 128)),
    conditionalAdapter: eventAddress(data.slice(128, 192)),
    manager: eventAddress(data.slice(192, 256))
  };
}

function renderCreatedBundle(bundle) {
  const heading = document.createElement('h3');
  heading.className = 'unverified';
  heading.textContent = 'Unverified bundle event';
  const warning = document.createElement('p');
  warning.textContent = 'The canonical factory created this code, but the organization field is still a caller claim. Registration or a signature is required for organization endorsement.';
  const list = document.createElement('ul');
  for (const [name, address] of Object.entries(bundle)) {
    const item = document.createElement('li');
    item.append(document.createTextNode(`${name}: `), addressLink(address, address));
    list.append(item);
  }
  elements.bundleResult.replaceChildren(heading, warning, list);
  elements.bundleResult.hidden = false;
}

async function createBundle(event) {
  event.preventDefault();
  if (!state.factoryVerified) return;
  const form = elements.createForm.elements;
  try {
    state.busy = true;
    updateButtons();
    const validationData = encodeValidationConfig(validationFromForm(form));
    const data = encodeCreateLiquidityManager({
      organization: form.organization.value,
      owner: form.owner.value,
      proposalManager: form.proposalManager.value,
      bootstrapRecipient: form.bootstrapRecipient.value,
      companyToken: form.companyToken.value,
      officialProposer: form.officialProposer.value,
      lpTokenName: form.lpTokenName.value,
      lpTokenSymbol: form.lpTokenSymbol.value,
      proposalValidationConfigData: validationData
    }, state.codes);
    const { receipt } = await sendTransaction(state.manifest.factory.address, data, 'bundle creation', elements.createStatus);
    renderCreatedBundle(parseCreatedBundle(receipt));
  } catch (error) {
    setStatus(elements.createStatus, errorMessage(error));
  } finally {
    state.busy = false;
    updateButtons();
  }
}

function tokenAmount(input, metadata) {
  const amount = parseUnits(input.value, metadata.decimals);
  if (amount === 0n) throw new Error('Amount must be greater than zero.');
  return amount;
}

async function approveToken(kind) {
  const isCompany = kind === 'company';
  const token = isCompany ? state.manifest.canary.companyToken : state.manifest.canary.collateralToken;
  const metadata = isCompany ? state.canary.company : state.canary.collateral;
  const input = isCompany ? elements.companyAmount : elements.collateralAmount;
  try {
    state.busy = true;
    updateButtons();
    const amount = tokenAmount(input, metadata);
    const data = callData(SELECTORS.approve, [addressWord(state.manifest.canary.manager), uintWord(amount)]);
    await sendTransaction(token, data, `${metadata.symbol} approval`, elements.vaultStatus);
    await readCanary();
  } catch (error) {
    setStatus(elements.vaultStatus, errorMessage(error));
  } finally {
    state.busy = false;
    updateButtons();
  }
}

async function depositToSpot() {
  try {
    state.busy = true;
    updateButtons();
    const companyAmount = tokenAmount(elements.companyAmount, state.canary.company);
    const collateralAmount = tokenAmount(elements.collateralAmount, state.canary.collateral);
    if (state.canary.companyAllowance < companyAmount || state.canary.collateralAllowance < collateralAmount) {
      throw new Error('Approve both entered maxima before depositing.');
    }
    const data = callData(SELECTORS.depositToSpot, [uintWord(companyAmount), uintWord(collateralAmount)]);
    await sendTransaction(state.manifest.canary.manager, data, 'spot deposit', elements.vaultStatus);
    await readCanary();
  } catch (error) {
    setStatus(elements.vaultStatus, errorMessage(error));
  } finally {
    state.busy = false;
    updateButtons();
  }
}

async function redeemShares() {
  try {
    state.busy = true;
    updateButtons();
    const shares = tokenAmount(elements.redeemShares, state.canary.share);
    if (shares > state.canary.shares) throw new Error('Share amount exceeds the connected wallet balance.');
    const data = callData(SELECTORS.redeem, [uintWord(shares), addressWord(state.account), boolWord(false)]);
    await sendTransaction(state.manifest.canary.manager, data, 'share redemption', elements.vaultStatus);
    await readCanary();
  } catch (error) {
    setStatus(elements.vaultStatus, errorMessage(error));
  } finally {
    state.busy = false;
    updateButtons();
  }
}

function updateButtons() {
  if (!elements) return;
  const connected = Boolean(state.account) && state.chainId === 100;
  elements.refresh.disabled = !connected || state.busy;
  elements.createSubmit.disabled = !connected || !state.factoryVerified || !state.codes || state.busy;
  const vaultReady = connected && state.canaryVerified && Boolean(state.canary) && !state.busy;
  const depositReady = vaultReady && state.canary.initialized && !state.canary.conditionalMode && state.canary.emergencyAt === 0n;
  elements.approveCompany.disabled = !depositReady;
  elements.approveCollateral.disabled = !depositReady;
  elements.deposit.disabled = !depositReady;
  elements.useShareBalance.disabled = !vaultReady || state.canary.shares === 0n;
  elements.redeem.disabled = !vaultReady || state.canary.shares === 0n;
}

function bindElements() {
  const byId = (id) => document.getElementById(id);
  elements = {
    walletBadge: byId('wallet-badge'), walletAccount: byId('wallet-account'), walletChain: byId('wallet-chain'),
    walletMessage: byId('wallet-message'), connect: byId('connect'), refresh: byId('refresh'),
    factoryBadge: byId('factory-badge'), factoryLink: byId('factory-link'), factoryAddress: byId('factory-address'),
    sourceLink: byId('source-link'), sourceCommit: byId('source-commit'), formSourceCommit: byId('form-source-commit'),
    factoryChecks: byId('factory-checks'), factoryDetails: byId('factory-details'), createForm: byId('create-form'),
    createSubmit: byId('create-submit'), createStatus: byId('create-status'), bundleResult: byId('bundle-result'),
    validationEnabled: byId('validation-enabled'), validationFields: byId('validation-fields'),
    canaryManagerLink: byId('canary-manager-link'), canaryManager: byId('canary-manager'),
    canarySourceLink: byId('canary-source-link'), canarySource: byId('canary-source'), canaryOwner: byId('canary-owner'),
    canaryProposalManager: byId('canary-proposal-manager'), canaryBootstrap: byId('canary-bootstrap'),
    canaryOfficialProposer: byId('canary-official-proposer'), canaryPair: byId('canary-pair'),
    canaryMode: byId('canary-mode'), shareBalance: byId('share-balance'), shareSupply: byId('share-supply'),
    allowances: byId('allowances'), companyInputLabel: byId('company-input-label'), collateralInputLabel: byId('collateral-input-label'),
    companyAmount: byId('company-amount'), collateralAmount: byId('collateral-amount'), approveCompany: byId('approve-company'),
    approveCollateral: byId('approve-collateral'), deposit: byId('deposit'), redeemShares: byId('redeem-shares'),
    useShareBalance: byId('use-share-balance'), redeem: byId('redeem'), vaultStatus: byId('vault-status')
  };
}

async function initialize() {
  bindElements();
  elements.connect.addEventListener('click', connectWallet);
  elements.refresh.addEventListener('click', refreshOnchain);
  elements.createForm.addEventListener('submit', createBundle);
  elements.validationEnabled.addEventListener('change', () => {
    elements.validationFields.disabled = !elements.validationEnabled.checked;
  });
  elements.createForm.elements.companyToken.addEventListener('blur', () => {
    if (!elements.createForm.elements.expectedProposalToken.value) {
      elements.createForm.elements.expectedProposalToken.value = elements.createForm.elements.companyToken.value;
    }
  });
  elements.approveCompany.addEventListener('click', () => approveToken('company'));
  elements.approveCollateral.addEventListener('click', () => approveToken('collateral'));
  elements.deposit.addEventListener('click', depositToSpot);
  elements.useShareBalance.addEventListener('click', () => {
    elements.redeemShares.value = formatUnits(state.canary.shares, state.canary.share.decimals);
  });
  elements.redeem.addEventListener('click', redeemShares);

  if (window.ethereum?.on) {
    window.ethereum.on('accountsChanged', async () => {
      await syncWallet(false);
      await refreshOnchain();
    });
    window.ethereum.on('chainChanged', async () => {
      await syncWallet(false);
      await refreshOnchain();
    });
  }

  try {
    await loadStaticFiles();
    await syncWallet(false);
    await refreshOnchain();
  } catch (error) {
    elements.factoryBadge.textContent = 'Client data error';
    elements.factoryBadge.className = 'status error';
    setStatus(elements.walletMessage, errorMessage(error));
  }
}

if (typeof document !== 'undefined') initialize();

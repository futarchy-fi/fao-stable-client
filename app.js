import { validateDeploymentManifest } from './deployment-manifest.mjs';

const elements = {
  status: document.querySelector('#deployment-status'),
  network: document.querySelector('#network'),
  chainId: document.querySelector('#chain-id'),
  walletState: document.querySelector('#wallet-state'),
  walletMessage: document.querySelector('#wallet-message'),
  connect: document.querySelector('#connect'),
  contracts: document.querySelector('#contracts'),
  contractsEmpty: document.querySelector('#contracts-empty'),
  governedSite: document.querySelector('#governed-site'),
  governedRepository: document.querySelector('#governed-repository')
};

let manifest;

function shortAddress(address) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function renderContracts(contracts, explorer) {
  const entries = Object.entries(contracts || {});
  elements.contracts.replaceChildren();
  elements.contracts.hidden = entries.length === 0;
  elements.contractsEmpty.hidden = entries.length !== 0;

  for (const [name, address] of entries) {
    const item = document.createElement('li');
    const label = document.createElement('strong');
    const link = document.createElement('a');
    const code = document.createElement('code');
    label.textContent = name;
    link.href = `${explorer}/address/${address}`;
    link.textContent = shortAddress(address);
    link.setAttribute('aria-label', `${name} ${address}`);
    code.textContent = address;
    item.append(label, link, code);
    elements.contracts.append(item);
  }
}

async function loadManifest() {
  const response = await fetch('/deployment.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`manifest HTTP ${response.status}`);
  const value = validateDeploymentManifest(await response.json());
  manifest = value;
  elements.status.textContent = value.status;
  elements.network.textContent = value.network;
  elements.chainId.textContent = String(value.chainId);
  elements.governedSite.href = value.governedSite;
  elements.governedRepository.href = value.governedRepository;
  renderContracts(value.contracts, value.explorer);
}

async function connectWallet() {
  if (!manifest) return;
  if (!window.ethereum) {
    elements.walletMessage.textContent = 'No injected wallet was detected.';
    return;
  }

  try {
    const [account] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    const chainHex = await window.ethereum.request({ method: 'eth_chainId' });
    const walletChain = Number.parseInt(chainHex, 16);
    elements.walletState.textContent = account ? shortAddress(account) : 'Not connected';
    elements.walletMessage.textContent = walletChain === manifest.chainId
      ? `Connected to ${manifest.network}.`
      : `Wrong network: wallet chain ${walletChain}; expected ${manifest.chainId}.`;
  } catch (error) {
    elements.walletMessage.textContent = error?.message || 'Wallet connection failed.';
  }
}

elements.connect.addEventListener('click', connectWallet);
loadManifest().catch((error) => {
  elements.status.textContent = 'manifest error';
  elements.walletMessage.textContent = error.message;
});

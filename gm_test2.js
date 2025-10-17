import { ethers } from 'ethers';
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { baseSepolia, optimismSepolia, sepolia } from '@reown/appkit/networks';

// Project config
const projectId = '3a5538ce9969461166625db3fdcbef8c';
const metadata = {
  name: 'dApp GM',
  description: 'dApp to say GM on multiple chains',
  url: 'http://tobiasztworek.github.io/',
  icons: ['https://avatars.githubusercontent.com/u/179229932'],
};

// App state
let modal = null; // lazy AppKit modal
let activeEip1193Provider = null; // chosen provider
let signer = null;
let networksRendered = false;

// UI elements (populated during init)
let connectBtn, bannerContainer, networksRow;

// Networks
const NETWORKS = [
  {
    name: 'Base Sepolia',
    chainId: '0x14a34',
    contractAddress: '0x714Be7D3D4fB4D52c714b00afFd1F297FD0E023f',
    rpcUrl: 'https://base-sepolia.rpc.thirdweb.com',
    explorer: 'https://sepolia.basescan.org/',
    buttonColor: '#1a46e5',
    logoUrl: 'img/base.jpg',
  },
  {
    name: 'Ethereum Sepolia',
    chainId: '0xaa36a7',
    contractAddress: '0x43ef985e0A520A7331bf93319CE3e676c9FAEbc9',
    rpcUrl: 'https://rpc.sepolia.org',
    explorer: 'https://sepolia.etherscan.io/',
    buttonColor: '#222222',
    logoUrl: 'img/ether.svg',
  },
  {
    name: 'Optimism Sepolia',
    chainId: '0xaa37dc',
    contractAddress: '0x0a56E2E236547575b2db6EF7e872cd49bC91A556',
    rpcUrl: 'https://optimism-sepolia-public.nodies.app',
    explorer: 'https://testnet-explorer.optimism.io/',
    buttonColor: '#FC0C2C',
    logoUrl: 'img/optimism.svg',
  },
];

const GM_ABI = [
  'function sayGM() external payable',
  'function getGmFeeInEth() view returns (uint256)',
  'function getUserSafe(address) view returns (uint256,uint256,bool)',
];

// ----- AppKit lazy init -----
export function initAppKit() {
  try {
    if (modal && typeof modal.open === 'function') return modal;
    modal = createAppKit({
      adapters: [new EthersAdapter()],
      networks: [baseSepolia, optimismSepolia, sepolia],
      metadata,
      projectId,
      features: { connectMethodsOrder: ['wallet'] },
    });
    // lightweight probe: watch for provider becoming available after modal init
    try {
      let probeCount = 0;
      const pid = setInterval(() => {
        probeCount++;
        try {
          const p = modal && typeof modal.getProvider === 'function' ? modal.getProvider() : null;
          if (p) {
            console.log('[appkit probe] modal.getProvider() became available', p);
            try { console.log('[appkit probe] provider keys ->', Object.keys(p)); } catch (e) {}
            // attach provider listeners if missing
            try { attachProviderEventListeners(p); } catch (e) {}
            clearInterval(pid);
          }
        } catch (e) { /* ignore */ }
        if (probeCount > 100) clearInterval(pid);
      }, 300);
    } catch (e) {}
    return modal;
  } catch (e) {
    console.error('initAppKit error', e);
    return null;
  }
}

// ----- Utilities -----
function showBanner(message, type = 'info', actions = []) {
  if (!bannerContainer) return;
  bannerContainer.innerHTML = '';
  const el = document.createElement('div');
  el.className = `alert alert-${type}`;
  el.style.display = 'flex';
  el.style.alignItems = 'center';
  el.style.justifyContent = 'space-between';
  const span = document.createElement('div');
  span.textContent = message;
  el.appendChild(span);
  const actionsDiv = document.createElement('div');
  actions.forEach(a => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm btn-primary ms-2';
    btn.textContent = a.label;
    btn.addEventListener('click', a.onClick);
    actionsDiv.appendChild(btn);
  });
  el.appendChild(actionsDiv);
  bannerContainer.appendChild(el);
}

function clearBanner() { if (!bannerContainer) return; bannerContainer.innerHTML = ''; }

async function waitForProviderReady(p, timeout = 5000, interval = 300) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (typeof p.setDefaultChain === 'function') return true;
      if (typeof p.request === 'function') return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, interval));
  }
  return false;
}

async function isRelayReachable(timeout = 3000) {
  try {
    const doh = `https://dns.google/resolve?name=relay.walletconnect.org&type=A`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    const res = await fetch(doh, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const j = await res.json();
    if (j && j.Answer && j.Answer.length) return true;
  } catch (e) {}
  try {
    const controller2 = new AbortController();
    const timer2 = setTimeout(() => controller2.abort(), timeout);
    await fetch('https://relay.walletconnect.org/', { method: 'GET', mode: 'no-cors', signal: controller2.signal });
    clearTimeout(timer2);
    return true;
  } catch (e) { return false; }
}

function getActiveProvider() {
  if (activeEip1193Provider) return activeEip1193Provider;
  try { if (modal && typeof modal.getProvider === 'function') { const p = modal.getProvider(); if (p) return p; } } catch (e) {}
  if (typeof window !== 'undefined' && window.ethereum) return window.ethereum;
  return null;
}

function getEthersProvider() {
  const p = getActiveProvider();
  if (!p) return null;
  try { return new ethers.BrowserProvider(p); } catch (e) { console.error('Invalid EIP-1193 provider', e); return null; }
}

// Small helper to ask the user's wallet to add a chain (used by the "Add Chain" button)
async function addNetworkById(chainId) {
  const net = NETWORKS.find(n => parseInt(n.chainId, 16) === chainId);
  if (!net) return false;
  const p = getActiveProvider() || (typeof window !== 'undefined' && window.ethereum) || null;
  if (!p || typeof p.request !== 'function') { showBanner('No provider available to add network', 'warning'); return false; }
  const addParams = {
    chainId: net.chainId,
    chainName: net.name,
    nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
    rpcUrls: [net.rpcUrl],
    blockExplorerUrls: [net.explorer],
  };
  try {
    await p.request({ method: 'wallet_addEthereumChain', params: [addParams] });
    return true;
  } catch (e) {
    console.warn('addNetworkById failed', e);
    return false;
  }
}

// ----- UI rendering -----
function renderNetworkUIOnce() { if (networksRendered) return; networksRendered = true; NETWORKS.forEach(renderNetworkCard); }

function renderNetworkCard(net) {
  if (!networksRow) return;
  if (networksRow.querySelector(`.status-card[data-chain="${net.chainId}"]`)) return;
  const col = document.createElement('div'); col.className = 'col-12 col-md-6';
  const container = document.createElement('div'); container.className = 'status-card'; container.dataset.chain = net.chainId;
  container.innerHTML = `
    <h2 class="d-flex align-items-center justify-content-between">
      <div>
        <img src="${net.logoUrl}" width="50" height="50" class="imgLogo me-2 rounded">
        ${net.name}
      </div>
      <button class="addBtn btn btn-sm btn-light addNetworkBtn" style="border: none;">🦊 Add Chain</button>
    </h2>
    <div class="mb-3">
      <div><strong>Status:</strong> <span class="statusText">—</span></div>
      <div><strong>GM Fee:</strong> <span class="feeEth">—</span> ETH</div>
      <div><strong>🔥 Streak:</strong> <span class="streak">—</span> dni</div>
      <div><strong>💬 Total GM:</strong> <span class="totalGm">—</span></div>
    </div>
    <div class="d-flex gap-2 mb-2">
      <button class="fetchFeeBtn btn btn-secondary flex-fill">Calculate fee</button>
      <button class="sayGmBtn btn btn-secondary flex-fill">Say GM ☀️</button>
    </div>
    <div class="txStatus">—</div>
  `;
  col.appendChild(container); networksRow.appendChild(col);
  const fetchFeeBtn = container.querySelector('.fetchFeeBtn');
  const sayGmBtn = container.querySelector('.sayGmBtn');
  const statusText = container.querySelector('.statusText');
  const feeEthText = container.querySelector('.feeEth');
  const streakText = container.querySelector('.streak');
  const totalGmText = container.querySelector('.totalGm');
  const txStatus = container.querySelector('.txStatus');
  const addBtn = container.querySelector('.addBtn');
  fetchFeeBtn.style.backgroundColor = net.buttonColor; sayGmBtn.style.backgroundColor = net.buttonColor;
  addBtn.addEventListener('click', async () => { try { await addNetworkById(parseInt(net.chainId, 16)); } catch (e) { console.error(e); showBanner('Error adding network', 'danger'); } });
  fetchFeeBtn.addEventListener('click', async () => {
    try {
      statusText.textContent = 'Fee calculation...';
      const ok = await switchToNetwork(net);
      if (!ok) { statusText.textContent = 'No provider'; return; }
      const provider = getEthersProvider();
      if (!provider) { statusText.textContent = 'No provider'; return; }
      const s = await provider.getSigner();
      const contract = new ethers.Contract(net.contractAddress, GM_ABI, s);
      const feeWei = await contract.getGmFeeInEth();
      feeEthText.textContent = Number(ethers.formatEther(feeWei)).toFixed(8);
      statusText.textContent = 'Fee calculated ✅';
    } catch (e) {
      console.error(e);
      statusText.textContent = 'Error in fee calculation';
    }
  });
  sayGmBtn.addEventListener('click', async () => {
    try {
      sayGmBtn.disabled = true;
      statusText.textContent = 'Preparing transaction...';
      const ok = await switchToNetwork(net);
      if (!ok) { statusText.textContent = 'No provider'; sayGmBtn.disabled = false; return; }
      const provider = getEthersProvider();
      if (!provider) { statusText.textContent = 'No provider'; sayGmBtn.disabled = false; return; }
      const s = await provider.getSigner();
      const contract = new ethers.Contract(net.contractAddress, GM_ABI, s);
      const feeWei = await contract.getGmFeeInEth();
      const tx = await contract.sayGM({ value: feeWei });
      txStatus.textContent = 'Tx sent: ' + tx.hash;
      await tx.wait();
      statusText.textContent = 'GM completed successfully ☀️';
      txStatus.textContent = 'Confirmed: ' + tx.hash;
      const user = await contract.getUserSafe(await s.getAddress());
      streakText.textContent = user[0];
      totalGmText.textContent = user[1];
    } catch (e) {
      console.error(e);
      statusText.textContent = 'Error in transaction';
    } finally {
      sayGmBtn.disabled = false;
    }
  });
}

// ----- network switching -----
async function switchToNetwork(net) {
  const p = getActiveProvider();
  const params = [{ chainId: net.chainId }];
  const addParams = [{ chainId: net.chainId, chainName: net.name, nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: [net.rpcUrl], blockExplorerUrls: [net.explorer] }];
  if (p && typeof p.request === 'function') {
    try { await p.request({ method: 'wallet_switchEthereumChain', params }); return true; } catch (err) { if (err && err.code === 4902) { try { await p.request({ method: 'wallet_addEthereumChain', params: addParams }); return true; } catch (e) { console.warn('addChain failed', e); } } else { console.warn('provider switch failed', err); } }
  }
  if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') {
    try { await window.ethereum.request({ method: 'wallet_switchEthereumChain', params }); return true; } catch (err) { if (err && err.code === 4902) { try { await window.ethereum.request({ method: 'wallet_addEthereumChain', params: addParams }); return true; } catch (e) { console.warn('window addChain failed', e); } } else { console.warn('window switch failed', err); } }
  }
  showBanner('No wallet provider available for network switch. Connect a wallet or switch the network manually in your wallet.', 'warning', [ { label: 'Connect', onClick: () => connect() } ]);
  return false;
}

// ----- connect / restore -----
async function connect() {
  const relayOk = await isRelayReachable().catch(() => false);
  if (!relayOk) {
    showBanner('WalletConnect relay unreachable — try connecting with an injected wallet or check your network.', 'warning', [ { label: 'Use injected', onClick: () => tryUseInjectedNow() }, { label: 'Retry', onClick: () => connect() } ]);
  } else {
    try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.debug('modal.open failed', e); }
  }
  // Try to finalize the provider returned by the modal. This may require
  // user interaction in the external wallet (mobile deep-link), so we poll
  // and also retry on visibility/focus when the user returns to the page.
  let providerCandidate = null;
  for (let i = 0; i < 40; i++) { // longer wait (40*300ms = 12s)
    try { providerCandidate = modal && typeof modal.getProvider === 'function' ? modal.getProvider() : null; } catch (e) { providerCandidate = null; }
    if (providerCandidate) break;
    await new Promise(r => setTimeout(r, 300));
  }
  if (providerCandidate && typeof providerCandidate.request === 'function') {
    try {
      // Optimistically accept the modal provider so UI updates immediately.
      activeEip1193Provider = providerCandidate;
      connectBtn.textContent = 'Connected';
      clearBanner();
      renderNetworkUIOnce();
      // attach provider listeners right away if possible
      try { attachProviderEventListeners(providerCandidate); } catch (e) {}
      // Finalize in background; if finalization fails (expired session), show reconnect CTA.
      (async () => {
        const finalized = await finalizeModalProvider(providerCandidate).catch(() => false);
        if (!finalized) {
          // show reconnect banner only if the provider turned out unusable
          showBanner('Connected wallet appears unusable. Reconnect to refresh WalletConnect session.', 'warning', [ { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.warn(e); } } } ]);
          // clear optimistic provider so other fallbacks can be attempted later
          activeEip1193Provider = null;
          connectBtn.textContent = 'Connect';
        } else {
          try { signer = (await getEthersProvider())?.getSigner(); await updateAllStats(); } catch (e) { console.debug('post-finalize update failed', e); }
        }
      })();
    } catch (e) { console.warn('providerCandidate probe failed', e); }
  }
  // additional probe: if modal.getProvider appears after connect, attach listeners
  try {
    let probeCount2 = 0;
    const pid2 = setInterval(() => {
      probeCount2++;
      try {
        const p2 = modal && typeof modal.getProvider === 'function' ? modal.getProvider() : null;
        if (p2) {
          console.log('[connect probe] modal.getProvider() is now available', p2);
          try { console.log('[connect probe] provider keys ->', Object.keys(p2)); } catch (e) {}
          try { attachProviderEventListeners(p2); } catch (e) {}
          clearInterval(pid2);
        }
      } catch (e) {}
      if (probeCount2 > 100) clearInterval(pid2);
    }, 400);
  } catch (e) {}
  if (!getActiveProvider()) {
    const injectedFound = await waitForInjectedProvider(5000);
    if (!injectedFound) { showBanner('No injected wallet detected. Open AppKit modal to connect or install MetaMask.', 'warning', [ { label: 'Open modal', onClick: () => { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } } ]); return; }
    try { await window.ethereum.request({ method: 'eth_requestAccounts' }); activeEip1193Provider = window.ethereum; } catch (e) { console.warn('eth_requestAccounts failed', e); }
  }
  const provider = getEthersProvider(); if (!provider) { console.warn('No provider available at finalization'); return; }
  signer = await provider.getSigner(); connectBtn.textContent = 'Connected'; clearBanner(); renderNetworkUIOnce(); await updateAllStats();
}

// Attempt to finalize a modal-provided provider: check eth_accounts, wait for readiness,
// and try eth_requestAccounts as a fallback. Returns true if provider looks usable.
async function finalizeModalProvider(p, opts = { timeout: 15000 }) {
  if (!p || typeof p.request !== 'function') return false;
  try {
    // quick accounts probe
    const accounts = await p.request({ method: 'eth_accounts' }).catch((err) => {
      // WalletConnect session-topic missing-key error: surface a reconnect CTA
      try {
        const msg = err && (err.message || String(err)) || '';
        if (msg.includes('No matching key') || msg.includes("session topic doesn't exist")) {
          showBanner('WalletConnect session expired — reconnect to continue.', 'warning', [ { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.warn(e); } } } ]);
        }
      } catch (e) {}
      return null;
    });
    if (accounts && accounts.length) return true;

  // wait for provider to become ready (adapter initialization)
  // default to 30s on mobile-ish flows
  const timeout = Math.max(5000, opts.timeout || 30000);
  const ready = await waitForProviderReady(p, timeout);
    if (ready) {
      const accounts2 = await p.request({ method: 'eth_accounts' }).catch((err) => {
        try {
          const msg = err && (err.message || String(err)) || '';
          if (msg.includes('No matching key') || msg.includes("session topic doesn't exist")) {
            showBanner('WalletConnect session expired — reconnect to continue.', 'warning', [ { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.warn(e); } } } ]);
          }
        } catch (e) {}
        return null;
      });
      if (accounts2 && accounts2.length) return true;
    }

    // last resort: request accounts which may prompt the external wallet
    try {
      // show an informative banner while we wait for the user to approve
      try { showBanner('Waiting for wallet approval…', 'info', [ { label: 'Cancel', onClick: () => { try { clearBanner(); activeEip1193Provider = null; } catch (e) {} } } ]); } catch (e) {}
      await p.request({ method: 'eth_requestAccounts' });
      const accounts3 = await p.request({ method: 'eth_accounts' }).catch((err) => {
        try {
          const msg = err && (err.message || String(err)) || '';
          if (msg.includes('No matching key') || msg.includes("session topic doesn't exist")) {
            showBanner('WalletConnect session expired — reconnect to continue.', 'warning', [ { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.warn(e); } } } ]);
          }
        } catch (e) {}
        return null;
      });
      if (accounts3 && accounts3.length) { try { clearBanner(); } catch (e) {} return true; }
    } catch (e) {
      // user may need to confirm in external app — return false so we can retry later
      const msg = e && (e.message || String(e)) || '';
      if (msg.includes('No matching key') || msg.includes("session topic doesn't exist")) {
        showBanner('WalletConnect session expired — reconnect to continue.', 'warning', [ { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (ee) { console.warn(ee); } } } ]);
      }
      try { clearBanner(); } catch (ee) {}
      return false;
    }
  } catch (e) {
    console.debug('finalizeModalProvider error', e);
    return false;
  }
  return false;
}

// When returning from an external wallet (mobile deep-link), try finalizing modal provider
function setupResumeHandlers() {
  const attempt = async () => {
    try {
      if (!modal) return;
      const p = modal.getProvider && modal.getProvider();
      if (p && !activeEip1193Provider) {
        const ok = await finalizeModalProvider(p).catch(() => false);
        if (ok) {
          activeEip1193Provider = p;
          const provider = getEthersProvider();
          if (provider) {
            signer = await provider.getSigner();
            connectBtn.textContent = 'Connected';
            clearBanner();
            renderNetworkUIOnce();
            await updateAllStats();
          }
        }
      }
    } catch (e) { console.debug('resume attempt failed', e); }
  };
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') attempt(); });
  window.addEventListener('focus', () => { attempt(); });
}

// ensure resume handlers are installed once
try { setupResumeHandlers(); } catch (e) {}

// Attach provider-level event listeners (disconnect, accountsChanged, chainChanged)
function attachProviderEventListeners(p) {
  if (!p) return;
  try {
    const safeOn = (evName, handler) => {
      try {
        if (typeof p.on === 'function') p.on(evName, handler);
        if (typeof p.addEventListener === 'function') p.addEventListener(evName, handler);
      } catch (e) { console.debug('attach event failed', evName, e); }
    };
    safeOn('disconnect', (info) => {
      console.warn('Provider disconnect event', info);
      activeEip1193Provider = null;
      showBanner('Wallet disconnected. Reconnect to continue.', 'warning', [ { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.warn(e); } } } ]);
    });
    safeOn('accountsChanged', async (accounts) => {
      try {
        console.debug('accountsChanged', accounts);
        if (!accounts || !accounts.length) {
          activeEip1193Provider = null;
          showBanner('Wallet accounts cleared. Reconnect?', 'warning', [ { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.warn(e); } } } ]);
          return;
        }
        // update signer and stats
        signer = (await getEthersProvider())?.getSigner();
        await updateAllStats();
      } catch (e) { console.debug('accountsChanged handler failed', e); }
    });
    safeOn('chainChanged', async (chainId) => {
      console.debug('chainChanged to', chainId);
      try { await updateAllStats(); } catch (e) {}
    });
    // AppKit/EthersAdapter may emit session events — try to listen generically
    safeOn('session_update', (ev) => { console.debug('session_update', ev); });
  } catch (e) { console.debug('attachProviderEventListeners error', e); }
}

// Force refresh provider from modal (useful when modal shows connected but getProvider() returns undefined)
function forceRefreshProvider() {
  try {
    console.log('[forceRefresh] attempting to extract provider from connected modal...');
    if (!modal) { console.warn('no modal available'); return false; }
    
    // try multiple ways to get the provider
    let provider = null;
    try { provider = modal.getProvider && modal.getProvider(); } catch (e) {}
    if (!provider) {
      try { provider = modal.wagmiConfig?.state?.connections?.values()?.next()?.value?.connector?.provider; } catch (e) {}
    }
    if (!provider) {
      try { provider = modal.wagmiConfig?.getClient()?.transport?.provider; } catch (e) {}
    }
    if (!provider) {
      // try accessing internal state (adapter-specific)
      try {
        const adapters = modal.adapters || [];
        for (const adapter of adapters) {
          if (adapter && typeof adapter.getProvider === 'function') {
            const p = adapter.getProvider();
            if (p) { provider = p; break; }
          }
        }
      } catch (e) {}
    }
    
    console.log('[forceRefresh] extracted provider:', provider);
    if (provider && typeof provider.request === 'function') {
      activeEip1193Provider = provider;
      try { attachProviderEventListeners(provider); } catch (e) {}
      console.log('[forceRefresh] SUCCESS - provider set as active');
      
      // update UI
      try {
        connectBtn.textContent = 'Connected';
        clearBanner();
        renderNetworkUIOnce();
        signer = (getEthersProvider())?.getSigner();
        updateAllStats().catch(e => console.debug('updateAllStats failed', e));
        showBanner('Provider refreshed successfully!', 'success');
      } catch (e) { console.debug('UI update failed', e); }
      return true;
    } else {
      console.warn('[forceRefresh] no usable provider found');
      showBanner('No usable provider found in modal - try reconnecting', 'warning');
      return false;
    }
  } catch (e) {
    console.error('forceRefreshProvider failed', e);
    showBanner('Provider refresh failed - see console', 'danger');
    return false;
  }
}

// Developer diagnostic dump (button + shortcut)
function devDump() {
  try {
    console.group('DEV DIAGNOSTICS');
    console.log('timestamp', Date.now());
    console.log('navigator.userAgent', navigator.userAgent);
    console.log('window.ethereum present?', !!(typeof window !== 'undefined' && window.ethereum));
    try { console.log('window.ethereum', window.ethereum); } catch (e) {}
    console.log('modal present?', !!modal);
    try { console.log('modal.getProvider()', modal && modal.getProvider ? modal.getProvider() : null); } catch (e) {}
    console.log('activeEip1193Provider', activeEip1193Provider);
    try { console.log('active provider keys', activeEip1193Provider ? Object.keys(activeEip1193Provider) : null); } catch (e) {}
    try { console.log('__lastWcErrorDetail', typeof __lastWcErrorDetail !== 'undefined' ? __lastWcErrorDetail : null); } catch (e) {}
    // run a lightweight finalize probe (non-invasive)
    try {
      const p = modal && modal.getProvider ? modal.getProvider() : null;
      if (p && typeof p.request === 'function') {
        p.request({ method: 'eth_accounts' }).then(a => console.log('probe eth_accounts ->', a)).catch(e => console.log('probe eth_accounts failed', e));
      }
    } catch (e) {}
    console.log('Tip: on mobile, open browser devtools (remote) or use Ctrl+Shift+D to dump last WC error; include __lastWcErrorDetail in bug reports.');
    console.log('Manual fix: if modal shows connected but app shows "no wallet", run: forceRefreshProvider()');
    console.groupEnd();
  } catch (e) { console.error('devDump failed', e); }
}

// Wire a keyboard shortcut and small dev button in header
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (ev) => {
    if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === 'd') { devDump(); }
  });
}

// Expose devDump and forceRefreshProvider to the global window so they can be invoked from console
try {
  if (typeof window !== 'undefined') {
    window.devDump = devDump;
    window.forceRefreshProvider = forceRefreshProvider;
  }
} catch (e) {}

async function tryUseInjectedNow() { if (typeof window !== 'undefined' && window.ethereum) { try { await window.ethereum.request({ method: 'eth_requestAccounts' }); activeEip1193Provider = window.ethereum; signer = (await getEthersProvider())?.getSigner(); connectBtn.textContent = 'Connected'; clearBanner(); renderNetworkUIOnce(); await updateAllStats(); } catch (e) { console.warn(e); } } else { showBanner('No injected wallet found', 'warning'); } }

async function tryRestoreConnection() {
  try {
    if (modal && typeof modal.getProvider === 'function') {
      const p = modal.getProvider();
      if (p && typeof p.request === 'function') {
        try { const ready = await waitForProviderReady(p, 2000); if (ready) { const accounts = await p.request({ method: 'eth_accounts' }).catch(() => []); if (accounts && accounts.length) { activeEip1193Provider = p; signer = (await getEthersProvider())?.getSigner(); connectBtn.textContent = 'Connected'; renderNetworkUIOnce(); await updateAllStats(); return true; } } } catch (e) { console.debug('modal restore failed', e); }
      }
    }
    if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') { try { const accounts = await window.ethereum.request({ method: 'eth_accounts' }); if (accounts && accounts.length) { activeEip1193Provider = window.ethereum; signer = (await getEthersProvider())?.getSigner(); connectBtn.textContent = 'Connected'; renderNetworkUIOnce(); await updateAllStats(); return true; } } catch (e) { console.debug('injected restore failed', e); } }
  } catch (e) { console.error('restore connection error', e); }
  return false;
}

// ----- helpers -----
function waitForInjectedProvider(timeout = 3000, interval = 200) { return new Promise(resolve => { if (typeof window !== 'undefined' && window.ethereum) return resolve(true); const start = Date.now(); const id = setInterval(() => { if (typeof window !== 'undefined' && window.ethereum) { clearInterval(id); return resolve(true); } if (Date.now() - start > timeout) { clearInterval(id); return resolve(false); } }, interval); }); }

// ----- update UI / stats -----
async function updateAllStats() {
  const p = getEthersProvider(); if (!p || !signer) return;
  for (const net of NETWORKS) {
    const container = document.querySelector(`.status-card[data-chain="${net.chainId}"]`);
    if (!container) continue;
    const statusText = container.querySelector('.statusText');
    const streakText = container.querySelector('.streak');
    const totalGmText = container.querySelector('.totalGm');
    try { statusText.textContent = 'Gathering stats...'; await switchToNetwork(net); const prov = getEthersProvider(); if (!prov) { statusText.textContent = 'No provider'; continue; } const s = await prov.getSigner(); const contract = new ethers.Contract(net.contractAddress, GM_ABI, s); const user = await contract.getUserSafe(await s.getAddress()); streakText.textContent = user[0]; totalGmText.textContent = user[1]; statusText.textContent = 'Stats gathered ✅'; } catch (e) { console.error(`Error gathering stats for ${net.name}:`, e); streakText.textContent = '—'; totalGmText.textContent = '—'; statusText.textContent = 'Error gathering stats'; }
  }
}

// ----- global error suppression for noisy WC internals -----
if (typeof window !== 'undefined') {
  // track recent expirations to avoid reopening modal repeatedly
  let __lastWcSessionExpiryMs = 0;
  const __wcExpiryCooldownMs = 15_000;
  // last captured detailed error for dev diagnostics
  let __lastWcErrorDetail = null;

  function _extractTopicFromString(s) {
    try {
      if (!s) return null;
      // common patterns where a topic/id may appear
      const m1 = s.match(/session\s*topic[^a-z0-9]*([A-Za-z0-9:\._\-]{8,})/i);
      if (m1 && m1[1]) return m1[1];
      const m2 = s.match(/topic[^a-z0-9]*([A-Za-z0-9:\._\-]{8,})/i);
      if (m2 && m2[1]) return m2[1];
      const m3 = s.match(/"([a-f0-9]{8,})"/i);
      if (m3 && m3[1]) return m3[1];
      return null;
    } catch (e) { return null; }
  }

  function handleExpiredWalletConnectSession(reasonMsg, errObj) {
    try {
      const now = Date.now();
      if (now - __lastWcSessionExpiryMs < __wcExpiryCooldownMs) return; // rate-limit
      __lastWcSessionExpiryMs = now;

      const reasonStr = String(reasonMsg || (errObj && (errObj.stack || errObj.message)) || '');
      const extractedTopic = _extractTopicFromString(reasonStr) || _extractTopicFromString(errObj && (errObj.stack || errObj.message));
      __lastWcErrorDetail = {
        timestamp: now,
        reason: reasonStr,
        stack: (errObj && (errObj.stack || errObj.message)) || null,
        topic: extractedTopic,
      };

      console.warn('Detected expired WalletConnect session/topic:', __lastWcErrorDetail);
      // clear optimistic provider state so UI/fallbacks can run
      try { activeEip1193Provider = null; } catch (e) {}
      // show reconnect banner with a CTA (do NOT auto-open modal)
      showBanner('WalletConnect session expired — please reconnect. Try switching networks (Wi‑Fi ↔ LTE) or use a VPN if your network blocks relay.walletconnect.org.', 'warning', [
        { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.warn(e); } } },
      ]);
      // perform a safe reset of local modal/provider state so stale session objects don't linger
      try {
        console.warn('Resetting local AppKit/modal/provider state due to expired WalletConnect session/topic');
        try { if (modal && typeof modal.close === 'function') { modal.close(); } } catch (e) { console.debug('modal.close failed', e); }
        try { modal = null; } catch (e) {}
        try { activeEip1193Provider = null; } catch (e) {}
        try { signer = null; } catch (e) {}
        // we keep networksRendered as-is to avoid re-render churn; UI will show reconnect banner
      } catch (e) { console.debug('safe reset failed', e); }
      // do not re-open modal automatically to avoid surprising deep-links; user must click Reconnect
    } catch (e) { console.warn('handleExpiredWalletConnectSession error', e); }
  }

  window.addEventListener('unhandledrejection', ev => {
    try {
      const reasonStr = (ev.reason && (ev.reason.stack || ev.reason.message || String(ev.reason))) || '';
      if (reasonStr.includes('setDefaultChain') || reasonStr.includes('browser-ponyfill.js')) {
        try { ev.preventDefault(); } catch (e) {}
        console.warn('Suppressed WalletConnect/browser-ponyfill error (setDefaultChain)');
        return;
      }
      if (reasonStr.includes('No matching key') || reasonStr.includes("session topic doesn't exist") || reasonStr.includes('session topic')) {
        try { ev.preventDefault(); } catch (e) {}
        console.warn('Suppressed WalletConnect session-topic error');
        // forward the full error object so we capture stack + details
        handleExpiredWalletConnectSession(reasonStr, ev.reason);
        return;
      }
    } catch (e) {}
  });

  window.addEventListener('error', ev => {
    try {
      const msg = ev && (ev.error && (ev.error.stack || ev.error.message) || ev.message || '');
      const msgStr = String(msg || '');
      if (msgStr.includes('setDefaultChain') || msgStr.includes('browser-ponyfill.js')) {
        try { ev.preventDefault(); } catch (e) {}
        console.warn('Suppressed WalletConnect/browser-ponyfill error (setDefaultChain)');
        return;
      }
      if (msgStr.includes('No matching key') || msgStr.includes("session topic doesn't exist") || msgStr.includes('session topic')) {
        try { ev.preventDefault(); } catch (e) {}
        console.warn('Suppressed WalletConnect session-topic error');
        handleExpiredWalletConnectSession(msgStr, ev.error || ev);
        return;
      }
      console.error('Global error:', ev.error || ev.message, ev);
    } catch (e) {}
  });
}

// ----- initialization -----
export function init() {
  connectBtn = document.getElementById('connectBtn'); networksRow = document.getElementById('networksRow'); bannerContainer = document.createElement('div'); bannerContainer.style.margin = '12px 0'; const header = document.querySelector('header');
  if (header) {
    header.appendChild(bannerContainer);
    try {
      const devBtn = document.createElement('button');
      devBtn.className = 'btn btn-sm btn-outline-secondary ms-2';
      devBtn.textContent = 'Dump logs';
      devBtn.style.marginLeft = '8px';
      devBtn.addEventListener('click', () => {
        try {
          if (window.devDump) window.devDump();
          showBanner('Dev dump written to console. Open DevTools to view.', 'info');
        } catch (e) { console.warn('devDump failed', e); showBanner('devDump failed (see console)', 'danger'); }
      });
      
      // Add "Refresh Provider" button next to devBtn
      const refreshBtn = document.createElement('button');
      refreshBtn.className = 'btn btn-sm btn-outline-warning ms-2';
      refreshBtn.textContent = 'Refresh Provider';
      refreshBtn.addEventListener('click', () => {
        try {
          if (window.forceRefreshProvider) window.forceRefreshProvider();
        } catch (e) { console.warn('forceRefreshProvider failed', e); showBanner('Provider refresh failed', 'danger'); }
      });
      header.appendChild(devBtn);
      header.appendChild(refreshBtn);
    } catch (e) { console.debug('failed to add dev buttons', e); }
  }
  connectBtn.addEventListener('click', () => connect()); renderNetworkUIOnce(); tryRestoreConnection().catch(e => console.error('restore failed', e));
}

if (typeof window !== 'undefined') { window.addEventListener('DOMContentLoaded', () => { try { init(); } catch (e) { console.error('init error', e); } }); }
// Auto-initialize when loaded in browser
if (typeof window !== 'undefined') {
  // Global diagnostics: surface unhandled rejections and errors so we can
  // provide clearer messages for WalletConnect relay failures observed on
  // some mobile browsers/networks.
  window.addEventListener('unhandledrejection', (ev) => {
    try {
      console.error('Unhandled promise rejection:', ev.reason);
      const reasonStr = (ev.reason && (ev.reason.stack || ev.reason.message || String(ev.reason))) || '';
      // Recognize the WalletConnect/browser-ponyfill 'setDefaultChain' crash
      // (it happens when an internal object is not yet initialized). Treat
      // it as handled to avoid noisy console traces and show a friendly hint.
      if (reasonStr.includes('setDefaultChain') || reasonStr.includes('browser-ponyfill.js')) {
        try { ev.preventDefault(); } catch (e) {}
        // Suppress the noisy walletconnect internal error popup. Log a concise
        // warning for debugging but avoid alerting the user repeatedly.
        console.warn('Suppressed WalletConnect browser-ponyfill error (setDefaultChain). See console for details.');
        return;
      }
      // If it looks like a DNS/network failure to the WC relay, show a tip
      if (reasonStr.includes('ERR_NAME_NOT_RESOLVED') || reasonStr.includes('relay.walletconnect.org')) {
        try { ev.preventDefault(); } catch (e) {}
        alert('Błąd sieci: nie można rozwiązać hosta relay.walletconnect.org. Sprawdź połączenie sieciowe lub spróbuj innej sieci.');
        return;
      }

      // Suppress browser-ponyfill internal errors related to setDefaultChain
      // which surface when internal controller objects are not yet ready.
      if (reasonStr.includes('setDefaultChain') || reasonStr.includes('browser-ponyfill.js') || (reasonStr.includes('Cannot read properties of undefined') && reasonStr.includes('setDefaultChain'))) {
        try { ev.preventDefault(); } catch (e) {}
        console.warn('Suppressed WalletConnect/browser-ponyfill error (setDefaultChain). See console for details.');
        return;
      }

      // Suppress WalletConnect session-topic missing-key noise which can
      // surface when a session is expired or a topic is no longer present
      // on the relay. These are internal WC relay/session lifecycle logs
      // and don't need to bubble as uncaught exceptions in the app UI.
      if (reasonStr.includes("No matching key") || reasonStr.includes("session topic doesn't exist")) {
        try { ev.preventDefault(); } catch (e) {}
        console.warn('Suppressed WalletConnect session-topic error:', reasonStr.split('\n')[0]);
        return;
      }
    } catch (e) {}
  });

  window.addEventListener('error', (ev) => {
    try {
      const msg = ev && (ev.error && (ev.error.stack || ev.error.message) || ev.message || '');
      const msgStr = String(msg || '');
      // Suppress the same browser-ponyfill setDefaultChain TypeError
      if (msgStr.includes('setDefaultChain') || msgStr.includes('browser-ponyfill.js') || (msgStr.includes('Cannot read properties of undefined') && msgStr.includes('setDefaultChain'))) {
        try { ev.preventDefault(); } catch (e) {}
        console.warn('Suppressed WalletConnect/browser-ponyfill error (setDefaultChain). See console for details.');
        return;
      }
      console.error('Global error:', ev.error || ev.message, ev);
    } catch (e) {}
  });
  window.addEventListener('DOMContentLoaded', () => {
    // wait a tick so HTML elements are present
    try {
      // initialize AppKit after DOM is ready
      initAppKit();
    } catch (e) {
      console.error('initAppKit error', e);
    }
    try { init(); } catch (e) { console.error('Init error', e); }
  });
}

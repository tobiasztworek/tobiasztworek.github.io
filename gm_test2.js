import { ethers } from 'ethers';
import { createAppKit } from "@reown/appkit";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { baseSepolia, optimismSepolia, sepolia } from "@reown/appkit/networks";

// 1. Get projectId from https://dashboard.reown.com
//const projectId = "b56e18d47c72ab683b10814fe9495694";
const projectId = "3a5538ce9969461166625db3fdcbef8c";

// 2. Create your application's metadata object
const metadata = {
  name: "dApp GM",
  description: "dApp to say GM on multiple chains",
  url: "http://tobiasztworek.github.io/", // origin must match your domain & subdomain
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

// 3. Create a AppKit instance
const modal = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [baseSepolia, optimismSepolia, sepolia],
  metadata,
  projectId,
  features: {
    connectMethodsOrder: ["wallet"],
  },
});

// Ensure initAppKit exists for legacy callers. The app previously
// attempted to call `initAppKit()` on DOMContentLoaded but the
// function was removed in a refactor which caused a ReferenceError.
// Provide a safe initializer that is idempotent and performs no-op
// if AppKit `modal` is already created above.
export function initAppKit() {
  try {
    // modal is already created synchronously above; ensure it's usable
    if (modal && typeof modal.open === 'function') {
      // No heavy work here. Consumers can call modal.open() later.
      return modal;
    }
  } catch (e) {
    console.error('initAppKit internal error', e);
  }
  // Fallback: return null to indicate no modal available
  return null;
}


export function init() {
  const NETWORKS = [
    {
      name: "Base Sepolia",
      chainId: "0x14a34",
      contractAddress: "0x714Be7D3D4fB4D52c714b00afFd1F297FD0E023f",
      rpcUrl: "https://base-sepolia.rpc.thirdweb.com",
      explorer: "https://sepolia.basescan.org/",
      buttonColor: '#1a46e5',
      logoUrl: "img/base.jpg"
    },
    {
      name: "Ethereum Sepolia",
      chainId: "0xaa36a7",
      contractAddress: "0x43ef985e0A520A7331bf93319CE3e676c9FAEbc9",
      rpcUrl: "https://rpc.sepolia.org",
      explorer: "https://sepolia.etherscan.io/",
      buttonColor: "#222222",
      logoUrl: "img/ether.svg"
    },
    {
      name: "Optimism Sepolia",
      chainId: "0xaa37dc",
      contractAddress: "0x0a56E2E236547575b2db6EF7e872cd49bC91A556",
      rpcUrl: "https://optimism-sepolia-public.nodies.app",
      explorer: "https://testnet-explorer.optimism.io/",
      buttonColor: "#FC0C2C",
      logoUrl: "img/optimism.svg"
    }
  ];

  const GM_ABI = [
    "function sayGM() external payable",
    "function getGmFeeInEth() view returns (uint256)",
    "function getUserSafe(address) view returns (uint256,uint256,bool)"
  ];

  const connectBtn = document.getElementById("connectBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const networksRow = document.getElementById("networksRow");

  let signer;
  // Active EIP-1193 provider (from AppKit/EthersAdapter or injected)
  let activeEip1193Provider = null;
  // Track whether network containers have already been rendered to avoid duplicates
  let networksRendered = false;

  // Render network cards immediately so the interface is visible even when
  // no wallet is connected. initNetworkContainer is idempotent-guarded below.
  function renderNetworkUIOnce() {
    if (networksRendered) return;
    networksRendered = true;
    NETWORKS.forEach(net => initNetworkContainer(net));
  }

  // Render UI now so user sees the app even without wallet
  renderNetworkUIOnce();

  function getActiveProvider() {
    if (activeEip1193Provider) return activeEip1193Provider;
    try {
      if (modal && typeof modal.getProvider === 'function') {
        const p = modal.getProvider();
        if (p) return p;
      }
    } catch (e) {}
    if (typeof window !== 'undefined' && window.ethereum) return window.ethereum;
    return null;
  }

  async function switchToNetwork(net) {
    try {
      const p = getActiveProvider();
      if (p && typeof p.request === 'function') {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: net.chainId }] });
      } else {
        throw new Error('No provider available for network switch');
      }
    } catch (err) {
      if (err.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: net.chainId,
            chainName: net.name,
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: [net.rpcUrl],
            blockExplorerUrls: [net.explorer]
          }]
        });
      } else throw err;
    }
  }

  async function connect() {
    // Try to use AppKit modal provider first
    try {
      let providerCandidate = null;
      try { providerCandidate = modal && typeof modal.getProvider === 'function' ? modal.getProvider() : null; } catch(e){}
      if (!providerCandidate) {
        // Before opening the modal, do a quick reachability check for the
        // WalletConnect relay. On some mobile networks or DNS setups the
        // relay host (relay.walletconnect.org) may not resolve which causes
        // the WebSocket connection to fail and deeper WalletConnect code to
        // error (e.g., reading setDefaultChain of undefined). Detect that
        // early and show a helpful message instead of letting low-level
        // runtime errors surface.
        let relayOk = true;
        try {
          relayOk = await isRelayReachable();
        } catch (e) {
          relayOk = false;
        }
        if (!relayOk) {
          // Friendly message for end-user; keep the app usable with injected wallets
          alert('Nie można połączyć się z serwerem WalletConnect (relay). Sprawdź połączenie sieciowe lub spróbuj innej sieci.');
        } else {
          try { modal.open(); } catch(e){}
        }
        for (let i = 0; i < 20; i++) {
          try { providerCandidate = modal && typeof modal.getProvider === 'function' ? modal.getProvider() : null; } catch(e){}
          if (providerCandidate) break;
          await new Promise(r => setTimeout(r, 300));
        }
      }
      if (providerCandidate && typeof providerCandidate.request === 'function') {
        // Some WalletConnect providers may be partially initialized when
        // returned by modal.getProvider(). The browser-ponyfill error we
        // observed (`setDefaultChain` of undefined) happens when internal
        // controller objects are not ready yet. Wait briefly for the
        // provider to become ready (or detect it's missing the expected API)
        // and only assign it when ready. Otherwise fall back to injected.
        const ready = await waitForProviderReady(providerCandidate, 2000);
        if (ready) {
          console.debug('AppKit provider ready — using it');
          activeEip1193Provider = providerCandidate;
        } else {
          console.warn('Provider found but not ready (missing internal API); falling back to injected provider.');
        }
      }
    } catch (e) {
      console.warn('AppKit provider attempt failed', e);
    }

    // Fallback to injected provider
    if (!getActiveProvider()) {
      // Mobile deep-link flows (open MetaMask app and return) sometimes
      // result in the injected provider appearing a short time after the
      // user starts the connect flow. Wait briefly for window.ethereum to
      // appear before giving up and showing the install modal message.
  const injectedAvailable = await waitForInjectedProvider(5000);
  console.debug('Injected provider available:', injectedAvailable, 'window.ethereum present:', !!(typeof window !== 'undefined' && window.ethereum));
      if (!injectedAvailable) {
        // No injected provider detected in time — show friendly hint but
        // don't throw; user can retry.
        alert("Install MetaMask or open AppKit modal.");
      } else {
        try {
          await window.ethereum.request({ method: "eth_requestAccounts" });
          console.debug('Injected provider granted accounts');
          activeEip1193Provider = window.ethereum;
        } catch (e) {
          console.error('eth_requestAccounts failed', e);
        }
      }
    }

  const provider = getEthersProvider();
  if (!provider) { console.warn('No provider available at finalization step'); return; }
  signer = await provider.getSigner();
  // Re-render network UI now that signer exists (avoid duplicate rendering)
  renderNetworkUIOnce();
    connectBtn.disabled = true;
    connectBtn.textContent = "Connected";
    disconnectBtn.disabled = false;
    NETWORKS.forEach(net => initNetworkContainer(net));
    await updateAllStats();
  }

  // Wait for an injected provider (window.ethereum) to appear within the
  // specified timeout (ms). Returns true if found, false otherwise.
  function waitForInjectedProvider(timeout = 3000, interval = 200) {
    return new Promise(resolve => {
      if (typeof window !== 'undefined' && window.ethereum) return resolve(true);
      const start = Date.now();
      const id = setInterval(() => {
        if (typeof window !== 'undefined' && window.ethereum) {
          clearInterval(id);
          return resolve(true);
        }
        if (Date.now() - start > timeout) {
          clearInterval(id);
          return resolve(false);
        }
      }, interval);
    });
  }

  // Return an ethers BrowserProvider built from the active provider, or
  // null if no active provider is available or it's invalid. This prevents
  // passing null into ethers which throws 'invalid EIP-1193 provider'.
  function getEthersProvider() {
    const active = getActiveProvider();
    if (!active) return null;
    try {
      return new ethers.BrowserProvider(active);
    } catch (e) {
      console.error('Invalid EIP-1193 provider', e);
      return null;
    }
  }

  // Check reachability of the WalletConnect relay endpoint. A failed DNS
  // resolution will cause the relay websocket to throw net::ERR_NAME_NOT_RESOLVED
  // and cascade into uncaught errors inside walletconnect libraries. This
  // function performs a small fetch with timeout to detect that condition.
  async function isRelayReachable(timeout = 3000) {
    // Primary: use DNS-over-HTTPS to check whether relay.walletconnect.org resolves.
    // This avoids making requests directly to the relay HTTP endpoint which can
    // return 405 Method Not Allowed. Google DoH returns JSON and supports CORS.
    const doh = `https://dns.google/resolve?name=relay.walletconnect.org&type=A`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(doh, { method: 'GET', signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return false;
      const j = await res.json();
      // If there are Answers, the host resolves
      if (j && (j.Answer && j.Answer.length > 0)) return true;
    } catch (err) {
      // fall through to fallback
      clearTimeout(timer);
    }

    // Fallback: try a direct GET to the relay root. Some environments will
    // return 405 for HEAD; using GET with no-cors may still fail but we'll
    // use it as a last resort to detect DNS/network issues.
    try {
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), timeout);
      await fetch('https://relay.walletconnect.org/', { method: 'GET', mode: 'no-cors', signal: controller2.signal });
      clearTimeout(timer2);
      return true;
    } catch (err) {
      return false;
    }
  }

  function disconnect() {
    signer = null;
    networksRow.innerHTML = "";
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    connectBtn.textContent = "Connect MetaMask";
  }

  function initNetworkContainer(net) {
    const col = document.createElement("div");
    col.className = "col-12 col-md-6";

    const container = document.createElement("div");
    container.className = "status-card";
    container.dataset.chain = net.chainId;
    container.innerHTML = `
      <h2 class="d-flex align-items-center justify-content-between">
        <div>
          <img src="${net.logoUrl}" width="50" height="50" class="imgLogo me-2 rounded">
          ${net.name}
        </div>
        <button class="addBtn btn btn-sm btn-light addNetworkBtn"
          style="border: none;">
          🦊 Add Chain
        </button>
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
    col.appendChild(container);
    networksRow.appendChild(col);

    const fetchFeeBtn = container.querySelector(".fetchFeeBtn");
    const sayGmBtn = container.querySelector(".sayGmBtn");
    const statusText = container.querySelector(".statusText");
    const feeEthText = container.querySelector(".feeEth");
    const streakText = container.querySelector(".streak");
    const totalGmText = container.querySelector(".totalGm");
    const txStatus = container.querySelector(".txStatus");
    const addBtn = container.querySelector(".addBtn");

    fetchFeeBtn.style.backgroundColor = net.buttonColor;
    sayGmBtn.style.backgroundColor = net.buttonColor;

    let contract;
    
    addBtn.addEventListener("click", async () => {
      try {
        await addNetworkById(parseInt(net.chainId, 16));
      } catch (e) {
        console.error(e);
        alert("Error adding network");
      }
    });

    fetchFeeBtn.addEventListener("click", async () => {
      try {
    statusText.textContent = "Fee colculation...";
    await switchToNetwork(net);
    const provider = getEthersProvider();
    if (!provider) { statusText.textContent = 'No provider'; return; }
    const signer = await provider.getSigner();
        contract = new ethers.Contract(net.contractAddress, GM_ABI, signer);
        const feeWei = await contract.getGmFeeInEth();
        feeEthText.textContent = Number(ethers.formatEther(feeWei)).toFixed(8);
        statusText.textContent = "Fee calculated ✅";
      } catch (e) {
        console.error(e);
        statusText.textContent = "Error in fee calculation";
      }
    });

    sayGmBtn.addEventListener("click", async () => {
      try {
        sayGmBtn.disabled = true;
        statusText.textContent = "Preparing transaction...";
    await switchToNetwork(net);
    const provider = getEthersProvider();
    if (!provider) { statusText.textContent = 'No provider'; sayGmBtn.disabled = false; return; }
    const signer = await provider.getSigner();
        contract = new ethers.Contract(net.contractAddress, GM_ABI, signer);
        const feeWei = await contract.getGmFeeInEth();
        const tx = await contract.sayGM({ value: feeWei });
        txStatus.textContent = "Tx sent: " + tx.hash;
        await tx.wait();
        statusText.textContent = "GM completed successfully ☀️";
        txStatus.textContent = "Confirmed: " + tx.hash;
        const user = await contract.getUserSafe(await signer.getAddress());
        streakText.textContent = user[0];
        totalGmText.textContent = user[1];
      } catch (e) {
        console.error(e);
        statusText.textContent = "Error in transaction";
      } finally {
        sayGmBtn.disabled = false;
      }
    });
  }

  async function updateAllStats() {
    if (!signer) return;

    for (const net of NETWORKS) {
      const container = document.querySelector(`.status-card[data-chain="${net.chainId}"]`);
      if (!container) continue;

      const streakText = container.querySelector(".streak");
      const totalGmText = container.querySelector(".totalGm");
      const statusText = container.querySelector(".statusText");

      try {
        statusText.textContent = "Gathering stats...";
    await switchToNetwork(net);
    const provider = getEthersProvider();
    if (!provider) { statusText.textContent = 'No provider'; continue; }
    const signer = await provider.getSigner();
        const contract = new ethers.Contract(net.contractAddress, GM_ABI, signer);
        const user = await contract.getUserSafe(await signer.getAddress());
        streakText.textContent = user[0];
        totalGmText.textContent = user[1];
        statusText.textContent = "Stats gathered ✅";
      } catch (e) {
        console.error(`Error gathering stats for ${net.name}:`, e);
        streakText.textContent = "—";
        totalGmText.textContent = "—";
        statusText.textContent = "Error gathering stats";
      }
    }
  }

  async function getNetworkConfig(chainId) {
    try {
      const response = await fetch("https://chainid.network/chains.json");
      const allChains = await response.json();
      const chain = allChains.find(c => c.chainId === chainId);
      if (!chain) {
        throw new Error("Sieć nieznaleziona w Chainlist");
      }

      return {
        chainId: "0x" + chain.chainId.toString(16),
        chainName: chain.name,
        rpcUrls: chain.rpc,
        nativeCurrency: chain.nativeCurrency,
        blockExplorerUrls: chain.explorers?.map(e => e.url) || []
      };
    } catch (err) {
      console.error("Błąd pobierania sieci:", err);
      return null;
    }
  }

  async function addNetworkById(chainId) {
    const network = await getNetworkConfig(chainId);
    if (!network) return alert("Nie można pobrać danych sieci");

    await window.ethereum.request({
      method: "wallet_addEthereumChain",
      params: [network]
    });
  }


  connectBtn.addEventListener("click", connect);
  disconnectBtn.addEventListener("click", disconnect);

  // Attempt to restore an existing wallet connection on page reload.
  // Checks AppKit modal provider first, then falls back to injected provider.
  async function tryRestoreConnection() {
    try {
      // Check AppKit provider
      let providerCandidate = null;
      try { providerCandidate = modal && typeof modal.getProvider === 'function' ? modal.getProvider() : null; } catch(e){}
      if (providerCandidate && typeof providerCandidate.request === 'function') {
        try {
          // Ensure provider is in a usable state before asking for accounts
          const ready = await waitForProviderReady(providerCandidate, 2000);
          if (!ready) throw new Error('provider-not-ready');
          const accounts = await providerCandidate.request({ method: 'eth_accounts' });
          if (accounts && accounts.length) {
            activeEip1193Provider = providerCandidate;
            const provider = getEthersProvider();
            if (!provider) return false;
            signer = await provider.getSigner();
            connectBtn.disabled = true;
            connectBtn.textContent = "Connected";
            disconnectBtn.disabled = false;
            NETWORKS.forEach(net => initNetworkContainer(net));
            await updateAllStats();
            return true;
          }
        } catch (e) {
          console.debug('AppKit provider eth_accounts check failed', e);
        }
      }

      // Fallback: check injected provider (e.g., MetaMask)
      if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          if (accounts && accounts.length) {
            activeEip1193Provider = window.ethereum;
            const provider = getEthersProvider();
            if (!provider) return false;
            signer = await provider.getSigner();
            connectBtn.disabled = true;
            connectBtn.textContent = "Connected";
            disconnectBtn.disabled = false;
            NETWORKS.forEach(net => initNetworkContainer(net));
            await updateAllStats();
            return true;
          }
        } catch (e) {
          console.debug('Injected provider eth_accounts check failed', e);
        }
      }
    } catch (e) {
      console.error('Error restoring connection', e);
    }
    return false;
  }

  // Try to restore connection but don't block initialization if it fails
  tryRestoreConnection().catch(e => console.error('restore connection failed', e));
}

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
        console.warn('Suppressed WalletConnect browser-ponyfill error (setDefaultChain).');
        alert('Wewnętrzny błąd WalletConnect podczas synchronizacji sieci. Spróbuj ponownie otworzyć modal lub użyć wbudowanego portfela (MetaMask).');
        return;
      }
      // If it looks like a DNS/network failure to the WC relay, show a tip
      if (reasonStr.includes('ERR_NAME_NOT_RESOLVED') || reasonStr.includes('relay.walletconnect.org')) {
        try { ev.preventDefault(); } catch (e) {}
        alert('Błąd sieci: nie można rozwiązać hosta relay.walletconnect.org. Sprawdź połączenie sieciowe lub spróbuj innej sieci.');
        return;
      }
    } catch (e) {}
  });

  window.addEventListener('error', (ev) => {
    try {
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

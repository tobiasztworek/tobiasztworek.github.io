(() => {
  const NETWORKS = [
    {
      name: "Base Sepolia",
      chainId: "0xaa37dc",
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
      chainId: "0xaa37dd",
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
  const connectWcBtn = document.getElementById("connectWcBtn");
  const disconnectBtn = document.getElementById("disconnectBtn");
  const networksRow = document.getElementById("networksRow");

  let signer;
  let wcProvider = null;
  let wcSigner = null;

  async function switchToNetwork(net) {
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: net.chainId }]
      });
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
    try {
      if (!window.ethereum) {
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        if (isMobile) {
          const injected = await waitForEthereum(3000);
          if (!injected) {
            const dappUrl = encodeURIComponent(window.location.href);
            const metamaskLink = `https://metamask.app.link/dapp/${dappUrl}`;
            if (confirm('MetaMask nie jest dostępny w tej przeglądarce. Otworzyć stronę w aplikacji MetaMask?')) {
              window.location.href = metamaskLink;
            }
            return;
          }
        }

        alert('No Ethereum provider found. Zainstaluj MetaMask.');
        return;
      }

      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner();
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connected';
      disconnectBtn.disabled = false;
      NETWORKS.forEach(net => initNetworkContainer(net, false));
      await updateAllStats(false);
    } catch (err) {
      console.error('connect() error:', err);
      if (err && err.message && /No provider|user rejected|invalid json rpc response/i.test(err.message)) {
        alert('Błąd połączenia z MetaMask. Spróbuj otworzyć stronę w przeglądarce MetaMask (mobile).');
      } else {
        alert('Błąd połączenia z portfelem: ' + (err && err.message ? err.message : err));
      }
    }
  }

  // WalletConnect v2 connect (UMD)
  async function connectWalletConnect() {
    try {
      // Preflight: check registry and relay connectivity to provide clearer diagnostics
      async function checkRegistry(url) {
        try {
          const res = await fetch(url, { method: 'GET', cache: 'no-store' });
          return { ok: true, status: res.status };
        } catch (e) {
          return { ok: false, error: e };
        }
      }

      async function testWebSocket(wsUrl, timeoutMs = 3000) {
        return new Promise(resolve => {
          let done = false;
          try {
            const ws = new WebSocket(wsUrl);
            const timer = setTimeout(() => {
              if (!done) { done = true; try { ws.close(); } catch (e) {} resolve({ ok: false, reason: 'timeout' }); }
            }, timeoutMs);
            ws.onopen = () => { if (!done) { done = true; clearTimeout(timer); try { ws.close(); } catch (e) {} resolve({ ok: true }); } };
            ws.onerror = (err) => { if (!done) { done = true; clearTimeout(timer); resolve({ ok: false, reason: 'ws-error', error: err }); } };
          } catch (e) {
            resolve({ ok: false, error: e });
          }
        });
      }
      // Helper to locate UMD export under common global names or .default
      const tryFind = () => {
        const candidates = [
          window.EthereumProvider,
          window.WalletConnectProvider,
          window.WalletConnect,
          window.WalletConnectProvider && window.WalletConnectProvider.default,
          window.WalletConnect && window.WalletConnect.default,
          window.EthereumProvider && window.EthereumProvider.default
        ];
        for (const c of candidates) {
          if (c && (typeof c.init === 'function' || typeof c === 'function')) return c;
        }
        return null;
      };

  let UMD = tryFind();

      // If the UMD runtime is an ES module namespace (common when bundlers expose a default),
      // prefer the `.default` export which usually holds the actual factory/constructor.
      if (UMD && typeof UMD === 'object' && (UMD.__esModule || UMD.default)) {
        try {
          if (UMD.default) {
            console.log('WalletConnect UMD runtime is an ES module namespace — switching to .default');
            UMD = UMD.default;
          }
        } catch (e) {
          console.warn('Error accessing UMD.default, keeping original UMD object', e);
        }
      }

      // If not found, try to dynamically load the UMD bundle from jsDelivr and retry
      if (!UMD) {
        console.log('WalletConnect UMD global not found — attempting to load script dynamically');
        try {
          await new Promise((resolve, reject) => {
            const url = 'https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider/dist/umd/index.min.js';
            if (document.querySelector(`script[src="${url}"]`)) return resolve();
            const s = document.createElement('script');
            s.src = url;
            s.async = true;
            s.onload = () => setTimeout(resolve, 50);
            s.onerror = () => reject(new Error('Failed to load WalletConnect UMD: ' + url));
            document.head.appendChild(s);
          });
        } catch (err) {
          console.error('Failed to dynamically load WalletConnect UMD', err);
        }

        UMD = tryFind();
      }

      if (!UMD) {
        console.error('WalletConnect v2 library not loaded - no UMD global detected');
        alert('WalletConnect v2 library not loaded. Check that the UMD script is available.');
        return;
      }

      // Quick connectivity checks (registry + relay) to avoid confusing internal errors
      try {
        const registryUrl = 'https://registry.walletconnect.com/api/v2/wallets';
        const reg = await checkRegistry(registryUrl);
        if (!reg.ok || (reg.status && reg.status >= 400)) {
          console.warn('WalletConnect registry check failed', reg);
          // try the relay directly as a fallback connectivity probe
          const wsProbe = await testWebSocket('wss://relay.walletconnect.com');
          if (!wsProbe.ok) {
            console.error('Relay websocket probe failed', wsProbe);
            alert('Unable to reach WalletConnect services (registry/relay). Check network or add a valid Project ID. See console for details.');
            return;
          } else {
            console.log('Relay websocket probe OK (registry failed) — proceeding, but registry responded with', reg);
          }
        } else {
          console.log('WalletConnect registry reachable (status ' + reg.status + ')');
        }
      } catch (probeErr) {
        console.warn('Connectivity preflight for WalletConnect failed', probeErr);
      }

      const PROJECT_ID = '3a5538ce9969461166625db3fdcbef8c'; // <- replace with your Project ID
      // Try several strategies to initialize the provider when init() isn't obvious
      const options = {
        projectId: PROJECT_ID,
        chains: [11155420, 11155111, 11155421],
        showQrModal: true,
        // Prefer WalletConnect Cloud relay; older builds may try deprecated bridge hosts
        relayUrl: 'wss://relay.walletconnect.com',
        // Optional fallback key used by some builds
        relay: { url: 'wss://relay.walletconnect.com' },
        rpcMap: {
          11155420: "https://base-sepolia.rpc.thirdweb.com",
          11155111: "https://rpc.sepolia.org",
          11155421: "https://optimism-sepolia-public.nodies.app"
        },
        // Helpful metadata so registry lookups succeed
        metadata: {
          name: 'GM Test dApp',
          description: 'Demo dApp for GM testing with WalletConnect',
          url: window.location.origin,
          icons: [window.location.origin + '/img/ether.svg']
        }
      };

      let tried = [];

      // 1) static init() on the object
      try {
        if (UMD && typeof UMD.init === 'function') {
          console.log('Calling UMD.init()');
          wcProvider = await UMD.init(options);
        }
      } catch (err) { tried.push(['UMD.init', err]); }

      // 2) default.init()
      if (!wcProvider && UMD && UMD.default) {
        try {
          if (typeof UMD.default.init === 'function') {
            console.log('Calling UMD.default.init()');
            wcProvider = await UMD.default.init(options);
          }
        } catch (err) { tried.push(['UMD.default.init', err]); }
      }

      // 3) constructor/class pattern: new UMD(options)
      if (!wcProvider && typeof UMD === 'function') {
        try {
          console.log('Trying new UMD(options)');
          const inst = new UMD(options);
          // some builds return instance synchronously
          if (inst) wcProvider = inst;
        } catch (err) { tried.push(['new UMD()', err]); }
      }

      // 4) named nested providers (EthereumProvider / WalletConnectProvider)
      if (!wcProvider && UMD && typeof UMD === 'object') {
        const nestedCandidates = ['EthereumProvider', 'WalletConnectProvider', 'default'];
        for (const key of nestedCandidates) {
          const val = UMD[key];
          if (!val) continue;
          try {
            if (typeof val.init === 'function') {
              console.log(`Calling UMD["${key}"].init()`);
              wcProvider = await val.init(options);
              break;
            }
            if (typeof val === 'function') {
              console.log(`Trying new UMD["${key}"](options)`);
              const inst = new val(options);
              if (inst) { wcProvider = inst; break; }
            }
          } catch (err) { tried.push([`UMD[${key}]`, err]); }
        }
      }

      // 5) search for any function-like props that look like init/create
      if (!wcProvider && UMD && typeof UMD === 'object') {
        const names = Object.getOwnPropertyNames(UMD).concat(Object.getOwnPropertyNames(Object.getPrototypeOf(UMD) || {}));
        for (const name of names) {
          try {
            const val = UMD[name];
            if (typeof val === 'function' && /(init|create)/i.test(name)) {
              console.log(`Calling UMD["${name}"]()`);
              const maybe = await val.call(UMD, options);
              if (maybe) { wcProvider = maybe; break; }
            }
          } catch (err) { tried.push([`UMD prop ${name}`, err]); }
        }
      }

      if (!wcProvider) {
        console.error('Unable to initialize WalletConnect provider. Attempts:', tried);
        console.error('UMD runtime value:', UMD);
        alert('WalletConnect library loaded but initialization failed — see console for details.');
        return;
      }
      
      // If previous attempts didn't work, try dynamic ESM import as a last resort
      if (!wcProvider) {
        try {
          console.log('Attempting dynamic ESM import fallback for WalletConnect provider');
          const mod = await import('https://cdn.jsdelivr.net/npm/@walletconnect/ethereum-provider/dist/esm/index.min.js');
          console.log('ESM module keys:', Object.keys(mod));
          const factory2 = mod.EthereumProvider || mod.default || mod;
          if (factory2 && typeof factory2.init === 'function') {
            wcProvider = await factory2.init(options);
          } else if (typeof factory2 === 'function') {
            // try constructor or static init
            if (typeof factory2.init === 'function') wcProvider = await factory2.init(options);
            else wcProvider = new factory2(options);
          }
        } catch (impErr) {
          console.error('ESM import fallback failed', impErr);
        }
      }

      if (typeof wcProvider.connect === 'function') await wcProvider.connect();
      const ethersProvider = new ethers.BrowserProvider(wcProvider);
      wcSigner = await ethersProvider.getSigner();

      connectWcBtn.disabled = true;
      connectWcBtn.textContent = 'Connected (WC)';
      disconnectBtn.disabled = false;
      NETWORKS.forEach(net => initNetworkContainer(net, true));
      await updateAllStats(true);
    } catch (e) {
      console.error('WalletConnect v2 error', e);
      alert('WalletConnect connection failed: ' + (e && e.message ? e.message : e));
    }
  }

  function waitForEthereum(timeoutMs = 3000) {
    return new Promise(resolve => {
      if (window.ethereum) return resolve(true);
      const interval = 200;
      let waited = 0;
      const id = setInterval(() => {
        if (window.ethereum) {
          clearInterval(id);
          return resolve(true);
        }
        waited += interval;
        if (waited >= timeoutMs) {
          clearInterval(id);
          return resolve(false);
        }
      }, interval);
    });
  }

  async function disconnect() {
    signer = null;
    networksRow.innerHTML = "";
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect MetaMask";
    if (connectWcBtn) { connectWcBtn.disabled = false; connectWcBtn.textContent = 'WalletConnect'; }
    // Close WalletConnect session if present
    if (wcProvider) {
      try {
        if (typeof wcProvider.disconnect === 'function') await wcProvider.disconnect();
        else if (typeof wcProvider.close === 'function') await wcProvider.close();
      } catch (e) {
        console.warn('Error closing WC provider', e);
      }
      wcProvider = null;
      wcSigner = null;
    }
    disconnectBtn.disabled = true;
  }

  function initNetworkContainer(net, useWalletConnect = false) {
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
        if (useWalletConnect && wcSigner) {
          contract = new ethers.Contract(net.contractAddress, GM_ABI, wcSigner);
        } else {
          await switchToNetwork(net);
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          contract = new ethers.Contract(net.contractAddress, GM_ABI, signer);
        }
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
        if (useWalletConnect && wcSigner) {
          contract = new ethers.Contract(net.contractAddress, GM_ABI, wcSigner);
        } else {
          await switchToNetwork(net);
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          contract = new ethers.Contract(net.contractAddress, GM_ABI, signer);
        }
        const feeWei = await contract.getGmFeeInEth();
        const tx = await contract.sayGM({ value: feeWei });
        txStatus.textContent = "Tx sent: " + tx.hash;
        await tx.wait();
        statusText.textContent = "GM completed successfully ☀️";
        txStatus.textContent = "Confirmed: " + tx.hash;
  const user = await contract.getUserSafe(await contract.signer.getAddress());
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

  async function updateAllStats(useWalletConnect = false) {
    if (!signer && !wcSigner) return;

    for (const net of NETWORKS) {
      const container = document.querySelector(`.status-card[data-chain="${net.chainId}"]`);
      if (!container) continue;

      const streakText = container.querySelector(".streak");
      const totalGmText = container.querySelector(".totalGm");
      const statusText = container.querySelector(".statusText");

      try {
        statusText.textContent = "Gathering stats...";
        let contract, address;
        if (useWalletConnect && wcSigner) {
          contract = new ethers.Contract(net.contractAddress, GM_ABI, wcSigner);
          address = await wcSigner.getAddress();
        } else {
          await switchToNetwork(net);
          const provider = new ethers.BrowserProvider(window.ethereum);
          const signer = await provider.getSigner();
          contract = new ethers.Contract(net.contractAddress, GM_ABI, signer);
          address = await signer.getAddress();
        }
        const user = await contract.getUserSafe(address);
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
  if (connectWcBtn) connectWcBtn.addEventListener('click', connectWalletConnect);

  // EIP-1193 provider event handlers to keep UI in sync and aid debugging
  if (window.ethereum) {
    window.ethereum.on?.('accountsChanged', (accounts) => {
      console.log('accountsChanged', accounts);
      if (!accounts || accounts.length === 0) {
        disconnect();
      }
    });

    window.ethereum.on?.('chainChanged', (chainId) => {
      console.log('chainChanged', chainId);
      // Refresh UI to reflect chain change
      networksRow.innerHTML = "";
      if (signer) NETWORKS.forEach(net => initNetworkContainer(net));
    });

    window.ethereum.on?.('disconnect', (error) => {
      console.log('provider disconnect', error);
      disconnect();
    });
  }

})();

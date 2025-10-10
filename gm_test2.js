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
  // Web3Modal-based connect flow (replaces manual WalletConnect init)
  async function connectWalletConnect() {
    try {
      // Read Project ID from UI if present
      const projectInput = document.getElementById('wcProjectId');
      const projectId = projectInput && projectInput.value ? projectInput.value.trim() : '';

      // Configure Web3Modal standalone
      const modalOptions = {
        projectId: projectId || '3a5538ce9969461166625db3fdcbef8c', // fallback project id
        walletConnectVersion: 2,
        // EVM chains mapping (just for display; wallets still negotiate chain)
        chains: NETWORKS.map(n => parseInt(n.chainId, 16))
      };

      // web3Modal global from UMD: window.Web3Modal
      if (!window.Web3Modal) {
        alert('Web3Modal not loaded. Make sure the CDN script is included.');
        return;
      }

      // Initialize standalone modal (singleton) with robust shape detection.
      const Web3ModalExport = window.Web3Modal && window.Web3Modal.default;
      let modalInstance = window.__gm_web3modal || null;
      let providerFromModal = null;

      // If an existing instance already exposes connect(), prefer it
      if (modalInstance && typeof modalInstance.connect === 'function') {
        try {
          providerFromModal = await modalInstance.connect();
        } catch (err) {
          console.warn('Existing modal instance.connect() failed, will try reinit', err);
          modalInstance = null;
        }
      }

      // If no provider yet, try to instantiate or call the exported constructor/factory
      if (!providerFromModal) {
        if (!modalInstance) {
          if (!Web3ModalExport) {
            return alert('Web3Modal export not found on page.');
          }

          // Try `new Web3ModalExport({...})`
          try {
            modalInstance = new Web3ModalExport({ projectId: modalOptions.projectId });
          } catch (e) {
            // Try calling as a factory: Web3ModalExport({...})
            try {
              modalInstance = Web3ModalExport({ projectId: modalOptions.projectId });
            } catch (e2) {
              console.error('Failed to construct or call Web3Modal export:', e, e2);
              modalInstance = null;
            }
          }
        }

        // If we have an instance, try several candidate methods to obtain provider
        if (modalInstance) {
          // common instance methods
          if (typeof modalInstance.connect === 'function') {
            providerFromModal = await modalInstance.connect();
          } else if (typeof modalInstance.open === 'function') {
            providerFromModal = await modalInstance.open();
          } else if (typeof modalInstance.openModal === 'function') {
            providerFromModal = await modalInstance.openModal();
          } else if (typeof modalInstance.show === 'function') {
            providerFromModal = await modalInstance.show();
          }
        }

        // Try module-level helpers if instance didn't return a provider
        if (!providerFromModal) {
          const mod = window.__Web3ModalModule || window.__Web3ModalModule?.default || window.Web3Modal;
          try {
            if (mod && typeof mod.connect === 'function') {
              providerFromModal = await mod.connect({ projectId: modalOptions.projectId });
            } else if (mod && mod.default && typeof mod.default.connect === 'function') {
              providerFromModal = await mod.default.connect({ projectId: modalOptions.projectId });
            }
          } catch (err) {
            console.warn('Module-level connect attempt failed', err);
          }
        }
      }

      // Persist modalInstance for reuse if we have one
      if (modalInstance) window.__gm_web3modal = modalInstance;

      if (!providerFromModal) {
        console.error('No provider returned from Web3Modal (checked instance and module shapes)');
        // Diagnostic: print available Web3Modal-related globals
        console.info('Web3Modal globals:', {
          Web3Modal: window.Web3Modal,
          __gm_web3modal: window.__gm_web3modal,
          __Web3ModalModule: window.__Web3ModalModule
        });

        // Fallback: try creating WalletConnect provider directly from UMD global if present
        try {
          const direct = await tryCreateWalletConnectProvider(modalOptions.projectId, modalOptions.chains);
          if (direct) {
            console.info('Direct WalletConnect provider created as fallback');
            providerFromModal = direct;
          }
        } catch (fbErr) {
          console.warn('Direct WalletConnect fallback failed', fbErr);
        }

        if (!providerFromModal) {
          showProviderDiagnosticsOverlay();
          // append truncated raw result to the overlay for easier copy from mobile
          setTimeout(updateDiagnosticsOverlayWithRaw, 120);
          return alert('No provider returned from Web3Modal and WalletConnect fallback failed. Check console for details.');
        }
      }

  // DEBUG: preserve raw result for inspection (transient)
  try { window.__gm_web3modalResult = providerFromModal; } catch(e) {}
  console.log('Raw Web3Modal result:', providerFromModal);

  // Normalize the returned value: it may be an EIP-1193 provider, a wrapper object,
  // or a handshake object containing a `uri` for manual pairing.
  const normalized = await extractEIP1193Provider(providerFromModal);
      if (!normalized) {
        console.error('Unable to extract EIP-1193 provider from Web3Modal result', providerFromModal);
        showProviderDiagnosticsOverlay();
        return alert('Could not obtain a usable provider from Web3Modal. Check console for details.');
      }

      const wcProviderObj = normalized;
      // Save provider for disconnect
      wcProvider = wcProviderObj;

      // wcProviderObj is an EIP-1193 provider; wrap with ethers
      const ethersProvider = new ethers.BrowserProvider(wcProviderObj);
      wcSigner = await ethersProvider.getSigner();

      connectWcBtn.disabled = true;
      connectWcBtn.textContent = 'Connected (WC)';
      disconnectBtn.disabled = false;
      NETWORKS.forEach(net => initNetworkContainer(net, true));
      await updateAllStats(true);
    } catch (e) {
      console.error('Web3Modal connection failed', e);
      alert('WalletConnect / Web3Modal connection failed: ' + (e && e.message ? e.message : e));
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

    // Attempt to create a WalletConnect v2 provider directly from available UMD globals.
    // Returns an EIP-1193 provider or null.
    async function tryCreateWalletConnectProvider(projectId, chains = []) {
      // Common UMD global names to check
      const candidates = [
        window.WalletConnectProvider,
        window.WalletConnectEthereumProvider,
        window.EthereumProvider,
        window['@walletconnect/ethereum-provider'],
        window['walletconnectEthereumProvider']
      ].filter(Boolean);

      if (!candidates.length) {
        console.warn('No WalletConnect UMD global found');
        return null;
      }

      // prefer a constructor-like export
      for (const C of candidates) {
        try {
          // Some builds export a factory with init/create method
          if (typeof C.init === 'function') {
            const p = await C.init({ projectId, relayUrl: 'wss://relay.walletconnect.com', metadata: { name: 'GM dApp', description: 'GM test', url: window.location.href } });
            if (p) return p;
          }

          // Some exports are classes/constructors
          if (typeof C === 'function') {
            try {
              const inst = new C({ projectId, relayUrl: 'wss://relay.walletconnect.com', metadata: { name: 'GM dApp', description: 'GM test', url: window.location.href } });
              // provider might be the instance itself
              if (inst) return inst;
            } catch (e) {
              // try call as factory
              try {
                const inst2 = await C({ projectId, relayUrl: 'wss://relay.walletconnect.com', metadata: { name: 'GM dApp', description: 'GM test', url: window.location.href } });
                if (inst2) return inst2;
              } catch (e2) {
                // ignore and continue
              }
            }
          }

          // If object has create/init methods at top-level
          if (typeof C.create === 'function') {
            const p = await C.create({ projectId, relayUrl: 'wss://relay.walletconnect.com', metadata: { name: 'GM dApp', description: 'GM test', url: window.location.href } });
            if (p) return p;
          }
        } catch (err) {
          console.warn('Candidate WalletConnect provider failed to initialize', err);
        }
      }

      return null;
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

  // Try to extract a usable EIP-1193 provider from various shapes returned by Web3Modal
  async function extractEIP1193Provider(value) {
    if (!value) return null;

    // If it's already an EIP-1193 provider (has request), return
    if (typeof value.request === 'function') return value;

    // Some adapters return an object with `provider` property
    if (value.provider && typeof value.provider.request === 'function') return value.provider;

    // Some return a wrapper with getProvider()
    if (typeof value.getProvider === 'function') {
      try {
        const p = await value.getProvider();
        if (p && typeof p.request === 'function') return p;
      } catch (e) {
        console.warn('getProvider() failed', e);
      }
    }

    // Some return a connector object which exposes `connector.uri` or `uri`
    if (value.uri && typeof value.uri === 'string') {
      // show QR for manual pairing
      showQrModal(value.uri);
      return null;
    }
    if (value.connect && typeof value.connect === 'function' && value.connector && value.connector.uri) {
      showQrModal(value.connector.uri);
      return null;
    }

    // Check nested fields
    if (value.wallet && value.wallet.provider) {
      const p = value.wallet.provider;
      if (p && typeof p.request === 'function') return p;
    }

    // Some modules return { provider: { provider: <EIP-1193> } }
    if (value.provider && value.provider.provider && typeof value.provider.provider.request === 'function') return value.provider.provider;

    // As a last resort, check global walletconnect provider assigned by adapters
    if (window.WalletConnectProvider && typeof window.WalletConnectProvider === 'object') {
      const g = window.WalletConnectProvider;
      if (g && typeof g.request === 'function') return g;
    }

    return null;
  }

  // Show a minimal QR modal for manual pairing
  function showQrModal(uri) {
    try {
      const existing = document.getElementById('__gm_qr_modal');
      if (existing) return;
      const wrap = document.createElement('div');
      wrap.id = '__gm_qr_modal';
      wrap.style.position = 'fixed';
      wrap.style.left = '0';
      wrap.style.top = '0';
      wrap.style.right = '0';
      wrap.style.bottom = '0';
      wrap.style.background = 'rgba(0,0,0,0.75)';
      wrap.style.display = 'flex';
      wrap.style.alignItems = 'center';
      wrap.style.justifyContent = 'center';
      wrap.style.zIndex = 2147483647;

      const card = document.createElement('div');
      card.style.background = '#fff';
      card.style.padding = '16px';
      card.style.borderRadius = '8px';
      card.style.maxWidth = '420px';
      card.style.textAlign = 'center';

      const img = document.createElement('img');
      img.src = `https://chart.googleapis.com/chart?chs=300x300&cht=qr&chl=${encodeURIComponent(uri)}&choe=UTF-8`;
      img.alt = 'WC QR';
      img.style.maxWidth = '100%';

      const close = document.createElement('button');
      close.textContent = 'Close';
      close.style.marginTop = '12px';
      close.addEventListener('click', () => wrap.remove());

      const copy = document.createElement('button');
      copy.textContent = 'Copy URI';
      copy.style.marginTop = '12px';
      copy.style.marginLeft = '8px';
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(uri); alert('Copied'); } catch (e) { alert('Copy failed'); }
      });

      card.appendChild(img);
      const p = document.createElement('div'); p.style.marginTop = '8px'; p.textContent = 'Scan with WalletConnect-compatible wallet';
      card.appendChild(p);
      card.appendChild(close);
      card.appendChild(copy);
      wrap.appendChild(card);
      document.body.appendChild(wrap);
    } catch (e) { console.warn('showQrModal failed', e); }
  }

  function showProviderDiagnosticsOverlay() {
    try {
      const existing = document.getElementById('__gm_diag_overlay');
      if (existing) return;
      const overlay = document.createElement('div');
      overlay.id = '__gm_diag_overlay';
      overlay.style.position = 'fixed';
      overlay.style.left = '8px';
      overlay.style.right = '8px';
      overlay.style.bottom = '8px';
      overlay.style.zIndex = 2147483647;
      overlay.style.background = 'rgba(0,0,0,0.9)';
      overlay.style.color = '#fff';
      overlay.style.padding = '12px';
      overlay.style.borderRadius = '8px';
      overlay.style.fontSize = '13px';
      overlay.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <strong>Connection diagnostics</strong>
          <button id="__gm_diag_close" style="background:#fff;border:none;padding:4px 8px;border-radius:4px;">Close</button>
        </div>
        <div style="margin-top:8px;max-height:220px;overflow:auto;">
          <pre id="__gm_diag_pre" style="white-space:pre-wrap;color:#fff;margin:0;font-size:12px"></pre>
        </div>
        <div style="margin-top:8px;font-size:12px;opacity:0.9">Tip: copy the text above and paste into an issue or message for debugging.</div>
      `;
      document.body.appendChild(overlay);
      document.getElementById('__gm_diag_close').addEventListener('click', () => overlay.remove());

      const info = {
        location: window.location.href,
        ua: navigator.userAgent,
        Web3Modal: !!window.Web3Modal,
        Web3Modal_default: !!(window.Web3Modal && window.Web3Modal.default),
        __gm_web3modal: !!window.__gm_web3modal,
        __Web3ModalModule: !!window.__Web3ModalModule,
        WalletConnectUMD: !!(window.WalletConnectProvider || window.WalletConnectEthereumProvider || window.EthereumProvider)
      };
      document.getElementById('__gm_diag_pre').textContent = JSON.stringify(info, null, 2);
    } catch (e) {
      console.warn('Failed to show diagnostics overlay', e);
    }
  }

  // Safe serializer that limits depth and number of entries to avoid huge/cyclic dumps
  function safeSerialize(obj, opts = {}) {
    const { depth = 3, maxArray = 20, maxProps = 40 } = opts;
    const seen = new WeakSet();

    function _serialize(value, currentDepth) {
      if (value === null) return null;
      if (typeof value === 'undefined') return '[undefined]';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
      if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
      if (seen.has(value)) return '[Circular]';
      if (currentDepth <= 0) return '[MaxDepth]';

      if (Array.isArray(value)) {
        seen.add(value);
        const out = value.slice(0, maxArray).map(v => _serialize(v, currentDepth - 1));
        if (value.length > maxArray) out.push(`...[${value.length - maxArray} more]`);
        return out;
      }

      if (typeof value === 'object') {
        seen.add(value);
        const keys = Object.keys(value).slice(0, maxProps);
        const objOut = {};
        for (const k of keys) {
          try { objOut[k] = _serialize(value[k], currentDepth - 1); } catch (e) { objOut[k] = `[Error: ${e.message}]`; }
        }
        const remaining = Object.keys(value).length - keys.length;
        if (remaining > 0) objOut.__more = `...${remaining} more keys`;
        return objOut;
      }

      return String(value);
    }

    try {
      return JSON.stringify(_serialize(obj, depth), null, 2);
    } catch (e) {
      return `[serialize error: ${e.message}]`;
    }
  }

  function updateDiagnosticsOverlayWithRaw() {
    try {
      const pre = document.getElementById('__gm_diag_pre');
      if (!pre) return;
      const raw = window.__gm_web3modalResult;
      if (!raw) {
        pre.textContent += '\n\n[No raw Web3Modal result captured]';
      }
      // Also append truncated shapes of module and exports for debugging
      try {
        pre.textContent += '\n\n--- Web3Modal module (truncated) ---\n';
        pre.textContent += safeSerialize(window.__Web3ModalModule || window.Web3Modal || {}, { depth: 2, maxArray: 8, maxProps: 20 });
        pre.textContent += '\n\n--- Web3Modal.default (truncated) ---\n';
        pre.textContent += safeSerialize((window.Web3Modal && window.Web3Modal.default) || {}, { depth: 2, maxArray: 8, maxProps: 20 });
        pre.textContent += '\n\n--- __gm_web3modal instance (truncated) ---\n';
        pre.textContent += safeSerialize(window.__gm_web3modal || {}, { depth: 2, maxArray: 8, maxProps: 20 });
      } catch (e) {
        console.warn('Failed to append module shapes to overlay', e);
        return;
      }
      // If raw exists, append it after module shapes
      if (raw) {
        pre.textContent += '\n\n--- Raw Web3Modal result (truncated) ---\n';
        pre.textContent += safeSerialize(raw, { depth: 3, maxArray: 12, maxProps: 30 });
      }
    } catch (e) {
      console.warn('updateDiagnosticsOverlayWithRaw failed', e);
    }
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

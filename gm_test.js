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

  // WalletConnectProvider setup
  let wcProvider;

  let signer;
  let wcSigner;
  async function connectWalletConnect() {
    try {
      wcProvider = new WalletConnectProvider.default({
        rpc: {
          11155420: "https://base-sepolia.rpc.thirdweb.com", // Base Sepolia
          11155111: "https://rpc.sepolia.org", // Ethereum Sepolia
          11155421: "https://optimism-sepolia-public.nodies.app" // Optimism Sepolia
        }
      });
      await wcProvider.enable();
      const ethersProvider = new ethers.BrowserProvider(wcProvider);
      wcSigner = await ethersProvider.getSigner();
      connectWcBtn.disabled = true;
      connectWcBtn.textContent = "Connected (WC)";
      disconnectBtn.disabled = false;
      NETWORKS.forEach(net => initNetworkContainer(net, true));
      await updateAllStats(true);
    } catch (err) {
      console.error("WalletConnect error:", err);
      alert("WalletConnect connection failed");
    }
  }

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
        // No injected provider. On mobile, try waiting briefly (injection can be delayed), otherwise offer deep-link to MetaMask app browser.
        const isMobile = /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
        if (isMobile) {
          // Wait a short time for provider injection (some browsers / in-app flows inject slightly delayed)
          const injected = await waitForEthereum(3000);
          if (!injected) {
            const dappUrl = encodeURIComponent(window.location.href);
            const metamaskLink = `https://metamask.app.link/dapp/${dappUrl}`;
            // Inform the user and redirect them into MetaMask's internal browser where provider is injected
            if (confirm('MetaMask nie jest dostępny w tej przeglądarce. Otworzyć stronę w aplikacji MetaMask?')) {
              window.location.href = metamaskLink;
            }
            return;
          }
        }

        alert('No Ethereum provider found. Zainstaluj MetaMask lub użyj WalletConnect.');
        return;
      }

      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new ethers.BrowserProvider(window.ethereum);
      signer = await provider.getSigner();
      connectBtn.disabled = true;
      connectBtn.textContent = 'Connected';
      disconnectBtn.disabled = false;
      NETWORKS.forEach(net => initNetworkContainer(net));
      await updateAllStats();
    } catch (err) {
      console.error('connect() error:', err);
      // Provide more actionable message for mobile deep-linking issues
      if (err && err.message && /No provider|user rejected|invalid json rpc response/i.test(err.message)) {
        alert('Błąd połączenia z MetaMask. Spróbuj otworzyć stronę w przeglądarce MetaMask (mobile) lub użyj WalletConnect.');
      } else {
        alert('Błąd połączenia z portfelem: ' + (err && err.message ? err.message : err));
      }
    }
  }

  // Utility: wait for window.ethereum to appear (polling). Returns true if found within timeoutMs.
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

  function disconnect() {
  signer = null;
  wcSigner = null;
  networksRow.innerHTML = "";
  connectBtn.disabled = false;
  connectWcBtn.disabled = false;
  connectBtn.textContent = "Connect MetaMask";
  connectWcBtn.textContent = "WalletConnect";
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
        const user = await contract.getUserSafe((useWalletConnect && wcSigner) ? await wcSigner.getAddress() : await signer.getAddress());
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
  connectWcBtn.addEventListener("click", connectWalletConnect);
  disconnectBtn.addEventListener("click", disconnect);

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

import { ethers } from 'ethers';
import { createAppKit } from "@reown/appkit";
import { EthersAdapter } from "@reown/appkit-adapter-ethers";
import { mainnet, arbitrum } from "@reown/appkit/networks";

// 1. Get projectId from https://dashboard.reown.com
const projectId = "b56e18d47c72ab683b10814fe9495694";

// 2. Create your application's metadata object
const metadata = {
  name: "AppKit",
  description: "AppKit Example",
  url: "https://reown.com/appkit", // origin must match your domain & subdomain
  icons: ["https://avatars.githubusercontent.com/u/179229932"],
};

// 3. Create a AppKit instance
const modal = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [mainnet, arbitrum],
  metadata,
  projectId,
  features: {
    analytics: true, // Optional - defaults to your Cloud configuration
  },
});


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
    if (!window.ethereum) return alert("Install MetaMask.");
    await window.ethereum.request({ method: "eth_requestAccounts" });
    const provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    connectBtn.disabled = true;
    connectBtn.textContent = "Connected";
    disconnectBtn.disabled = false;
    NETWORKS.forEach(net => initNetworkContainer(net));
    await updateAllStats();
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
        const provider = new ethers.BrowserProvider(window.ethereum);
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
        const provider = new ethers.BrowserProvider(window.ethereum);
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
        const provider = new ethers.BrowserProvider(window.ethereum);
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
}

// Auto-initialize when loaded in browser
if (typeof window !== 'undefined') {
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

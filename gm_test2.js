import { ethers } from 'ethers';
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';
import { baseSepolia, optimismSepolia, sepolia } from '@reown/appkit/networks';

// Project config
const projectId = '3a5538ce9969461166625db3fdcbef8c';
const metadata = {
  name: 'dApp GM',
  description: 'dApp to say GM on multiple chains',
  url: 'https://tobiasztworek.github.io',
  icons: ['https://avatars.githubusercontent.com/u/179229932'],
};

// App state
let modal = null; // lazy AppKit modal
let activeEip1193Provider = null; // chosen provider
let signer = null;
let networksRendered = false;
let userInitiatedConnection = false; // Track if user manually triggered connection
let isTransactionInProgress = false; // Block provider refresh during transactions
let sessionTransactionCount = 0; // Track transactions in current session
let lastTransactionChainId = null; // Track last transaction network

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
  // ...existing code...
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
  console.log('🔧 [FUNCTION] getActiveProvider() CALLED');
  if (activeEip1193Provider) return activeEip1193Provider;
  try { if (modal && typeof modal.getProvider === 'function') { const p = modal.getProvider(); if (p) return p; } } catch (e) {}
  if (typeof window !== 'undefined' && window.ethereum) return window.ethereum;
  return null;
}

function getEthersProvider() {
  console.log('🔧 [FUNCTION] getEthersProvider() CALLED');
  const p = getActiveProvider();
  if (!p) return null;
  try { 
    // Create BrowserProvider with custom options to be more tolerant of network detection issues
    const browserProvider = new ethers.BrowserProvider(p, "any");
    
    // Override the network detection to be less aggressive for WalletConnect providers
    const originalDetectNetwork = browserProvider._detectNetwork;
    if (originalDetectNetwork) {
      browserProvider._detectNetwork = async function() {
        try {
          return await originalDetectNetwork.call(this);
        } catch (e) {
          // If network detection fails, return a generic network to prevent startup issues
          console.debug('[ethers] network detection failed, using fallback:', e.message);
          return { chainId: 1, name: 'unknown' }; // fallback network
        }
      };
    }
    
    // Override _start method to be more tolerant of connection issues
    const originalStart = browserProvider._start;
    if (originalStart) {
      browserProvider._start = async function() {
        try {
          return await originalStart.call(this);
        } catch (e) {
          console.debug('[ethers] provider start failed, continuing anyway:', e.message);
          // Don't throw - allow the provider to be used even if network detection fails
          this._ready = true;
        }
      };
    }
    
    return browserProvider; 
  } catch (e) { 
    console.error('Invalid EIP-1193 provider', e); 
    return null; 
  }
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
// ...existing code...
    </div>
    <div class="d-grid mb-2">
      <button class="sayGmBtn btn btn-secondary">Say GM ☀️</button>
    </div>
    <small class="text-muted d-block mb-2">💡 Mobile: App returns automatically after signing - please wait ~10-15s for blockchain confirmation</small>
    <div class="txStatus">—</div>
  `;
  col.appendChild(container); networksRow.appendChild(col);
  const sayGmBtn = container.querySelector('.sayGmBtn');
  const statusText = container.querySelector('.statusText');
// ...existing code...
  const txStatus = container.querySelector('.txStatus');
  const addBtn = container.querySelector('.addBtn');
  sayGmBtn.style.backgroundColor = net.buttonColor;
  addBtn.addEventListener('click', async () => { try { await addNetworkById(parseInt(net.chainId, 16)); } catch (e) { console.error(e); showBanner('Error adding network', 'danger'); } });
  
  sayGmBtn.addEventListener('click', async () => {
    let txSent = false; // Track if transaction was actually sent (needed in finally block)
    
    try {
      console.log('🔥 [TRANSACTION] Starting GM transaction for', net.name);
      
      isTransactionInProgress = true; // Block provider refresh during tx
      sayGmBtn.disabled = true;
      statusText.textContent = 'Preparing transaction...';
      
      console.log('[TRANSACTION] Switching to network:', net.name, net.chainId);
      const ok = await switchToNetwork(net);
      if (!ok) { 
        console.error('[TRANSACTION] Failed to switch network');
        statusText.textContent = 'No provider'; 
        sayGmBtn.disabled = false; 
        isTransactionInProgress = false; 
        return; 
      }
      
      console.log('[TRANSACTION] Getting provider and signer...');
      const provider = getEthersProvider();
      if (!provider) { 
        console.error('[TRANSACTION] No provider available');
        statusText.textContent = 'No provider'; 
        sayGmBtn.disabled = false; 
        isTransactionInProgress = false; 
        return; 
      }
      
      const s = await provider.getSigner();
      const contract = new ethers.Contract(net.contractAddress, GM_ABI, s);
      
      // Refresh WalletConnect session before transaction (important for mobile)
      console.log('[TRANSACTION] Checking provider connection state...');
      const rawProvider = getActiveProvider();
      console.log('[TRANSACTION] Raw provider:', rawProvider);
      console.log('[TRANSACTION] Has session?', rawProvider?.session ? 'YES' : 'NO');
      
      // Reset transaction counter if network changed
      if (lastTransactionChainId !== net.chainId) {
        console.log('[TRANSACTION] Network changed from', lastTransactionChainId, 'to', net.chainId, '- resetting tx counter');
        sessionTransactionCount = 0;
        lastTransactionChainId = net.chainId;
        
        // CRITICAL: Add delay after network switch for MetaMask Mobile to clear internal cache
        // This prevents "Document does not have focus" errors and multiple deeplink attempts
        console.log('[TRANSACTION] Waiting 3s after network switch for wallet to stabilize...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
      
      // NOTE: We do NOT clear cache before transaction anymore.
      // Cache is cleared in finally block AFTER transaction completes.
      // Clearing before transaction causes connection issues on mobile.
      
      if (rawProvider) {
        // For WalletConnect providers, try to refresh the session
        if (rawProvider.session || rawProvider.client) {
          console.log('[TRANSACTION] WalletConnect session detected - refreshing...');
          
          // Always try to ensure transport is open (helps with mobile WebSocket issues)
          try {
            console.log('[TRANSACTION] Ensuring transport is open...');
            // Try different paths to access relayer
            const client = rawProvider.client;
            const relayer = client?.core?.relayer || client?.relayer;
            
            if (relayer) {
              console.log('[TRANSACTION] Relayer found, checking connection...');
              const isConnected = relayer.connected;
              console.log('[TRANSACTION] Relayer connected:', isConnected);
              
              // Always try to open transport - it's idempotent if already open
              try {
                await relayer.transportOpen();
                console.log('[TRANSACTION] Transport open call completed');
                // Wait for connection to stabilize - increased to 3s for consecutive transactions
                console.log('[TRANSACTION] Waiting 3s for transport to stabilize...');
                await new Promise(r => setTimeout(r, 3000));
              } catch (transportError) {
                console.warn('[TRANSACTION] Transport open failed:', transportError);
              }
            } else {
              console.warn('[TRANSACTION] Could not find relayer in provider');
            }
          } catch (relayerError) {
            console.error('[TRANSACTION] Relayer access error:', relayerError);
          }
          
          try {
            // NOTE: We tested clearing client.pendingRequest here but it caused fee fetch timeouts
            // MetaMask Mobile handles its own cache - we cannot control it from dApp side
            // Multiple opens after network switch are a MetaMask Mobile behavior we must accept
            
            // Ping the session to ensure it's alive
            console.log('[TRANSACTION] Pinging session...');
            // Only clear pending requests before ping (not responses/results - those are needed)
            if (rawProvider.rpcProviders) {
              Object.values(rawProvider.rpcProviders).forEach(rpc => {
                if (rpc?.pendingRequest) {
                  console.log('[TRANSACTION] Clearing pending RPC request...');
                  delete rpc.pendingRequest;
                }
              });
            }
            const chainId = await rawProvider.request({ method: 'eth_chainId' });
            console.log('[TRANSACTION] Session ping successful, chainId:', chainId);
          } catch (pingError) {
            console.warn('[TRANSACTION] Session ping failed, attempting full reconnect:', pingError);
            // Try to reconnect the entire provider
            if (typeof rawProvider.connect === 'function') {
              try {
                await rawProvider.connect();
                console.log('[TRANSACTION] Provider reconnected');
                await new Promise(r => setTimeout(r, 1000));
              } catch (reconnectError) {
                console.error('[TRANSACTION] Provider reconnect failed:', reconnectError);
              }
            }
          }
        } else {
          console.log('[TRANSACTION] Not a WalletConnect provider or no session - skipping refresh');
        }
      }
      
      // Fetch GM fee - quick timeout, non-blocking
      console.log('[TRANSACTION] Fetching GM fee...');
      statusText.textContent = 'Fetching fee...';
      let feeWei;
      
      // Try up to 2 times with longer timeout
      let feeAttempts = 0;
      const maxFeeAttempts = 2;
      
      while (feeAttempts < maxFeeAttempts) {
        try {
          feeAttempts++;
          if (feeAttempts > 1) {
            console.log(`[TRANSACTION] Fee fetch retry ${feeAttempts}/${maxFeeAttempts}...`);
            statusText.textContent = `Retrying fee fetch (${feeAttempts}/${maxFeeAttempts})...`;
          }
          
          const feePromise = contract.getGmFeeInEth();
          const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Fee fetch timeout')), 30000) // 30s timeout (doubled)
          );
          
          feeWei = await Promise.race([feePromise, timeoutPromise]);
          console.log('[TRANSACTION] GM fee:', ethers.formatEther(feeWei), 'ETH');
          statusText.textContent = `Fee: ${ethers.formatEther(feeWei)} ETH`;
          break; // Success - exit retry loop
          
        } catch (feeError) {
          console.error(`[TRANSACTION] Fee fetch attempt ${feeAttempts} failed:`, feeError.message);
          
          if (feeAttempts >= maxFeeAttempts) {
            // All attempts failed
            statusText.textContent = 'Error: Could not fetch fee. Please try again.';
            throw new Error('Cannot fetch GM fee after multiple attempts. If you see "Transaction confirmed" in MetaMask, please close it and try again.');
          }
          
          // Wait 2s before retry
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      
      // Get current nonce BEFORE sending transaction
      const address = await s.getAddress();
      const startNonce = await provider.getTransactionCount(address, 'latest');
      console.log('[TRANSACTION] Current nonce before tx:', startNonce);
      
      console.log('[TRANSACTION] Sending GM transaction...');
      statusText.textContent = 'Opening MetaMask...';
      
      let tx; // Will hold transaction object
      
      // Start nonce monitoring in parallel (for MetaMask Mobile quick return bug)
      const nonceMonitor = (async () => {
        console.log('[TRANSACTION] Starting parallel nonce monitoring...');
        // Wait 5s, then update UI to show we're back and waiting
        await new Promise(r => setTimeout(r, 5000));
        statusText.textContent = '✓ Returned from MetaMask - verifying on blockchain...';
        
        let consecutiveFailures = 0;
        const maxConsecutiveFailures = 3;
        
        for (let i = 0; i < 60; i++) { // Check for 2 minutes (60 * 2s)
          try {
            const currentNonce = await provider.getTransactionCount(address, 'latest');
            consecutiveFailures = 0; // Reset on success
            
            if (currentNonce > startNonce) {
              console.log('✅ [TRANSACTION] Nonce increased! Transaction confirmed by nonce monitor');
              txSent = true;
              return { detected: true, nonce: currentNonce };
            }
          } catch (error) {
            consecutiveFailures++;
            console.warn(`[TRANSACTION] Nonce check failed (${consecutiveFailures}/${maxConsecutiveFailures}):`, error.message);
            
            // If too many consecutive failures, wait longer for DNS recovery
            if (consecutiveFailures >= maxConsecutiveFailures) {
              console.log('[TRANSACTION] Multiple failures - waiting 10s for network recovery...');
              await new Promise(r => setTimeout(r, 10000));
              consecutiveFailures = 0; // Reset after long wait
              continue;
            }
          }
          
          await new Promise(r => setTimeout(r, 2000));
        }
        return { detected: false };
      })();
      
      try {
        // Try to get tx response (often fails on MetaMask Mobile)
        // For Optimism, use explicit gas limit with buffer (gas estimation can fail)
        const txOptions = { value: feeWei };
        if (net.chainId === '0xaa37dc') { // Optimism Sepolia
          txOptions.gasLimit = 100000; // Explicit gas limit with buffer
          console.log('[TRANSACTION] Using explicit gas limit for Optimism:', txOptions.gasLimit);
        }
        
        const txPromise = contract.sayGM(txOptions);
        
        // Show waiting feedback every 10 seconds
        let waitTime = 0;
        const waitInterval = setInterval(() => {
          waitTime += 10;
          statusText.textContent = `⏳ Checking blockchain... (${waitTime}s)`;
          console.log('[TRANSACTION] Still waiting for wallet response...', waitTime, 's');
        }, 10000);
        
        const timeoutPromise = new Promise((_, reject) => 
          setTimeout(() => {
            clearInterval(waitInterval);
            reject(new Error('TIMEOUT'));
          }, 120000) // 120 second (2 minute) timeout
        );
        
        // Race between tx promise, timeout, and nonce monitor
        const nonceDetectionPromise = nonceMonitor.then(result => {
          if (result.detected) {
            console.log('[TRANSACTION] Nonce monitor detected tx during send - considering it successful');
            clearInterval(waitInterval);
            // Return a fake tx object with hash that we'll try to find
            return { 
              hash: 'DETECTED_BY_NONCE',
              detected: true 
            };
          }
          throw new Error('NONCE_MONITOR_TIMEOUT');
        });
        
        tx = await Promise.race([txPromise, timeoutPromise, nonceDetectionPromise]);
        clearInterval(waitInterval);
        
        if (tx.detected) {
          // Transaction was detected by nonce monitor
          console.log('[TRANSACTION] Transaction detected by nonce monitor!');
          txSent = true;
          statusText.textContent = '✅ Transaction confirmed on blockchain!';
          txStatus.textContent = '☀️ GM sent successfully (verified by nonce)';
          return;
        }
        
        console.log('[TRANSACTION] Transaction sent! Hash:', tx.hash);
        txSent = true;
      } catch (txError) {
        console.error('[TRANSACTION] Error sending transaction:', txError);
        
        // Check if user rejected
        if (txError.code === 4001 || txError.code === 'ACTION_REJECTED') {
          console.log('[TRANSACTION] User rejected transaction');
          statusText.textContent = 'Transaction rejected';
          return;
        }
        
        // Check if timeout - try to get pending transaction from provider
        if (txError.message === 'TIMEOUT') {
          console.warn('[TRANSACTION] Timeout waiting for tx response - checking nonce monitor...');
          
          // Wait for nonce monitor to complete
          const monitorResult = await nonceMonitor;
          
          if (monitorResult.detected) {
            console.log('✅ [TRANSACTION] Transaction confirmed by nonce monitor!');
            statusText.textContent = 'GM completed successfully ☀️';
            txStatus.textContent = 'Confirmed (check wallet for tx hash)';
            return;
          }
          
          // Nonce didn't change - transaction likely failed or wasn't sent
          console.warn('[TRANSACTION] Nonce monitor did not detect transaction');
          console.warn('[TRANSACTION] Transaction may have failed or not been sent');
          statusText.textContent = 'Transaction not detected - check your wallet';
          txStatus.textContent = 'Please check MetaMask history';
          return;
        }
        
        throw txError; // Re-throw other errors
      }
      
      // If we got tx hash successfully, continue with receipt polling
      if (tx && tx.hash) {
        txStatus.textContent = 'Tx sent: ' + tx.hash;
        statusText.textContent = 'Waiting for confirmation...';
        
        console.log('[TRANSACTION] Starting receipt polling...');
        // Poll for transaction receipt using provider directly (no wallet interaction needed)
        const checkReceipt = async () => {
          try {
            const receipt = await provider.getTransactionReceipt(tx.hash);
            if (receipt) {
              console.log('[TRANSACTION] Receipt received! Status:', receipt.status);
              if (receipt.status === 1) {
                console.log('✅ [TRANSACTION] GM completed successfully!');
                statusText.textContent = 'GM completed successfully ☀️';
                txStatus.textContent = 'Confirmed: ' + tx.hash;
              } else {
                console.error('❌ [TRANSACTION] Transaction failed');
                statusText.textContent = 'Transaction failed ❌';
                txStatus.textContent = 'Failed: ' + tx.hash;
              }
              return true;
            }
            return false;
          } catch (e) {
            console.debug('[TRANSACTION] Receipt check error:', e);
            return false;
          }
        };
        
        // Poll every 2 seconds for up to 2 minutes, but also race with nonce monitor
        let attempts = 0;
        const maxAttempts = 60; // 60 * 2s = 2 minutes
        let pollingActive = true;
        
        const receiptPolling = (async () => {
          while (attempts < maxAttempts && pollingActive) {
            // Check if transaction was confirmed
            if (txSent) {
              console.log('[TRANSACTION] Transaction confirmed by other method - stopping receipt polling');
              return true;
            }
            
            const confirmed = await checkReceipt();
            if (confirmed) {
              pollingActive = false;
              return true;
            }
            
            await new Promise(r => setTimeout(r, 2000));
            attempts++;
            // Update status to show we're still checking
            if (attempts % 5 === 0) {
              console.log('[TRANSACTION] Still waiting for confirmation...', attempts * 2, 'seconds elapsed');
              statusText.textContent = `Waiting for confirmation... (${attempts * 2}s)`;
            }
          }
          return false;
        })();
        
        // Race between receipt polling and nonce monitor
        const receiptFound = await Promise.race([
          receiptPolling,
          nonceMonitor.then(result => {
            if (result.detected) {
              pollingActive = false; // Stop receipt polling
              console.log('[TRANSACTION] Nonce monitor won the race!');
              statusText.textContent = 'GM completed successfully ☀️';
              txStatus.textContent = 'Confirmed: ' + tx.hash;
              return true;
            }
            return false;
          })
        ]);
        
        if (!receiptFound) {
          console.warn('⏱️ [TRANSACTION] Timeout waiting for confirmation');
          statusText.textContent = 'Check your wallet for transaction status';
          txStatus.textContent = 'Pending: ' + tx.hash;
        }
      }

    } catch (e) {
      console.error('❌ [TRANSACTION] Error:', e);
      statusText.textContent = 'Error in transaction';
    } finally {
      console.log('🔥 [TRANSACTION] Transaction flow completed, clearing flags');
      
      // Increment transaction counter ONLY if transaction was actually sent
      if (txSent) {
        sessionTransactionCount++;
        console.log('[TRANSACTION] Transaction sent successfully - session tx count:', sessionTransactionCount);
        
        // CRITICAL: Try to force MetaMask Mobile to close "Transaction complete" screen
        // This prevents the cached screen from showing on next transaction
        try {
          const rawProvider = getActiveProvider();
          if (rawProvider?.session) {
            console.log('[TRANSACTION] POST-TX: Requesting session update to force UI refresh...');
            // Ping session to force MetaMask to update its UI state
            await rawProvider.request({ method: 'eth_chainId' });
            // Small delay to let MetaMask process
            await new Promise(r => setTimeout(r, 500));
          }
        } catch (refreshError) {
          console.warn('[TRANSACTION] Post-tx session refresh failed:', refreshError);
        }
      } else {
        console.log('[TRANSACTION] Transaction failed/rejected - NOT incrementing tx count. Count remains:', sessionTransactionCount);
      }
      
      // NOTE: We do NOT clear any cache after transaction.
      // All clearing attempts (even minimal) caused fee fetch timeouts on consecutive transactions.
      // MetaMask Mobile manages its own cache - we cannot and should not interfere.
      
      isTransactionInProgress = false; // Always clear flag
      sayGmBtn.disabled = false;
    }
  });
}

// ----- network switching -----
async function switchToNetwork(net) {
  console.log('🔶 [FUNCTION] switchToNetwork() STARTED for', net.name);
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
  console.log('🔶 [FUNCTION] switchToNetwork() COMPLETED - FAILED');
  return false;
}

// ----- connect / restore -----
async function connect() {
  console.log('🔵 [FUNCTION] connect() STARTED');
  userInitiatedConnection = true; // Mark this as user-initiated
  
  // PRIORITY 1: Try injected provider first (MetaMask browser extension)
  if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') {
    console.log('[connect] Injected provider detected - using browser wallet');
    try {
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      activeEip1193Provider = window.ethereum;
      
      // Attach event listeners to injected provider
      try {
        attachProviderEventListeners(window.ethereum);
        console.log('[connect] Event listeners attached to injected provider');
      } catch (e) {
        console.warn('[connect] Failed to attach listeners:', e);
      }
      
      const provider = getEthersProvider();
      if (provider) {
        signer = await provider.getSigner();
        connectBtn.textContent = 'Disconnect';
        clearBanner();
        renderNetworkUIOnce();
        
        // Reset broken session counters on successful connection
        if (brokenSessionCount > 0) {
          console.log('[connect] Successful connection - resetting broken session counters');
          brokenSessionCount = 0;
          brokenSessionCooldownActive = false;
        }
        
        console.log('🔵 [FUNCTION] connect() COMPLETED - INJECTED PROVIDER');
        return;
      }
    } catch (injectedError) {
      console.warn('[connect] Injected provider failed:', injectedError);
      
      // Check if user rejected the request
      const isUserRejection = injectedError?.code === 4001 || 
                              injectedError?.message?.includes('User rejected') ||
                              injectedError?.message?.includes('User denied');
      
      if (isUserRejection) {
        console.log('[connect] User rejected wallet connection');
        showBanner('Connection cancelled by user', 'info');
        console.log('🔵 [FUNCTION] connect() COMPLETED - USER REJECTED');
        return; // ✅ EXIT - nie próbuj AppKit modal
      }
      
      // Only continue to fallback if it's not a user rejection
      console.log('[connect] Injected failed (not user rejection) - will try AppKit modal fallback');
    }
  }
  
  // PRIORITY 2: Fallback to WalletConnect/AppKit modal
  console.log('[connect] No injected provider or injected failed - trying AppKit modal...');
  
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
  connectBtn.textContent = 'Disconnect';
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
          try { signer = (await getEthersProvider())?.getSigner(); } catch (e) { console.debug('post-finalize update failed', e); }
        }
      })();
    } catch (e) { console.warn('providerCandidate probe failed', e); }
  } else {
    // If modal.getProvider() returns null but modal exists, try to force refresh provider
    console.log('[connect] modal.getProvider() returned null, attempting forceRefreshProvider...');
    if (modal && typeof forceRefreshProvider === 'function' && !forceRefreshInProgress) {
      const refreshSuccess = await forceRefreshProvider(true).catch(() => false); // User-initiated
      if (refreshSuccess) {
        console.log('[connect] forceRefreshProvider succeeded - provider should be available now');
        lastSuccessfulConnection = Date.now();
        return; // forceRefreshProvider handles UI updates
      }
    }
  }
  // additional probe: if modal.getProvider appears after connect, attach listeners
  try {
    let probeCount2 = 0;
    const pid2 = setInterval(async () => {
      probeCount2++;
      try {
        const p2 = modal && typeof modal.getProvider === 'function' ? modal.getProvider() : null;
        if (p2) {
          console.log('[connect probe] modal.getProvider() is now available', p2);
          try { console.log('[connect probe] provider keys ->', Object.keys(p2)); } catch (e) {}
          try { attachProviderEventListeners(p2); } catch (e) {}
          clearInterval(pid2);
        } else if (probeCount2 === 10 && modal && !activeEip1193Provider) {
          // After 4 seconds (10 * 400ms), if still no provider, try forceRefresh
          console.log('[connect probe] still no provider after 4s, trying forceRefreshProvider...');
          const refreshSuccess = await forceRefreshProvider(true).catch(() => false); // User-initiated
          if (refreshSuccess) {
            clearInterval(pid2);
          }
        }
      } catch (e) {}
      if (probeCount2 > 100) clearInterval(pid2);
    }, 400);
  } catch (e) {}
  // Final check: if still no provider after modal flow, wait briefly for injected
  if (!getActiveProvider()) {
    const injectedFound = await waitForInjectedProvider(3000);
    if (!injectedFound) { 
      // Don't show banner - modal is already open and user is connecting
      // Just wait for WalletConnect to complete
      console.log('[connect] No injected provider found, waiting for modal/WalletConnect...');
      return; 
    }
    try { await window.ethereum.request({ method: 'eth_requestAccounts' }); activeEip1193Provider = window.ethereum; } catch (e) { console.warn('eth_requestAccounts failed', e); }
  }
  const provider = getEthersProvider(); if (!provider) { console.warn('No provider available at finalization'); return; }
  signer = await provider.getSigner(); connectBtn.textContent = 'Disconnect'; clearBanner(); renderNetworkUIOnce();
  
  // Reset broken session counters on successful connection
  if (brokenSessionCount > 0) {
    console.log('[connect] Successful connection - resetting broken session counters');
    brokenSessionCount = 0;
    brokenSessionCooldownActive = false;
  }
  
  // Reset user-initiated flag after successful connection
  userInitiatedConnection = false;
  
  console.log('🔵 [FUNCTION] connect() COMPLETED');
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
            connectBtn.textContent = 'Disconnect';
            clearBanner();
            renderNetworkUIOnce();
            // await updateCurrentNetworkStats();
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

// Circuit breaker to prevent infinite loops in event handlers
let chainChangedCount = 0;
let lastChainChangeTime = 0;
// ...existing code...

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
      handleModalDisconnection();
    });
    safeOn('accountsChanged', async (accounts) => {
      console.log('🔥 [EVENT] accountsChanged TRIGGERED with accounts:', accounts);
      try {
        // Check if user has manually disconnected - respect their choice
        const connectionStatus = localStorage.getItem('@appkit/connection_status');
        if (connectionStatus === 'disconnected') {
          console.log('[accountsChanged] User manually disconnected - ignoring event');
          return;
        }
        
        if (!accounts || !accounts.length) {
          activeEip1193Provider = null;
          showBanner('Wallet accounts cleared. Reconnect?', 'warning', [ { label: 'Reconnect', onClick: () => { try { initAppKit(); if (modal && typeof modal.open === 'function') modal.open(); } catch (e) { console.warn(e); } } } ]);
          return;
        }
        // update signer and stats
  signer = (await getEthersProvider())?.getSigner();
      } catch (e) { console.debug('accountsChanged handler failed', e); }
    });
    safeOn('chainChanged', async (chainId) => {
      console.log('🔥 [EVENT] chainChanged TRIGGERED with chainId:', chainId);
      // Circuit breaker: prevent infinite loops
      const now = Date.now();
      if (now - lastChainChangeTime < 1000) {
        chainChangedCount++;
        if (chainChangedCount > 10) {
          console.warn('chainChanged circuit breaker triggered - too many events in short time');
          return;
        }
      } else {
        chainChangedCount = 0;
      }
      lastChainChangeTime = now;
      
      console.debug('chainChanged to', chainId, 'count:', chainChangedCount);
      
      // ...existing code...
      
      try { 
        // Add delay to prevent rapid-fire events
        setTimeout(() => {
          // if (!isUpdatingStats) {
          //   updateCurrentNetworkStats().catch(e => {});
          // }
        }, 500);
      } catch (e) {}
    });
    // AppKit/EthersAdapter may emit session events — try to listen generically
    safeOn('session_update', (ev) => { console.debug('session_update', ev); });
  } catch (e) { console.debug('attachProviderEventListeners error', e); }
}

// User-initiated disconnect
async function disconnect() {
  console.log('❌ [FUNCTION] disconnect() CALLED');
  
  // Reset transaction counter on disconnect
  sessionTransactionCount = 0;
  console.log('[disconnect] Reset session transaction counter');
  
  try {
    // Check if using injected provider
    const isInjected = activeEip1193Provider === window.ethereum;
    
    if (isInjected) {
      console.log('[disconnect] Disconnecting injected provider (browser wallet)');
      // For injected providers, we can't programmatically disconnect them
      // We just clear our local state and set localStorage flag
      localStorage.setItem('@appkit/connection_status', 'disconnected');
    } else if (modal) {
      // For modal/WalletConnect, properly disconnect through AppKit
      console.log('[disconnect] Disconnecting modal/WalletConnect provider');
      try {
        if (typeof modal.disconnect === 'function') {
          await modal.disconnect();
          console.log('[disconnect] Modal disconnect succeeded');
        }
        
        // Clear WalletConnect session data to prevent reusing expired sessions
        try {
          const wcKeys = Object.keys(localStorage).filter(k => 
            k.startsWith('wc@2:') || 
            k.startsWith('@walletconnect') ||
            k.includes('walletconnect')
          );
          wcKeys.forEach(key => {
            try {
              localStorage.removeItem(key);
              console.log('[disconnect] Cleared WalletConnect key:', key);
            } catch (e) {}
          });
        } catch (e) {
          console.warn('[disconnect] Failed to clear WalletConnect keys:', e);
        }
      } catch (e) {
        console.warn('[disconnect] Modal disconnect failed:', e);
      }
    }
    
    // Clear local state regardless of provider type
    handleModalDisconnection();
    
    console.log('❌ [FUNCTION] disconnect() COMPLETED');
  } catch (error) {
    console.error('[disconnect] Error during disconnect:', error);
  }
}

// Handle disconnection detected from modal state
function handleModalDisconnection() {
  console.log('❌ [FUNCTION] handleModalDisconnection() CALLED');
  console.log('[disconnect] Handling modal disconnection...');
  
  // Clear active provider and signer
  activeEip1193Provider = null;
  signer = null;
  
  // Update UI to disconnected state
  if (connectBtn) {
    connectBtn.textContent = 'Connect Wallet';
  }
  
  // Clear any success banners
  clearBanner();
  
  // Show disconnection message
  showBanner('Wallet disconnected. Click "Connect Wallet" to reconnect.', 'info');
  
  console.log('[disconnect] Application state reset to disconnected');
}

// Global lock to prevent multiple concurrent forceRefreshProvider calls
let forceRefreshInProgress = false;

// Broken session tracking to prevent infinite retry loops
let lastBrokenSessionTime = 0;
let brokenSessionCount = 0;
let brokenSessionCooldownActive = false;
const BROKEN_SESSION_COOLDOWN_MS = 30000; // 30 seconds cooldown
const MAX_BROKEN_SESSION_ATTEMPTS = 3; // Max broken sessions before extended cooldown
const EXTENDED_COOLDOWN_MS = 120000; // 2 minutes extended cooldown

// Force refresh provider from modal (useful when modal shows connected but getProvider() returns undefined)
async function forceRefreshProvider(userInitiated = false) {
  console.log('🟠 [FUNCTION] forceRefreshProvider() STARTED');
  
  // Don't refresh provider during transaction
  if (isTransactionInProgress && !userInitiated) {
    console.log('[forceRefresh] Transaction in progress - skipping refresh');
    return false;
  }
  
  // Check if we're in extended cooldown period due to repeated broken sessions
  if (brokenSessionCooldownActive && !userInitiated) {
    const now = Date.now();
    const timeSinceLastBroken = now - lastBrokenSessionTime;
    const cooldownTime = brokenSessionCount >= MAX_BROKEN_SESSION_ATTEMPTS ? EXTENDED_COOLDOWN_MS : BROKEN_SESSION_COOLDOWN_MS;
    
    if (timeSinceLastBroken < cooldownTime) {
      console.warn('[forceRefresh] In broken session cooldown period - skipping automatic refresh');
      const remainingTime = Math.ceil((cooldownTime - timeSinceLastBroken) / 1000);
      if (userInitiated) {
        showBanner(`WalletConnect session issues detected - please wait ${remainingTime}s before reconnecting`, 'info');
      }
      return false;
    } else {
      // Cooldown expired, reset counters
      brokenSessionCooldownActive = false;
      brokenSessionCount = 0;
      console.log('[forceRefresh] Cooldown expired - resetting broken session counters');
    }
  }
  
  // Prevent multiple concurrent calls
  if (forceRefreshInProgress) {
    console.log('[forceRefresh] already in progress - skipping duplicate call');
    return false;
  }
  
  forceRefreshInProgress = true;
  try {
    console.log('[forceRefresh] attempting to extract provider from connected modal...');
    if (!modal) { console.warn('no modal available'); return false; }
    
    // FIRST: Check if modal actually shows connected state
    let isModalConnected = false;
    let connectionDetails = {};
    try {
      connectionDetails.isConnectedState = modal.getIsConnectedState?.();
      connectionDetails.caipAddress = modal.getCaipAddress?.();
      connectionDetails.connectionState = modal.connectionControllerClient?.state?.isConnected;
      
      isModalConnected = connectionDetails.isConnectedState || 
                        (connectionDetails.caipAddress && connectionDetails.caipAddress !== undefined);
      
      console.log('[forceRefresh] modal connection check:', {
        isConnectedState: connectionDetails.isConnectedState,
        caipAddress: connectionDetails.caipAddress,
        connectionState: connectionDetails.connectionState,
        modalConnected: isModalConnected
      });
    } catch (e) {
      console.debug('[forceRefresh] connection state check failed', e);
    }
    
    // If modal doesn't show connected state, don't try to extract provider
    if (!isModalConnected) {
      console.log('[forceRefresh] modal is not in connected state - checking for desync issues...');
      
      // Enhanced diagnostics for AppKit desync issues
      try {
        console.log('[forceRefresh] modal object available:', !!modal);
        if (modal) {
          console.log('[forceRefresh] modal methods available:', {
            getProvider: typeof modal.getProvider,
            getIsConnectedState: typeof modal.getIsConnectedState,
            getCaipAddress: typeof modal.getCaipAddress
          });
          
          // Check for any internal state that might indicate connection
          const modalKeys = Object.keys(modal).slice(0, 20); // First 20 keys to avoid spam
          console.log('[forceRefresh] modal keys sample:', modalKeys);
        }
        
        // Check localStorage for AppKit connection data
        if (typeof localStorage !== 'undefined') {
          const appkitKeys = Object.keys(localStorage).filter(key => 
            key.includes('appkit') || key.includes('walletconnect') || key.includes('reown')
          );
          console.log('[forceRefresh] localStorage AppKit keys:', appkitKeys);
          
          // Check specific keys that might indicate connection
          appkitKeys.forEach(key => {
            try {
              const value = localStorage.getItem(key);
              if (value && value.length < 500) { // Only log short values to avoid spam
                console.log(`[forceRefresh] localStorage[${key}]:`, value);
              } else if (value) {
                console.log(`[forceRefresh] localStorage[${key}]: [large data ${value.length} chars]`);
              }
            } catch (e) {
              console.debug(`[forceRefresh] failed to read localStorage[${key}]:`, e);
            }
          });
        }
      } catch (e) {
        console.debug('[forceRefresh] desync diagnostics failed:', e);
      }
      
      console.log('[forceRefresh] modal is not in connected state - skipping provider extraction');
      return false;
    }
    
    // try multiple ways to get the provider from @reown/appkit with EthersAdapter
    let provider = null;
    
    // method 1: standard getProvider()
    try { 
      provider = modal.getProvider && modal.getProvider(); 
      console.log('[forceRefresh] modal.getProvider() result:', provider);
    } catch (e) { console.debug('modal.getProvider failed', e); }
    
    // method 2: try accessing EthersAdapter directly from modal.adapters
    if (!provider) {
      try {
        const adapters = modal.adapters || [];
        console.log('[forceRefresh] checking adapters:', adapters.length);
        for (const adapter of adapters) {
          console.log('[forceRefresh] adapter:', adapter?.constructor?.name);
          if (adapter && typeof adapter.getProvider === 'function') {
            const p = adapter.getProvider();
            console.log('[forceRefresh] adapter.getProvider() result:', p);
            if (p) { provider = p; break; }
          }
        }
      } catch (e) { console.debug('adapter access failed', e); }
    }
    
    // method 3: try internal AppKit state (may vary by version)
    if (!provider) {
      try {
        // AppKit may store provider in internal state
        if (modal._internal?.provider) {
          provider = modal._internal.provider;
          console.log('[forceRefresh] found _internal.provider:', provider);
        } else if (modal.state?.provider) {
          provider = modal.state.provider;
          console.log('[forceRefresh] found state.provider:', provider);
        }
      } catch (e) { console.debug('internal state access failed', e); }
    }
    
    // method 4: check if there's a connected session and try to reconstruct provider
    if (!provider) {
      try {
        // look for any EIP-1193 compatible objects in modal
        const keys = Object.keys(modal || {});
        console.log('[forceRefresh] modal keys:', keys);
        for (const key of keys) {
          try {
            const obj = modal[key];
            if (obj && typeof obj.request === 'function') {
              console.log('[forceRefresh] found potential provider at modal.' + key + ':', obj);
              provider = obj;
              break;
            }
          } catch (e) {}
        }
      } catch (e) { console.debug('manual provider search failed', e); }
    }
    
    console.log('[forceRefresh] final extracted provider:', provider);
    if (provider && typeof provider.request === 'function') {
      // For WalletConnect providers, try to enable/connect them first
      let isWalletConnect = false;
      try {
        isWalletConnect = provider.constructor?.name?.includes('Universal') || 
                         provider.session || 
                         provider.client || 
                         JSON.stringify(provider).includes('walletconnect');
        console.log('[forceRefresh] isWalletConnect detection:', isWalletConnect);
        
        // Detailed session diagnostics
        console.log('[forceRefresh] provider session state:', {
          hasSession: !!provider.session,
          sessionValue: provider.session,
          hasClient: !!provider.client,
          hasNamespaces: provider.session?.namespaces,
          accounts: provider.session?.namespaces?.eip155?.accounts,
          connected: provider.connected,
          chainId: provider.chainId
        });
      } catch (e) { 
        console.debug('[forceRefresh] WalletConnect detection failed', e); 
      }
      
      // If this is a WalletConnect provider that needs enabling
      if (isWalletConnect) {
        try {
          console.log('[forceRefresh] attempting to enable WalletConnect provider...');
          
          // Try to activate WalletConnect session through different methods
          console.log('[forceRefresh] attempting to activate WalletConnect session...');
          
          // Method 1: Check if provider has session but is not connected
          if (provider.session && !provider.connected) {
            console.log('[forceRefresh] found session but provider not connected, trying to reconnect...');
            try {
              if (typeof provider.connect === 'function') {
                await provider.connect();
                console.log('[forceRefresh] provider.connect() succeeded');
              }
            } catch (e) {
              console.warn('[forceRefresh] provider.connect() failed:', e);
            }
          }
          
          // Method 2: If no session, try limited restore (with timeout to prevent hanging)
          if (!provider.session && provider.client) {
            console.log('[forceRefresh] no session found - attempting quick restore from AppKit data...');
            
            try {
              // Get connection info from AppKit modal
              const caipAddress = modal?.getCaipAddress?.();
              console.log('[forceRefresh] AppKit caipAddress for session restore:', caipAddress);
              
              if (caipAddress) {
                // Extract chain and address from CAIP format (eip155:84532:0x...)
                const parts = caipAddress.split(':');
                if (parts.length === 3) {
                  const chainId = parseInt(parts[1]);
                  const address = parts[2];
                  console.log('[forceRefresh] extracted chain:', chainId, 'address:', address);
                  
                  // Try quick activation with timeout to prevent hanging
                  console.log('[forceRefresh] attempting quick provider activation...');
                  
                  try {
                    // Wrap activation attempts in timeout promise
                    await Promise.race([
                      (async () => {
                        // Method A: Try enable with specific parameters
                        if (typeof provider.enable === 'function') {
                          const enableResult = await provider.enable();
                          console.log('[forceRefresh] provider.enable() result:', enableResult);
                        }
                        
                        // Method B: Try connect with chain info
                        if (typeof provider.connect === 'function') {
                          const connectResult = await provider.connect({ chainId });
                          console.log('[forceRefresh] provider.connect() result:', connectResult);
                        }
                        
                        // Method C: Check if session appeared after these calls
                        await new Promise(resolve => setTimeout(resolve, 500));
                        console.log('[forceRefresh] session state after activation attempts:', !!provider.session);
                      })(),
                      // Timeout after 3 seconds to prevent hanging
                      new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Activation timeout')), 3000)
                      )
                    ]);
                  } catch (timeoutError) {
                    console.warn('[forceRefresh] provider activation timed out or failed:', timeoutError.message);
                  }
                }
              }
              
            } catch (restoreError) {
              console.warn('[forceRefresh] session restore attempt failed:', restoreError);
            }
            
            // Fallback: wait briefly for session to appear (but don't wait too long)
            if (!provider.session) {
              console.log('[forceRefresh] still no session - waiting briefly for initialization...');
              let waitAttempts = 0;
              while (!provider.session && waitAttempts < 2) { // Reduced from 3 to 2 attempts
                await new Promise(resolve => setTimeout(resolve, 800)); // Reduced from 1500ms to 800ms
                waitAttempts++;
                console.log(`[forceRefresh] session wait attempt ${waitAttempts}/2, session:`, !!provider.session);
              }
              
              // If still no session, accept provider anyway - it might work for some operations
              if (!provider.session) {
                console.log('[forceRefresh] no session after waiting - continuing anyway as provider might still work');
              }
            }
          }
          
          // Try different methods to enable the provider (with timeout)
          try {
            await Promise.race([
              (async () => {
                if (typeof provider.enable === 'function') {
                  await provider.enable();
                  console.log('[forceRefresh] provider.enable() succeeded');
                } else if (typeof provider.connect === 'function') {
                  await provider.connect();
                  console.log('[forceRefresh] provider.connect() succeeded');
                } else {
                  console.log('[forceRefresh] no enable/connect method found, checking session state');
                  if (provider.session && provider.session.namespaces) {
                    console.log('[forceRefresh] provider has valid session, should be ready');
                  }
                }
              })(),
              // Timeout after 5 seconds to prevent hanging
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Enable/connect timeout')), 5000)
              )
            ]);
          } catch (enableError) {
            console.warn('[forceRefresh] provider enable/connect failed or timed out:', enableError.message);
            // Continue anyway - sometimes the provider still works
          }
        } catch (e) {
          console.warn('[forceRefresh] WalletConnect provider setup failed:', e);
          // Continue anyway - sometimes it still works
        }
      }
      
      // test the provider with retry logic for mobile connections
      let accounts = null;
      let testError = null;
      
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[forceRefresh] provider test attempt ${attempt}/3...`);
          
          // For WalletConnect, try different methods to check readiness
          if (isWalletConnect) {
            console.log(`[forceRefresh] WC provider state check - connected:${provider.connected}, session:${!!provider.session}, accounts:${provider.session?.namespaces?.eip155?.accounts}`);
            
            // If we have session but not connected, try to reconnect
            if (provider.session && !provider.connected) {
              console.log(`[forceRefresh] attempting to reconnect WC provider...`);
              try {
                await provider.connect();
                await new Promise(resolve => setTimeout(resolve, 500)); // Give it time
              } catch (reconnectError) {
                console.warn('[forceRefresh] reconnect failed:', reconnectError);
              }
            }
          }
          
          accounts = await provider.request({ method: 'eth_accounts' });
          console.log('[forceRefresh] provider test - accounts:', accounts);
          testError = null;
          break; // success
        } catch (e) {
          testError = e;
          const errorMsg = e?.message || String(e);
          console.log(`[forceRefresh] test attempt ${attempt} failed:`, errorMsg);
          
          // If it's a "Please call connect() before request()" error, wait and retry
          if (errorMsg.includes('connect() before request') || errorMsg.includes('not connected')) {
            console.log(`[forceRefresh] provider not ready (attempt ${attempt}/3), waiting...`);
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2s between attempts
              continue;
            }
          } else {
            // Other errors - don't retry
            console.warn(`[forceRefresh] provider test failed with non-connection error:`, e);
            break;
          }
        }
      }
      
      if (testError) {
        const errorMsg = testError?.message || String(testError);
        if (errorMsg.includes('connect() before request') || errorMsg.includes('not connected')) {
          // For WalletConnect providers with broken sessions, force proper reconnection
          if (isWalletConnect) {
            console.warn('[forceRefresh] WalletConnect provider has broken session - rejecting and clearing modal state');
            
            // Increment broken session counter
            brokenSessionCount++;
            const now = Date.now();
            lastBrokenSessionTime = now;
            
            // Activate cooldown to prevent immediate retries
            brokenSessionCooldownActive = true;
            
            // Check if we've exceeded max attempts
            if (brokenSessionCount >= MAX_BROKEN_SESSION_ATTEMPTS) {
              console.warn('[forceRefresh] Too many broken sessions detected - entering extended cooldown');
              showBanner('Multiple WalletConnect session failures detected - please wait 2 minutes before reconnecting', 'warning');
              return false;
            }
            
            console.log(`[forceRefresh] Broken session #${brokenSessionCount} detected - clearing state`);
            
            // Clear broken session state and force proper reconnection
            try {
              console.log('[forceRefresh] Attempting to clear broken WalletConnect state...');
              
              // Method 1: Try resetWcConnection first (safer)
              if (modal && typeof modal.resetWcConnection === 'function') {
                await modal.resetWcConnection();
                console.log('[forceRefresh] resetWcConnection() succeeded');
              }
              
              // Method 2: Try to disconnect more gently
              if (modal && typeof modal.disconnect === 'function') {
                await modal.disconnect();
                console.log('[forceRefresh] modal.disconnect() succeeded');
              }
              
              // Method 3: Clear localStorage state that might be causing confusion
              localStorage.removeItem('@appkit/connection_status');
              localStorage.removeItem('@appkit/connections');
              localStorage.setItem('@appkit/connection_status', 'disconnected');
              
              console.log('[forceRefresh] Cleared broken WalletConnect state - user will need to reconnect properly');
              
              // Show helpful banner with retry button
              showBanner(
                'WalletConnect session expired. Please reconnect your wallet.',
                'warning',
                [{
                  label: 'Reconnect',
                  onClick: () => {
                    clearBanner();
                    // Reset cooldown for user-initiated action
                    brokenSessionCooldownActive = false;
                    brokenSessionCount = 0;
                    // Open modal for reconnection
                    if (modal && typeof modal.open === 'function') {
                      modal.open();
                    }
                  }
                }]
              );
            } catch (clearError) {
              console.warn('[forceRefresh] Error clearing broken state:', clearError);
              
              // Fallback: Just clear localStorage if modal methods fail
              try {
                localStorage.removeItem('@appkit/connection_status');
                localStorage.removeItem('@appkit/connections');
                localStorage.setItem('@appkit/connection_status', 'disconnected');
                console.log('[forceRefresh] Fallback: cleared localStorage state');
              } catch (storageError) {
                console.warn('[forceRefresh] Even localStorage cleanup failed:', storageError);
              }
            }
            
            showBanner('WalletConnect session expired - please reconnect your wallet', 'warning');
            return false;
          } else {
            console.warn('[forceRefresh] Non-WC provider not ready after retries - will set as active but may need connection finalization');
          }
        } else {
          console.warn('[forceRefresh] provider test failed with error:', testError);
          showBanner('Found provider but it\'s not working - try reconnecting', 'warning');
          return false;
        }
      } else if (!accounts || !accounts.length) {
        console.warn('[forceRefresh] provider has no accounts - might be disconnected');
        // Don't fail here - could be a timing issue with mobile wallets
        console.log('[forceRefresh] accepting provider anyway - accounts might appear after connection completes');
      }
      
      activeEip1193Provider = provider;
      
      // For WalletConnect providers, try to "wake up" the connection
      if (isWalletConnect && provider.session) {
        try {
          console.log('[forceRefresh] attempting to wake up WalletConnect connection...');
          // Try a simple request to activate the connection
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
          const accounts = await provider.request({ method: 'eth_accounts' }).catch(() => null);
          if (accounts && accounts.length > 0) {
            console.log('[forceRefresh] WalletConnect connection activated successfully');
          }
        } catch (e) {
          console.debug('[forceRefresh] wake up attempt failed, provider may need more time:', e);
        }
      }
      
      // DON'T attach event listeners immediately after force refresh
      // to prevent infinite loops - they'll be attached during normal connect flow
      console.log('[forceRefresh] SUCCESS - provider set as active');
      
      // update UI safely
      try {
        connectBtn.textContent = 'Disconnect';
        clearBanner();
        renderNetworkUIOnce();
        
        // Delay these operations to prevent triggering the infinite loop
        setTimeout(async () => {
          try {
            // Additional validation for WalletConnect providers that might need time to initialize
            if (activeEip1193Provider === provider) {
              try {
                console.log('[forceRefresh] delayed validation - testing provider readiness...');
                const testAccounts = await provider.request({ method: 'eth_accounts' });
                console.log('[forceRefresh] delayed validation - accounts:', testAccounts);
                
                if (testAccounts && testAccounts.length > 0) {
                  console.log('[forceRefresh] provider is now ready with accounts');
                } else {
                  console.log('[forceRefresh] provider ready but no accounts yet');
                }
              } catch (validationError) {
                console.warn('[forceRefresh] delayed validation failed, provider may still need more time:', validationError);
              }
              
              signer = await (getEthersProvider())?.getSigner();
              // updateCurrentNetworkStats().catch(e => console.debug('updateCurrentNetworkStats failed', e));
            }
          } catch (e) { console.debug('delayed operations failed', e); }
        }, 1000);
        
        showBanner('Provider refreshed successfully! Connecting...', 'success');
      } catch (e) { console.debug('UI update failed', e); }
      
      // Reset broken session counters on successful provider refresh
      if (brokenSessionCount > 0) {
        console.log('[forceRefresh] Successful provider refresh - resetting broken session counters');
        brokenSessionCount = 0;
        brokenSessionCooldownActive = false;
      }
      
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
  } finally {
    forceRefreshInProgress = false;
    console.log('🟠 [FUNCTION] forceRefreshProvider() COMPLETED');
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

async function tryUseInjectedNow() { if (typeof window !== 'undefined' && window.ethereum) { try { await window.ethereum.request({ method: 'eth_requestAccounts' }); activeEip1193Provider = window.ethereum; signer = (await getEthersProvider())?.getSigner(); connectBtn.textContent = 'Disconnect'; clearBanner(); renderNetworkUIOnce(); } catch (e) { console.warn(e); } } else { showBanner('No injected wallet found', 'warning'); } }

async function tryRestoreConnection() {
  console.log('🔄 [FUNCTION] tryRestoreConnection() STARTED');
  console.log('[tryRestoreConnection] Starting connection restore process...');
  
  // Check if user has manually disconnected - respect their choice
  const connectionStatus = localStorage.getItem('@appkit/connection_status');
  if (connectionStatus === 'disconnected') {
    console.log('[tryRestoreConnection] User manually disconnected - skipping auto-restore');
    console.log('🔄 [FUNCTION] tryRestoreConnection() COMPLETED - MANUAL DISCONNECT');
    return false;
  }
  
  try {
    // First try standard AppKit provider restoration
    if (modal && typeof modal.getProvider === 'function') {
      const p = modal.getProvider();
      console.log('[tryRestoreConnection] modal.getProvider() result:', p);
      
      if (p && typeof p.request === 'function') {
        try { 
          const ready = await waitForProviderReady(p, 2000); 
          if (ready) { 
            const accounts = await p.request({ method: 'eth_accounts' }).catch(() => []); 
            if (accounts && accounts.length) { 
              console.log('[tryRestoreConnection] Standard provider restore successful');
              activeEip1193Provider = p; 
              signer = (await getEthersProvider())?.getSigner(); 
              connectBtn.textContent = 'Disconnect'; 
              renderNetworkUIOnce(); 
              // await updateCurrentNetworkStats(); 
              return true; 
            } 
          } 
        } catch (e) { 
          console.debug('modal restore failed', e); 
        }
      }
      
      // If modal exists but getProvider() returns null or failed, try forceRefreshProvider
      // This is especially important on page refresh when modal has a saved session
      if (modal) {
        // Check if modal actually thinks it's connected before trying to restore
        let modalConnected = false;
        try {
          const isConnected = modal.getIsConnectedState?.();
          const caipAddress = modal.getCaipAddress?.();
          modalConnected = isConnected && caipAddress && caipAddress !== undefined;
          console.log('[tryRestoreConnection] Modal connection state - isConnected:', isConnected, 'caipAddress:', caipAddress, 'modalConnected:', modalConnected);
        } catch (e) {
          console.debug('modal connection state check failed', e);
        }
        
        if (modalConnected) {
          console.log('[tryRestoreConnection] Modal shows connected state, attempting forceRefreshProvider...');
          const refreshSuccess = await forceRefreshProvider(false).catch((e) => { // Automatic
            console.debug('forceRefreshProvider failed in tryRestoreConnection', e);
            return false;
          });
          if (refreshSuccess) {
            console.log('[tryRestoreConnection] forceRefreshProvider succeeded on page refresh!');
            return true;
          }
        } else {
          console.log('[tryRestoreConnection] Modal not in connected state, skipping forceRefreshProvider');
        }
      }
    } else if (modal) {
      // If modal exists but getProvider is not a function, still try forceRefreshProvider
      console.log('[tryRestoreConnection] Modal exists but getProvider not available, trying forceRefreshProvider...');
      const refreshSuccess = await forceRefreshProvider(false).catch(() => false); // Automatic
      if (refreshSuccess) {
        return true;
      }
    }
    
    // Fallback to injected provider (MetaMask extension)
    if (typeof window !== 'undefined' && window.ethereum && typeof window.ethereum.request === 'function') { 
      try { 
        const accounts = await window.ethereum.request({ method: 'eth_accounts' }); 
        if (accounts && accounts.length) { 
          console.log('[tryRestoreConnection] Injected provider restore successful');
          activeEip1193Provider = window.ethereum; 
          signer = (await getEthersProvider())?.getSigner(); 
          connectBtn.textContent = 'Disconnect'; 
          renderNetworkUIOnce(); 
          // await updateCurrentNetworkStats();
          console.log('🔄 [FUNCTION] tryRestoreConnection() COMPLETED - SUCCESS'); 
          return true; 
        } 
      } catch (e) { 
        console.debug('injected restore failed', e); 
      } 
    }
  } catch (e) { 
    console.error('restore connection error', e); 
  }
  
  console.log('[tryRestoreConnection] No connection restored');
  console.log('🔄 [FUNCTION] tryRestoreConnection() COMPLETED - NO RESTORE');
  return false;
}

// ----- helpers -----
function waitForInjectedProvider(timeout = 3000, interval = 200) { return new Promise(resolve => { if (typeof window !== 'undefined' && window.ethereum) return resolve(true); const start = Date.now(); const id = setInterval(() => { if (typeof window !== 'undefined' && window.ethereum) { clearInterval(id); return resolve(true); } if (Date.now() - start > timeout) { clearInterval(id); return resolve(false); } }, interval); }); }

// ----- update UI / stats -----

// Update stats only for current network - called after network switches
// ...existing code...

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
let initCalled = false;

export function init() {
  // Prevent multiple initialization
  if (initCalled) {
    console.warn('init() already called - skipping duplicate initialization');
    return;
  }
  initCalled = true;
  
  connectBtn = document.getElementById('connectBtn'); networksRow = document.getElementById('networksRow'); bannerContainer = document.createElement('div'); bannerContainer.style.margin = '12px 0'; const header = document.querySelector('header');
  if (header) {
    header.appendChild(bannerContainer);
    try {
      const devBtn = document.createElement('button');
      devBtn.className = 'btn btn-sm btn-secondary ms-2';
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
      refreshBtn.className = 'btn btn-sm btn-warning ms-2';
      refreshBtn.textContent = 'Refresh Provider';
      refreshBtn.addEventListener('click', async () => {
        try {
          if (window.forceRefreshProvider) await window.forceRefreshProvider();
        } catch (e) { console.warn('forceRefreshProvider failed', e); showBanner('Provider refresh failed', 'danger'); }
      });
      
      // Emergency disconnect button
      const emergencyBtn = document.createElement('button');
      emergencyBtn.className = 'btn btn-sm btn-danger ms-2';
      emergencyBtn.textContent = 'Emergency Reset';
      emergencyBtn.addEventListener('click', () => {
        try {
          console.warn('EMERGENCY RESET triggered by user');
          activeEip1193Provider = null;
          signer = null;
          if (modal) {
            try { modal.disconnect?.(); } catch (e) {}
          }
          connectBtn.textContent = 'Connect Wallet';
          showBanner('Emergency reset completed - try connecting again', 'warning');
        } catch (e) { console.error('Emergency reset failed', e); }
      });
      
      header.appendChild(devBtn);
      header.appendChild(refreshBtn);
      header.appendChild(emergencyBtn);
    } catch (e) { console.debug('failed to add dev buttons', e); }
  }
  
  let isConnectingOrDisconnecting = false;
  
  connectBtn.addEventListener('click', async () => {
    // Prevent double-clicks and rapid toggling
    if (isConnectingOrDisconnecting) {
      console.log('🔘 [CLICK] Already processing connection/disconnection - ignoring');
      return;
    }
    
    // Capture the current state BEFORE setting the flag
    const shouldDisconnect = !!activeEip1193Provider;
    
    isConnectingOrDisconnecting = true;
    connectBtn.disabled = true;
    
    try {
      // Use the captured state to decide action
      if (shouldDisconnect) {
        console.log('🔘 [CLICK] Disconnect button clicked - calling disconnect()');
        await disconnect();
      } else {
        console.log('🔘 [CLICK] Connect button clicked - calling connect()');
        await connect();
      }
    } finally {
      // Re-enable button after a short delay
      setTimeout(() => {
        isConnectingOrDisconnecting = false;
        connectBtn.disabled = false;
      }, 500);
    }
  }); 
  renderNetworkUIOnce(); 
  tryRestoreConnection().catch(e => console.error('restore failed', e));
  
  // Additional delayed check for page refresh scenarios
  // Sometimes the modal needs extra time to initialize its session state
  setTimeout(async () => {
    if (!activeEip1193Provider && modal) {
      console.log('[delayed-check] No active provider after 5s, checking modal state...');
      try {
        const isConnected = modal.getIsConnectedState?.();
        const caipAddress = modal.getCaipAddress?.();
        const modalConnected = isConnected && caipAddress && caipAddress !== undefined;
        
        console.log('[delayed-check] Modal state - isConnected:', isConnected, 'caipAddress:', caipAddress, 'modalConnected:', modalConnected);
        
        if (modalConnected) {
          console.log('[delayed-check] Modal appears connected, trying forceRefreshProvider...');
          await forceRefreshProvider(false).catch(e => console.debug('delayed refresh failed', e)); // Automatic
        } else {
          console.log('[delayed-check] Modal not connected, no action needed');
        }
      } catch (e) {
        console.debug('delayed check error', e);
      }
    }
  }, 5000);
}

if (typeof window !== 'undefined') { window.addEventListener('DOMContentLoaded', () => { try { init(); } catch (e) { console.error('init error', e); } }); }
// Auto-initialize when loaded in browser
if (typeof window !== 'undefined') {
  // Global diagnostics: surface unhandled rejections and errors so we can
  // provide clearer messages for WalletConnect relay failures observed on
  // some mobile browsers/networks.
  // Circuit breaker for infinite loop detection
  let stackOverflowCount = 0;
  let lastStackOverflowTime = 0;
  
  window.addEventListener('unhandledrejection', (ev) => {
    try {
      console.error('Unhandled promise rejection:', ev.reason);
      const reasonStr = (ev.reason && (ev.reason.stack || ev.reason.message || String(ev.reason))) || '';
      
      // Detect stack overflow / infinite recursion
      if (reasonStr.includes('Maximum call stack size exceeded') || reasonStr.includes('RangeError')) {
        const now = Date.now();
        if (now - lastStackOverflowTime < 5000) {
          stackOverflowCount++;
          if (stackOverflowCount > 5) {
            try { ev.preventDefault(); } catch (e) {}
            console.error('CIRCUIT BREAKER: Too many stack overflows detected - reloading page in 3 seconds to recover');
            showBanner('Critical error detected - reloading page automatically to recover...', 'danger');
            setTimeout(() => { 
              try { window.location.reload(); } catch (e) {}
            }, 3000);
            return;
          }
        } else {
          stackOverflowCount = 0;
        }
        lastStackOverflowTime = now;
        
        try { ev.preventDefault(); } catch (e) {}
        console.warn('Stack overflow suppressed (count: ' + stackOverflowCount + ')');
        return;
      }
      
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

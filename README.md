# 🌅 GM dApp Multi-Chain

A modern, multi-chain decentralized application (dApp) that allows users to send "Good Morning" messages on multiple blockchain networks. Built with cutting-edge web3 technologies and optimized for both desktop and mobile wallets.

[![Live Demo](https://img.shields.io/badge/Demo-Live-brightgreen)](https://tobiasztworek.github.io/gm_test2.html)
[![Version](https://img.shields.io/badge/version-2.0.1-blue.svg)](https://github.com/tobiasztworek/tobiasztworek.github.io)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## ✨ Features

- 🌐 **Multi-Chain Support** - Works across 6 different blockchain networks
- 📱 **Mobile-Friendly** - Full support for MetaMask Mobile via WalletConnect
- 🎨 **Modern UI** - Clean, responsive interface built with Bootstrap 5
- 🔄 **Network Switching** - Seamless network switching with automatic RPC configuration
- 💰 **Dynamic Fee Calculation** - Real-time transaction fee estimation
- 🔐 **Secure Connection** - Support for both injected wallets and WalletConnect
- 🐛 **Debug Mode** - Built-in debugging tools for development (toggleable)

## 🚀 Live Demo

Visit the live application: [https://tobiasztworek.github.io/gm.html](https://tobiasztworek.github.io/gm.html)

## 🔗 Supported Networks

### Testnets
- **Base Sepolia** - `0x14a34`
  - Contract: `0x714Be7D3D4fB4D52c714b00afFd1F297FD0E023f`
  - RPC: `https://base-sepolia.rpc.thirdweb.com`

- **Ethereum Sepolia** - `0xaa36a7`
  - Contract: `0x43ef985e0A520A7331bf93319CE3e676c9FAEbc9`
  - RPC: `https://rpc.sepolia.org`

- **Optimism Sepolia** - `0xaa37dc`
  - Contract: `0x0a56E2E236547575b2db6EF7e872cd49bC91A556`
  - RPC: `https://optimism-sepolia-public.nodies.app`

### Mainnets
- **Base Mainnet** - `0x2105`
  - Contract: `0x99510A8C66Af928635287CE6E3a480cE788c3960`
  - RPC: `https://mainnet.base.org`

- **Celo Mainnet** - `0xa4ec`
  - Contract: `0xea97aE69A60ec6cc3549ea912ad6617E65d480fB`
  - RPC: `https://forno.celo.org`
  - Note: Uses CELO token instead of ETH

- **Optimism Mainnet** - `0xa`
  - Contract: `0xF9dE3B895dD0dD0a2DaD27A5Fb268Aa073c46c83`
  - RPC: `https://optimism-mainnet.public.blastapi.io`

## 🛠️ Technology Stack

### Frontend
- **JavaScript (ES6+)** - Modern JavaScript features
- **Bootstrap 5.3.2** - Responsive UI framework
- **esbuild** - Fast bundler for production builds

### Web3 Libraries
- **ethers.js v6.15.0** - Ethereum library for blockchain interaction
- **@reown/appkit v1.8.10** - Modern Web3 modal with WalletConnect v2 support
- **@reown/appkit-adapter-ethers** - Ethers.js adapter for AppKit

### Blockchain Integration
- **EIP-1193** - Standard Ethereum Provider API
- **WalletConnect v2** - Mobile wallet connection protocol
- **EIP-3326** - Network switching standard (`wallet_switchEthereumChain`)
- **EIP-3085** - Network addition standard (`wallet_addEthereumChain`)

## 📦 Installation & Development

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Setup

```bash
# Clone the repository
git clone https://github.com/tobiasztworek/tobiasztworek.github.io.git
cd tobiasztworek.github.io

# Install dependencies
npm install

# Build for production
npm run build

# The bundled files will be in dist/
```

### Project Structure

```
├── gm.html                # Main HTML file
├── gm.js                  # Main application logic
├── gm.css                 # Styling
├── dist/
│   ├── gm.bundle.js           # Production bundle
│   └── gm.bundle.js.map       # Source map
├── gm_test2.html          # Legacy redirect to gm.html
└── img/                   # Network logos
```

## 🔧 Configuration

### Debug Mode

Toggle debug mode by changing the `DEBUG_MODE` constant in `gm.js`:

```javascript
const DEBUG_MODE = false; // Set to true for development
```

When enabled, debug mode provides:
- 📝 Detailed console logging
- 🔘 Developer buttons (Dump logs, Refresh Provider, Emergency Reset)
- 💬 Info banners for all operations

### Adding New Networks

To add a new network, update the `NETWORKS` array in `gm.js`:

```javascript
{
  name: 'Network Name',
  chainId: '0xHEX_CHAIN_ID',
  contractAddress: '0xCONTRACT_ADDRESS',
  rpcUrl: 'https://rpc.url',
  explorer: 'https://explorer.url/',
  buttonColor: '#COLOR',
  logoUrl: 'img/logo.jpg',
  nativeCurrency: { 
    name: 'Token Name', 
    symbol: 'SYMBOL', 
    decimals: 18 
  },
  feeFunction: 'getGmFeeInEth', // or 'getGmFeeInCelo' for Celo
}
```

## 🎯 Key Features Explained

### Dynamic Fee Calculation
The dApp automatically detects the network and calls the appropriate fee function:
- **ETH Networks**: Uses `getGmFeeInEth()`
- **Celo Network**: Uses `getGmFeeInCelo()`

### Mobile Wallet Support
Optimized for MetaMask Mobile with:
- ✅ WalletConnect v2 integration
- ✅ 30-second timeout with retry logic
- ✅ Circuit breaker for failed connections
- ✅ Session state management
- ✅ Network change detection with transaction counter reset

### Network Switching
Seamless network switching with:
- Automatic RPC configuration
- Native currency detection
- Block explorer links
- Fallback to manual switching if needed

## 🔐 Smart Contract Interface

The dApp interacts with GM contracts that implement:

```solidity
// Standard ETH networks
function getGmFeeInEth() external view returns (uint256);
function sayGM() external payable;

// Celo network
function getGmFeeInCelo() external view returns (uint256);
function sayGM() external payable;
```

## 🐛 Troubleshooting

### Common Issues

**MetaMask Mobile not connecting:**
- Check your internet connection
- Ensure relay.walletconnect.org is not blocked by firewall/VPN
- Try switching between WiFi and mobile data
- Clear MetaMask cache: Settings → Advanced → Clear browser data

**Transaction failing:**
- Ensure you have sufficient native tokens (ETH/CELO) for gas + fee
- Check you're on the correct network
- Try disconnecting and reconnecting your wallet

**Network not switching:**
- Manually add the network to your wallet first
- Check RPC endpoint is accessible
- Try the "Emergency Reset" button (in DEBUG_MODE)

## 📊 Version History

- **v2.0.1** (Current) - Hidden dev buttons and info banners in production
- **v2.0.0** - Added DEBUG_MODE system for cleaner production builds
- **v1.9.9** - Fixed QR code connection with localStorage cleanup
- **v1.9.8** - Base network name corrections
- **v1.9.7** - Updated Base Mainnet RPC
- **v1.9.5** - Added network selector button for mobile
- **v1.9.4** - Fixed Celo Mainnet RPC and currency configuration
- **v1.9.2** - Added Celo Mainnet support with dynamic currency handling

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

## 👨‍💻 Author

**Tobiasz Tworek**
- GitHub: [@tobiasztworek](https://github.com/tobiasztworek)

## 🙏 Acknowledgments

- [Reown (WalletConnect)](https://reown.com/) - For AppKit and WalletConnect protocol
- [ethers.js](https://docs.ethers.org/) - For Ethereum interaction library
- [Base](https://base.org/), [Celo](https://celo.org/), [Optimism](https://optimism.io/) - For their blockchain networks
- [Bootstrap](https://getbootstrap.com/) - For the UI framework

---

**Made with ❤️ for the Web3 community**

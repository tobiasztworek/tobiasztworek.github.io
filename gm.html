<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GM dApp on Base</title>
<script src="https://cdn.jsdelivr.net/npm/ethers@6.8.3/dist/ethers.min.js"></script>
</head>
<body>
<h1>Say GM on Base</h1>
<button id="connectBtn">Connect MetaMask</button>
<button id="sayGmBtn" disabled>Say GM</button>
<p id="status"></p>

<script>
const gmContractAddress = "0xYourContractAddressHere"; // wklej swój adres kontraktu GM
const gmContractAbi = [
  // Minimal ABI do sayGM i Chainlink price feed
  "function sayGM() external payable",
  "function ethUsdPriceFeed() view returns (address)",
  "function getGmFeeInEth() view returns (uint256)"
];

// Chainlink Price Feed ABI
const priceFeedAbi = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)"
];

let provider;
let signer;
let gmContract;

document.getElementById("connectBtn").onclick = async () => {
  if (window.ethereum) {
    await window.ethereum.request({ method: "eth_requestAccounts" });
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    gmContract = new ethers.Contract(gmContractAddress, gmContractAbi, signer);

    document.getElementById("status").innerText = "Connected to MetaMask!";
    document.getElementById("sayGmBtn").disabled = false;
  } else {
    alert("Install MetaMask!");
  }
};

document.getElementById("sayGmBtn").onclick = async () => {
  try {
    document.getElementById("status").innerText = "Calculating fee...";
    
    // Pobierz fee z kontraktu
    const feeWei = await gmContract.getGmFeeInEth();
    
    document.getElementById("status").innerText = `Fee in ETH: ${ethers.formatEther(feeWei)} ETH`;

    // Wywołaj sayGM z odpowiednią wartością
    const tx = await gmContract.sayGM({ value: feeWei });
    document.getElementById("status").innerText = `Transaction sent: ${tx.hash}`;

    await tx.wait();
    document.getElementById("status").innerText = `GM said successfully! Tx: ${tx.hash}`;
  } catch (err) {
    console.error(err);
    document.getElementById("status").innerText = `Error: ${err.message}`;
  }
};
</script>
</body>
</html>
// Karun dagitim yapilandirmasi. Deploy sonrasi adresler buraya yazilir.
window.KARUN = {
  sepolia: {
    chainIdHex: "0xaa36a7", // 11155111
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    usdc: "",
    escrow: "",
    explorer: "https://sepolia.etherscan.io",
  },
  creditcoin: {
    chainIdHex: "0x18e8f", // 102031
    rpc: "https://rpc.cc3-testnet.creditcoin.network",
    usdc: "",
    ledger: "",
    explorer: "https://creditcoin-testnet.blockscout.com",
    adSoyad: "Creditcoin Testnet",
    paraBirimi: { name: "Testnet CTC", symbol: "tCTC", decimals: 18 },
  },
  chainKey: 1,
};

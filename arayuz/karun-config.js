// Karun dagitim yapilandirmasi. Deploy sonrasi adresler buraya yazilir.
//
// Mimari: Creditcoin HAKEM'dir (token tutmaz, odeme yapmaz). Odeme, kullanicinin
// sectigi hedef zincirdeki KarunSpender havuzundan cikar.
window.KARUN = {
  // Creditcoin: yalnizca defter/hakem
  creditcoin: {
    chainIdHex: "0x18e8f", // 102031
    rpc: "https://rpc.cc3-testnet.creditcoin.network",
    ledger: "",
    explorer: "https://creditcoin-testnet.blockscout.com",
    adSoyad: "Creditcoin Testnet",
    paraBirimi: { name: "Testnet CTC", symbol: "tCTC", decimals: 18 },
  },

  // Zincirler: teminat (escrow) ve/veya odeme (spender) uclari
  zincirler: [
    {
      key: 1,
      ad: "Sepolia",
      simge: "\u039E",
      chainIdHex: "0xaa36a7", // 11155111
      rpc: "https://ethereum-sepolia-rpc.publicnode.com",
      explorer: "https://sepolia.etherscan.io",
      usdc: "",
      escrow: "",   // teminat ucu
      spender: "",  // odeme ucu
      teminat: true,
      odeme: true,
      not: "Ethereum testnet",
      paraBirimi: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
    },
    { key: 3, ad: "Ethereum", simge: "\u039E", teminat: false, odeme: false, not: "attested by Attestcoin" },
    { key: null, ad: "Base", simge: "B", teminat: false, odeme: false, not: "roadmap" },
    { key: null, ad: "Arbitrum", simge: "A", teminat: false, odeme: false, not: "roadmap" },
    { key: null, ad: "Polygon", simge: "P", teminat: false, odeme: false, not: "roadmap" },
  ],
};

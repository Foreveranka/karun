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
      usdc: "0xb7d89dD5b11814E73995602F90603ddd893107bB",
      escrow: "0x07BEf458F5AF8D041e8ac497B2f4528eEec3D855",   // teminat ucu
      spender: "0xD819c276908A910659a5cc9315ee25b8a6287953",  // odeme ucu
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

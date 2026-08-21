/* Karun demo arayuzu: MetaMask + ethers v6.
   Sepolia'da kilit, Creditcoin'de limit izleme ve harcama. */
"use strict";

const C = window.KARUN;
const { ethers } = window;

const ESCROW_ABI = [
  "function lock(uint256 amount) external",
  "function locked(address) view returns (uint256)",
  "event Locked(address indexed user, uint256 amount, uint256 totalLocked)",
];
const USDC_ABI = [
  "function mint(address to, uint256 amount) external",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address, address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];
const LEDGER_ABI = [
  "function collateral(address, uint64) view returns (uint256)",
  "function creditLimit(address) view returns (uint256)",
  "function available(address) view returns (uint256)",
  "function outstanding(address) view returns (uint256)",
  "function spend(address recipient, uint256 amount, uint64 chainKey) external returns (bytes32)",
  "event CollateralSynced(address indexed user, uint64 indexed chainKey, uint256 totalLocked, bytes32 queryId)",
  "event SpendExecuted(address indexed user, address indexed recipient, uint256 amount, uint256 fee, bytes32 indexed claimId)",
  "event ClaimSettled(bytes32 indexed claimId, address indexed user, uint256 amount, bytes32 queryId)",
];

let tarayiciSaglayici = null;
let hesap = null;
const ccOkuyucu = new ethers.JsonRpcProvider(C.creditcoin.rpc);
const sepOkuyucu = new ethers.JsonRpcProvider(C.sepolia.rpc);

const $ = (s) => document.querySelector(s);
const birim = (v) => Number(ethers.formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 });

function gunluk(mesaj, tur) {
  const g = $("#gunluk");
  const zaman = new Date().toLocaleTimeString("en-GB");
  const sinif = tur === "ok" ? "ok" : tur === "hata" ? "hata" : tur === "bekle" ? "bekle" : "";
  g.innerHTML += `\n<span class="${sinif}">[${zaman}] ${mesaj}</span>`;
  g.scrollTop = g.scrollHeight;
}
function adim(no, durum) {
  const el = $("#a" + no);
  el.classList.remove("aktif", "tamam");
  if (durum) el.classList.add(durum);
}

async function agSec(hedef) {
  const istenen = hedef === "sepolia" ? C.sepolia : C.creditcoin;
  try {
    await tarayiciSaglayici.send("wallet_switchEthereumChain", [{ chainId: istenen.chainIdHex }]);
  } catch (hata) {
    if (hata.error?.code === 4902 || hata.code === 4902) {
      await tarayiciSaglayici.send("wallet_addEthereumChain", [{
        chainId: istenen.chainIdHex,
        chainName: hedef === "sepolia" ? "Sepolia" : istenen.adSoyad,
        rpcUrls: [istenen.rpc],
        nativeCurrency: hedef === "sepolia" ? { name: "Sepolia ETH", symbol: "ETH", decimals: 18 } : istenen.paraBirimi,
        blockExplorerUrls: [istenen.explorer],
      }]);
    } else throw hata;
  }
  return tarayiciSaglayici.getSigner();
}

async function tazele() {
  if (!hesap) return;
  try {
    const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
    const escrow = new ethers.Contract(C.sepolia.escrow, ESCROW_ABI, sepOkuyucu);
    const [kilit, attested, limit, borc] = await Promise.all([
      escrow.locked(hesap),
      ledger.collateral(hesap, C.chainKey),
      ledger.available(hesap),
      ledger.outstanding(hesap),
    ]);
    $("#o-kilit").textContent = birim(kilit) + " mUSDC";
    $("#o-attested").textContent = birim(attested) + " mUSDC";
    $("#o-limit").textContent = birim(limit) + " mUSDC";
    $("#o-borc").textContent = birim(borc) + " mUSDC";
  } catch (hata) {
    gunluk("Refresh error: " + (hata.shortMessage || hata.message), "hata");
  }
}

async function baglan() {
  if (!window.ethereum) { alert("MetaMask gerekli"); return; }
  tarayiciSaglayici = new ethers.BrowserProvider(window.ethereum);
  const hesaplar = await tarayiciSaglayici.send("eth_requestAccounts", []);
  hesap = ethers.getAddress(hesaplar[0]);
  $("#baglan").style.display = "none";
  const bilgi = $("#cuzdan-bilgi");
  bilgi.style.display = "block";
  bilgi.innerHTML = `<b>${hesap.slice(0, 6)}…${hesap.slice(-4)}</b><br>connected`;
  gunluk("Wallet connected: " + hesap, "ok");
  if (!C.sepolia.escrow || !C.creditcoin.ledger) {
    gunluk("Contract addresses missing in karun-config.js (deploy first).", "hata");
    return;
  }
  dinleyicileriKur();
  tazele();
  setInterval(tazele, 12_000);
}

function dinleyicileriKur() {
  const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
  ledger.on(ledger.getEvent("CollateralSynced"), (user, chainKey, total) => {
    if (user.toLowerCase() !== hesap.toLowerCase()) return;
    gunluk(`✔ Attestcoin proof verified on Creditcoin — collateral synced to ${birim(total)} mUSDC`, "ok");
    adim(2, "tamam");
    tazele();
  });
  ledger.on(ledger.getEvent("SpendExecuted"), (user, recipient, amount, fee, claimId) => {
    if (user.toLowerCase() !== hesap.toLowerCase()) return;
    gunluk(`✔ Spent ${birim(amount)} mUSDC → ${recipient.slice(0, 8)}… (fee ${birim(fee)}), claim ${claimId.slice(0, 10)}…`, "ok");
    adim(3, "tamam"); adim(4, "aktif");
    gunluk("Waiting for escrow auto-deduction on Sepolia…", "bekle");
    tazele();
  });
  ledger.on(ledger.getEvent("ClaimSettled"), (claimId, user, amount) => {
    if (user.toLowerCase() !== hesap.toLowerCase()) return;
    gunluk(`✔ Deduction of ${birim(amount)} mUSDC proven via Attestcoin — claim ${claimId.slice(0, 10)}… settled. No debt.`, "ok");
    adim(4, "tamam"); adim(5, "tamam");
    tazele();
  });
}

async function testParasiAl() {
  try {
    const imzaci = await agSec("sepolia");
    const usdc = new ethers.Contract(C.sepolia.usdc, USDC_ABI, imzaci);
    gunluk("Minting 10,000 test mUSDC on Sepolia…", "bekle");
    const islem = await usdc.mint(hesap, ethers.parseUnits("10000", 6));
    await islem.wait();
    gunluk("✔ Test mUSDC minted", "ok");
    tazele();
  } catch (hata) {
    gunluk("Mint error: " + (hata.shortMessage || hata.message), "hata");
  }
}

async function kilitle() {
  const deger = $("#kilit-miktar").value;
  if (!deger || Number(deger) <= 0) return;
  const miktar = ethers.parseUnits(deger, 6);
  try {
    adim(1, "aktif");
    const imzaci = await agSec("sepolia");
    const usdc = new ethers.Contract(C.sepolia.usdc, USDC_ABI, imzaci);
    const escrow = new ethers.Contract(C.sepolia.escrow, ESCROW_ABI, imzaci);

    const izin = await usdc.allowance(hesap, C.sepolia.escrow);
    if (izin < miktar) {
      gunluk("Approving escrow…", "bekle");
      await (await usdc.approve(C.sepolia.escrow, ethers.MaxUint256)).wait();
    }
    gunluk(`Locking ${deger} mUSDC into escrow on Sepolia…`, "bekle");
    const islem = await escrow.lock(miktar);
    await islem.wait();
    gunluk(`✔ Locked. tx ${islem.hash}`, "ok");
    adim(1, "tamam"); adim(2, "aktif");
    gunluk("Attestation in progress (~8 min) — the worker will submit the Attestcoin proof to Creditcoin…", "bekle");
    tazele();
  } catch (hata) {
    adim(1, "");
    gunluk("Lock error: " + (hata.shortMessage || hata.message), "hata");
  }
}

async function harca() {
  const alici = $("#harca-alici").value.trim();
  const deger = $("#harca-miktar").value;
  if (!ethers.isAddress(alici) || !deger || Number(deger) <= 0) {
    gunluk("Enter a valid recipient and amount.", "hata");
    return;
  }
  try {
    adim(3, "aktif");
    const imzaci = await agSec("creditcoin");
    const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, imzaci);
    gunluk(`Spending ${deger} mUSDC on Creditcoin (paid instantly from the Karun pool)…`, "bekle");
    const islem = await ledger.spend(alici, ethers.parseUnits(deger, 6), C.chainKey);
    await islem.wait();
    gunluk(`✔ Spend tx ${islem.hash}`, "ok");
  } catch (hata) {
    adim(3, "");
    gunluk("Spend error: " + (hata.shortMessage || hata.message), "hata");
  }
}

$("#baglan").onclick = baglan;
$("#faucet").onclick = testParasiAl;
$("#kilitle").onclick = kilitle;
$("#harca").onclick = harca;

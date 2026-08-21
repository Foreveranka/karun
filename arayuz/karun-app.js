/* Karun demo arayuzu: MetaMask + ethers v6.
   Kullanici dostu: bakiye gostergeleri, komisyon onizlemesi, dogrulama,
   mesgul durumlari, anlasilir hata mesajlari, kesif baglantilari. */
"use strict";

const C = window.KARUN;
const { ethers } = window;

const ESCROW_ABI = [
  "function lock(uint256 amount) external",
  "function locked(address) view returns (uint256)",
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
  "function feeBps() view returns (uint16)",
  "function spend(address recipient, uint256 amount, uint64 chainKey) external returns (bytes32)",
  "event CollateralSynced(address indexed user, uint64 indexed chainKey, uint256 totalLocked, bytes32 queryId)",
  "event SpendExecuted(address indexed user, address indexed recipient, uint256 amount, uint256 fee, bytes32 indexed claimId)",
  "event ClaimSettled(bytes32 indexed claimId, address indexed user, uint256 amount, bytes32 queryId)",
];

/* Kontrat revert nedenlerini insan diline cevir. */
const HATA_SOZLUGU = [
  ["limit yetersiz", "Amount exceeds your spendable limit. Lock more collateral or spend less."],
  ["havuz likiditesi", "The Karun pool doesn't have enough liquidity right now. Try a smaller amount."],
  ["zincir teminati", "Not enough collateral on that source chain to settle this spend."],
  ["mUSDC: allowance", "Token approval missing — approve the escrow first (the Lock button does this automatically)."],
  ["mUSDC: balance", "Insufficient mUSDC balance. Use the faucet button to mint test tokens."],
  ["bekleme suresi", "The unlock delay hasn't passed yet."],
  ["user rejected", "You rejected the transaction in your wallet."],
  ["insufficient funds", "Not enough gas token in your wallet (Sepolia ETH / tCTC)."],
];
function hataCevir(hata) {
  const ham = String(hata?.shortMessage || hata?.message || hata);
  for (const [anahtar, mesaj] of HATA_SOZLUGU) {
    if (ham.toLowerCase().includes(anahtar.toLowerCase())) return mesaj;
  }
  return ham.length > 140 ? ham.slice(0, 140) + "…" : ham;
}

let tarayiciSaglayici = null;
let hesap = null;
let feeBpsDeger = 30n;
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
  if (!el) return;
  el.classList.remove("aktif", "tamam");
  if (durum) el.classList.add(durum);
}
function adimlariSifirla() {
  for (let i = 1; i <= 5; i++) adim(i, "");
}
function mesgul(dugmeId, acik, yazi) {
  const d = $(dugmeId);
  if (!d) return;
  if (acik) {
    d.dataset.eski = d.textContent;
    d.textContent = yazi || "Waiting for wallet…";
    d.disabled = true;
  } else {
    d.textContent = d.dataset.eski || d.textContent;
    d.disabled = false;
  }
}
function kesifLink(zincir, hash) {
  const kok = zincir === "sepolia" ? C.sepolia.explorer : C.creditcoin.explorer;
  return `<a href="${kok}/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 10)}…↗</a>`;
}

function yapilandirmaTamam() {
  return C.sepolia.escrow && C.sepolia.usdc && C.creditcoin.ledger && C.creditcoin.usdc;
}

async function agSec(hedef) {
  const istenen = hedef === "sepolia" ? C.sepolia : C.creditcoin;
  try {
    await tarayiciSaglayici.send("wallet_switchEthereumChain", [{ chainId: istenen.chainIdHex }]);
  } catch (hata) {
    const kod = hata.error?.code ?? hata.code;
    if (kod === 4902) {
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
  if (!hesap || !yapilandirmaTamam()) return;
  try {
    const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
    const escrow = new ethers.Contract(C.sepolia.escrow, ESCROW_ABI, sepOkuyucu);
    const usdcSep = new ethers.Contract(C.sepolia.usdc, USDC_ABI, sepOkuyucu);
    const usdcCc = new ethers.Contract(C.creditcoin.usdc, USDC_ABI, ccOkuyucu);
    const [kilit, attested, limit, borc, cuzdanBakiye, havuz] = await Promise.all([
      escrow.locked(hesap),
      ledger.collateral(hesap, C.chainKey),
      ledger.available(hesap),
      ledger.outstanding(hesap),
      usdcSep.balanceOf(hesap),
      usdcCc.balanceOf(C.creditcoin.ledger),
    ]);
    $("#o-kilit").textContent = birim(kilit) + " mUSDC";
    $("#o-attested").textContent = birim(attested) + " mUSDC";
    $("#o-limit").textContent = birim(limit) + " mUSDC";
    $("#o-borc").textContent = birim(borc) + " mUSDC";
    $("#b-cuzdan").textContent = birim(cuzdanBakiye);
    $("#b-havuz").textContent = birim(havuz);
    harcamaOnizle();
  } catch (hata) {
    gunluk("Refresh error: " + hataCevir(hata), "hata");
  }
}

function harcamaOnizle() {
  const el = $("#harca-onizleme");
  const deger = $("#harca-miktar").value;
  if (!deger || Number(deger) <= 0) { el.textContent = ""; return; }
  try {
    const miktar = ethers.parseUnits(deger, 6);
    const fee = (miktar * feeBpsDeger) / 10000n;
    el.textContent = `Recipient gets ${birim(miktar)} now · ${birim(miktar + fee)} will be auto-deducted from your escrow (fee ${birim(fee)})`;
  } catch { el.textContent = ""; }
}

async function baglan() {
  if (!window.ethereum) {
    gunluk("MetaMask not found. Install it from metamask.io and refresh.", "hata");
    return;
  }
  if (!yapilandirmaTamam()) {
    gunluk("Contracts are not deployed yet — addresses missing in karun-config.js.", "hata");
    return;
  }
  try {
    mesgul("#baglan", true, "Connecting…");
    tarayiciSaglayici = new ethers.BrowserProvider(window.ethereum);
    const hesaplar = await tarayiciSaglayici.send("eth_requestAccounts", []);
    hesap = ethers.getAddress(hesaplar[0]);
    $("#baglan").style.display = "none";
    const bilgi = $("#cuzdan-bilgi");
    bilgi.style.display = "block";
    bilgi.innerHTML = `<b>${hesap.slice(0, 6)}…${hesap.slice(-4)}</b><br>connected`;
    gunluk("Wallet connected: " + hesap, "ok");

    try {
      const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
      feeBpsDeger = BigInt(await ledger.feeBps());
    } catch { /* varsayilan %0,30 kalir */ }

    window.ethereum.on?.("accountsChanged", () => location.reload());

    dinleyicileriKur();
    tazele();
    setInterval(tazele, 12_000);
  } catch (hata) {
    mesgul("#baglan", false);
    gunluk("Connect error: " + hataCevir(hata), "hata");
  }
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
    gunluk("Escrow auto-deduction on Sepolia is in progress…", "bekle");
    tazele();
  });
  ledger.on(ledger.getEvent("ClaimSettled"), (claimId, user, amount) => {
    if (user.toLowerCase() !== hesap.toLowerCase()) return;
    gunluk(`✔ Deduction of ${birim(amount)} mUSDC proven via Attestcoin — claim settled. No debt remains.`, "ok");
    adim(4, "tamam"); adim(5, "tamam");
    tazele();
  });
}

async function testParasiAl() {
  if (!hesap) { gunluk("Connect your wallet first.", "hata"); return; }
  try {
    mesgul("#faucet", true, "Minting…");
    const imzaci = await agSec("sepolia");
    const usdc = new ethers.Contract(C.sepolia.usdc, USDC_ABI, imzaci);
    gunluk("Minting 10,000 test mUSDC on Sepolia…", "bekle");
    const islem = await usdc.mint(hesap, ethers.parseUnits("10000", 6));
    await islem.wait();
    gunluk(`✔ Test mUSDC minted ${kesifLink("sepolia", islem.hash)}`, "ok");
    tazele();
  } catch (hata) {
    gunluk("Mint error: " + hataCevir(hata), "hata");
  } finally {
    mesgul("#faucet", false);
  }
}

async function kilitle() {
  if (!hesap) { gunluk("Connect your wallet first.", "hata"); return; }
  const deger = $("#kilit-miktar").value;
  if (!deger || Number(deger) <= 0) { gunluk("Enter a lock amount greater than zero.", "hata"); return; }
  let miktar;
  try { miktar = ethers.parseUnits(deger, 6); }
  catch { gunluk("Invalid amount.", "hata"); return; }

  try {
    mesgul("#kilitle", true, "Locking…");
    adimlariSifirla();
    adim(1, "aktif");
    const imzaci = await agSec("sepolia");
    const usdc = new ethers.Contract(C.sepolia.usdc, USDC_ABI, imzaci);
    const escrow = new ethers.Contract(C.sepolia.escrow, ESCROW_ABI, imzaci);

    const bakiye = await usdc.balanceOf(hesap);
    if (bakiye < miktar) {
      gunluk(`Insufficient mUSDC (you have ${birim(bakiye)}). Use the faucet button.`, "hata");
      adim(1, ""); mesgul("#kilitle", false); return;
    }

    const izin = await usdc.allowance(hesap, C.sepolia.escrow);
    if (izin < miktar) {
      gunluk("Approving escrow (one-time)…", "bekle");
      await (await usdc.approve(C.sepolia.escrow, ethers.MaxUint256)).wait();
      gunluk("✔ Approved", "ok");
    }
    gunluk(`Locking ${deger} mUSDC into escrow on Sepolia…`, "bekle");
    const islem = await escrow.lock(miktar);
    await islem.wait();
    gunluk(`✔ Locked ${kesifLink("sepolia", islem.hash)}`, "ok");
    adim(1, "tamam"); adim(2, "aktif");
    gunluk("Attestation in progress (~8 min). The worker will prove your lock on Creditcoin automatically — your limit updates when step 2 turns green.", "bekle");
    tazele();
  } catch (hata) {
    adim(1, "");
    gunluk("Lock error: " + hataCevir(hata), "hata");
  } finally {
    mesgul("#kilitle", false);
  }
}

async function harca() {
  if (!hesap) { gunluk("Connect your wallet first.", "hata"); return; }
  const alici = $("#harca-alici").value.trim();
  const deger = $("#harca-miktar").value;
  if (!ethers.isAddress(alici)) { gunluk("Enter a valid recipient address (0x…).", "hata"); return; }
  if (!deger || Number(deger) <= 0) { gunluk("Enter a spend amount greater than zero.", "hata"); return; }
  let miktar;
  try { miktar = ethers.parseUnits(deger, 6); }
  catch { gunluk("Invalid amount.", "hata"); return; }

  try {
    mesgul("#harca", true, "Spending…");
    adim(3, "aktif");

    // on kontrol: limit yeterli mi (yakinilacak hatayi cuzdana gitmeden soyle)
    const ledgerOku = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
    const uygun = await ledgerOku.available(hesap);
    const fee = (miktar * feeBpsDeger) / 10000n;
    if (miktar + fee > uygun) {
      gunluk(`Amount + fee (${birim(miktar + fee)}) exceeds your limit (${birim(uygun)}).`, "hata");
      adim(3, ""); mesgul("#harca", false); return;
    }

    const imzaci = await agSec("creditcoin");
    const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, imzaci);
    gunluk(`Spending ${deger} mUSDC on Creditcoin (recipient is paid instantly from the Karun pool)…`, "bekle");
    const islem = await ledger.spend(alici, miktar, C.chainKey);
    await islem.wait();
    gunluk(`✔ Spend confirmed ${kesifLink("creditcoin", islem.hash)}`, "ok");
  } catch (hata) {
    adim(3, "");
    gunluk("Spend error: " + hataCevir(hata), "hata");
  } finally {
    mesgul("#harca", false);
  }
}

// ── baslangic ──
$("#baglan").onclick = baglan;
$("#faucet").onclick = testParasiAl;
$("#kilitle").onclick = kilitle;
$("#harca").onclick = harca;
$("#harca-miktar").addEventListener("input", harcamaOnizle);

if (!yapilandirmaTamam()) {
  gunluk("Contracts not configured yet (karun-config.js). Deploy first, then refresh.", "hata");
} else {
  gunluk("Ready. Connect a wallet to begin.");
}

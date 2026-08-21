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
    $("#o-kilit").textContent = "$" + birim(kilit);
    $("#o-attested").textContent = "$" + birim(attested);
    $("#o-limit").textContent = "$" + birim(limit);
    $("#o-borc").textContent = "$" + birim(borc);
    $("#b-cuzdan").textContent = "$" + birim(cuzdanBakiye);
    $("#b-havuz").textContent = "$" + birim(havuz);
    zincirListesiCiz("#zincir-listesi", { 1: attested });
    zincirListesiCiz("#zincir-listesi-2", { 1: attested });
    harcamaOnizle();
    gecmisYukle();
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


/* ── Zincir vizyonu: bugun canli olan + yol haritasindakiler ── */
const ZINCIRLER = [
  { ad: "Sepolia", kisa: "SEP", simge: "Ξ", key: 1, canli: true, not: "Ethereum testnet" },
  { ad: "Ethereum", kisa: "ETH", simge: "Ξ", key: 3, canli: false, not: "attested by Attestcoin" },
  { ad: "Base", kisa: "BASE", simge: "B", key: null, canli: false, not: "roadmap" },
  { ad: "Arbitrum", kisa: "ARB", simge: "A", key: null, canli: false, not: "roadmap" },
  { ad: "Polygon", kisa: "POL", simge: "P", key: null, canli: false, not: "roadmap" },
];

function zincirListesiCiz(kapId, teminatlar) {
  const kap = $(kapId);
  if (!kap) return;
  kap.innerHTML = ZINCIRLER.map((z) => {
    const tutar = z.canli && teminatlar ? "$" + birim(teminatlar[z.key] || 0n) : "—";
    const durum = z.canli
      ? '<div class="z-durum canli">Live · proven on Creditcoin</div>'
      : `<div class="z-durum yakinda">${z.not}</div>`;
    return `<div class="zincir-satir${z.canli ? "" : " soluk"}">
      <div class="z-logo">${z.simge}</div>
      <div>
        <div class="z-ad">${z.ad}</div>
        <div class="z-detay">${z.canli ? z.not : "Coming soon"}</div>
      </div>
      <div class="z-sag"><div class="z-tutar">${tutar}</div>${durum}</div>
    </div>`;
  }).join("");
}

function zamanKisa(saniye) {
  if (!saniye) return "—";
  const fark = Math.floor(Date.now() / 1000) - Number(saniye);
  if (fark < 60) return "just now";
  if (fark < 3600) return Math.floor(fark / 60) + "m ago";
  if (fark < 86400) return Math.floor(fark / 3600) + "h ago";
  return Math.floor(fark / 86400) + "d ago";
}

/* Odeme ve aktivite gecmisini zincirden oku. */
async function gecmisYukle() {
  if (!hesap || !yapilandirmaTamam()) return;
  try {
    const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
    const guncel = await ccOkuyucu.getBlockNumber();
    const bastan = Math.max(0, guncel - 45_000);

    const [harcamalar, kapananlar, senkronlar] = await Promise.all([
      ledger.queryFilter(ledger.filters.SpendExecuted(hesap), bastan, guncel),
      ledger.queryFilter(ledger.filters.ClaimSettled(null, hesap), bastan, guncel),
      ledger.queryFilter(ledger.filters.CollateralSynced(hesap), bastan, guncel),
    ]);

    const kapaliTalepler = new Set(kapananlar.map((o) => o.args[0]));
    const bloklar = new Map();
    async function blokZamani(no) {
      if (!bloklar.has(no)) bloklar.set(no, (await ccOkuyucu.getBlock(no))?.timestamp ?? 0);
      return bloklar.get(no);
    }

    /* ── odemeler tablosu ── */
    const satirlar = [];
    for (const o of [...harcamalar].reverse()) {
      const [, alici, tutar, komisyon, claimId] = o.args;
      const kapali = kapaliTalepler.has(claimId);
      satirlar.push(`<tr>
        <td><div>${zamanKisa(await blokZamani(o.blockNumber))}</div><div class="kucuk">${kapali ? "settled" : "settling"}</div></td>
        <td class="mono">${alici.slice(0, 10)}…${alici.slice(-4)}</td>
        <td><b>$${birim(tutar)}</b><div class="kucuk">fee $${birim(komisyon)}</div></td>
        <td><span class="rozet ${kapali ? "tamam" : "bekliyor"}">${kapali ? "Settled" : "In flight"}</span></td>
        <td><a href="${C.creditcoin.explorer}/tx/${o.transactionHash}" target="_blank" rel="noopener">View ↗</a></td>
      </tr>`);
    }
    const odemeTablosu = satirlar.length
      ? `<table><thead><tr><th>When</th><th>To</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${satirlar.join("")}</tbody></table>`
      : '<div class="tablo-bos">No payments yet — send one from Overview</div>';
    if ($("#tablo-odemeler")) $("#tablo-odemeler").innerHTML = odemeTablosu;
    if ($("#son-odemeler")) {
      $("#son-odemeler").innerHTML = satirlar.length
        ? `<table><thead><tr><th>When</th><th>To</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${satirlar.slice(0, 4).join("")}</tbody></table>`
        : '<div class="tablo-bos">No payments yet</div>';
    }

    /* ── aktivite: tum kanitlanmis olaylar ── */
    const olaylar = [];
    for (const o of senkronlar) olaylar.push({ blok: o.blockNumber, tur: "Collateral proven",
      detay: "$" + birim(o.args[2]) + " total locked, verified via Attestcoin", hash: o.transactionHash });
    for (const o of harcamalar) olaylar.push({ blok: o.blockNumber, tur: "Payment sent",
      detay: "$" + birim(o.args[2]) + " to " + o.args[1].slice(0, 10) + "…", hash: o.transactionHash });
    for (const o of kapananlar) olaylar.push({ blok: o.blockNumber, tur: "Deduction proven",
      detay: "$" + birim(o.args[2]) + " deducted from escrow, claim settled", hash: o.transactionHash });
    olaylar.sort((a, b) => b.blok - a.blok);

    const aktiviteSatirlari = [];
    for (const e of olaylar) {
      aktiviteSatirlari.push(`<tr>
        <td>${zamanKisa(await blokZamani(e.blok))}</td>
        <td><b>${e.tur}</b></td>
        <td class="kucuk">${e.detay}</td>
        <td><a href="${C.creditcoin.explorer}/tx/${e.hash}" target="_blank" rel="noopener">View ↗</a></td>
      </tr>`);
    }
    if ($("#tablo-aktivite")) {
      $("#tablo-aktivite").innerHTML = aktiviteSatirlari.length
        ? `<table><thead><tr><th>When</th><th>Event</th><th>Detail</th><th></th></tr></thead><tbody>${aktiviteSatirlari.join("")}</tbody></table>`
        : '<div class="tablo-bos">No activity yet</div>';
    }
  } catch (hata) {
    /* gecmis okunamazsa sessiz gec: ana akis etkilenmesin */
  }
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

zincirListesiCiz("#zincir-listesi", null);
zincirListesiCiz("#zincir-listesi-2", null);

if (!yapilandirmaTamam()) {
  gunluk("Contracts not deployed yet. Testnet deployment is pending.", "hata");
} else {
  gunluk("Ready. Connect a wallet to begin.");
}

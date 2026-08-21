/* Karun urun paneli: MetaMask + ethers v6.
   Mimari: Creditcoin HAKEM (limit + kanit). Odeme, secilen hedef zincirdeki
   KarunSpender havuzundan cikar; kullaniciya sarmalanmis token verilmez. */
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
const SPENDER_ABI = ["function liquidity() view returns (uint256)"];
const LEDGER_ABI = [
  "function collateral(address, uint64) view returns (uint256)",
  "function available(address) view returns (uint256)",
  "function outstanding(address) view returns (uint256)",
  "function feeBps() view returns (uint16)",
  "function requestPayment(address alici, uint256 tutar, uint64 hedefZincir, uint64 kaynakZincir) external returns (bytes32)",
  "event CollateralSynced(address indexed user, uint64 indexed chainKey, uint256 totalLocked, bytes32 queryId)",
  "event PaymentAuthorized(bytes32 indexed claimId, address indexed user, uint64 indexed hedefZincir, address alici, uint256 tutar, uint256 komisyon, uint64 kaynakZincir)",
  "event PaymentProven(bytes32 indexed claimId, uint64 indexed hedefZincir, uint256 tutar, bytes32 queryId)",
  "event ClaimSettled(bytes32 indexed claimId, address indexed user, uint256 toplam, bytes32 queryId)",
];

const HATA_SOZLUGU = [
  ["limit yetersiz", "Amount exceeds your spendable balance. Lock more collateral or send less."],
  ["havuz likiditesi", "That chain's Karun pool is short on liquidity. Try a smaller amount or another chain."],
  ["zincir teminati", "Not enough collateral on the source chain to settle this payment."],
  ["odeme zinciri kapali", "Payments on that chain aren't live yet."],
  ["teminat zinciri kapali", "Collateral on that chain isn't live yet."],
  ["mUSDC: allowance", "Token approval missing — the Lock button handles this automatically."],
  ["mUSDC: balance", "Insufficient mUSDC. Use the faucet to mint test tokens."],
  ["bekleme suresi", "The unlock delay hasn't passed yet."],
  ["user rejected", "You rejected the transaction in your wallet."],
  ["insufficient funds", "Not enough gas token in your wallet."],
];
function hataCevir(hata) {
  const ham = String(hata?.shortMessage || hata?.message || hata);
  for (const [anahtar, mesaj] of HATA_SOZLUGU) if (ham.toLowerCase().includes(anahtar.toLowerCase())) return mesaj;
  return ham.length > 140 ? ham.slice(0, 140) + "…" : ham;
}

let tarayiciSaglayici = null;
let hesap = null;
let feeBpsDeger = 30n;
const ccOkuyucu = new ethers.JsonRpcProvider(C.creditcoin.rpc);

const okuyucular = {};
function okuyucu(z) {
  if (!z || !z.rpc) return null;
  if (!okuyucular[z.key]) okuyucular[z.key] = new ethers.JsonRpcProvider(z.rpc);
  return okuyucular[z.key];
}
const teminatZinciri = () => C.zincirler.find((z) => z.teminat && z.escrow);
const zincirBul = (key) => C.zincirler.find((z) => z.key === key);

const $ = (s) => document.querySelector(s);
const birim = (v) => Number(ethers.formatUnits(v, 6)).toLocaleString("en-US", { maximumFractionDigits: 2 });

function gunluk(mesaj, tur) {
  const g = $("#gunluk");
  if (!g) return;
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
function adimlariSifirla() { for (let i = 1; i <= 5; i++) adim(i, ""); }
function mesgul(id, acik, yazi) {
  const d = $(id);
  if (!d) return;
  if (acik) { d.dataset.eski = d.textContent; d.textContent = yazi || "Waiting…"; d.disabled = true; }
  else { d.textContent = d.dataset.eski || d.textContent; d.disabled = false; }
}
function kesifLink(z, hash) {
  const kok = z && z.explorer ? z.explorer : C.creditcoin.explorer;
  return `<a href="${kok}/tx/${hash}" target="_blank" rel="noopener">${hash.slice(0, 10)}…↗</a>`;
}
function yapilandirmaTamam() {
  const t = teminatZinciri();
  return !!(C.creditcoin.ledger && t && t.usdc && t.escrow && t.spender);
}

async function agSec(hedef) {
  const istenen = hedef === "creditcoin" ? C.creditcoin : hedef;
  try {
    await tarayiciSaglayici.send("wallet_switchEthereumChain", [{ chainId: istenen.chainIdHex }]);
  } catch (hata) {
    const kod = hata.error?.code ?? hata.code;
    if (kod === 4902) {
      await tarayiciSaglayici.send("wallet_addEthereumChain", [{
        chainId: istenen.chainIdHex,
        chainName: hedef === "creditcoin" ? C.creditcoin.adSoyad : istenen.ad,
        rpcUrls: [istenen.rpc],
        nativeCurrency: istenen.paraBirimi,
        blockExplorerUrls: [istenen.explorer],
      }]);
    } else throw hata;
  }
  return tarayiciSaglayici.getSigner();
}

function zincirListesiCiz(kapId, teminatlar, likiditeler) {
  const kap = $(kapId);
  if (!kap) return;
  kap.innerHTML = C.zincirler.map((z) => {
    const canli = !!(z.escrow || z.spender);
    const roller = [];
    if (z.teminat && z.escrow) roller.push("collateral");
    if (z.odeme && z.spender) roller.push("payouts");
    const tutar = canli && teminatlar && teminatlar[z.key] != null ? "$" + birim(teminatlar[z.key]) : "—";
    const alt = canli
      ? `<div class="z-durum canli">Live · ${roller.join(" + ")}</div>`
      : `<div class="z-durum yakinda">${z.not}</div>`;
    const detay = canli && likiditeler && likiditeler[z.key] != null
      ? `<div class="z-detay">Pool $${birim(likiditeler[z.key])}</div>`
      : `<div class="z-detay">${canli ? z.not : "Coming soon"}</div>`;
    return `<div class="zincir-satir${canli ? "" : " soluk"}">
      <div class="z-logo">${z.simge}</div>
      <div><div class="z-ad">${z.ad}</div>${detay}</div>
      <div class="z-sag"><div class="z-tutar">${tutar}</div>${alt}</div>
    </div>`;
  }).join("");
}

function hedefSeciciCiz() {
  const kap = $("#hedef-secici");
  if (!kap) return;
  kap.innerHTML = C.zincirler.map((z) => {
    const acik = !!(z.odeme && z.spender);
    return `<button type="button" class="hedef${acik ? "" : " kapali"}" data-key="${z.key ?? ""}" ${acik ? "" : "disabled"}>
      <span class="h-simge">${z.simge}</span>${z.ad}${acik ? "" : '<span class="h-yakinda">soon</span>'}
    </button>`;
  }).join("");
  const ilk = kap.querySelector(".hedef:not(.kapali)");
  if (ilk) ilk.classList.add("secili");
  kap.querySelectorAll(".hedef:not(.kapali)").forEach((d) => {
    d.onclick = () => {
      kap.querySelectorAll(".hedef").forEach((x) => x.classList.remove("secili"));
      d.classList.add("secili");
      harcamaOnizle();
    };
  });
}
function seciliHedefKey() {
  const el = $("#hedef-secici .hedef.secili");
  return el ? Number(el.dataset.key) : null;
}

async function tazele() {
  if (!hesap || !yapilandirmaTamam()) return;
  try {
    const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
    const t = teminatZinciri();
    const saglayici = okuyucu(t);
    const escrow = new ethers.Contract(t.escrow, ESCROW_ABI, saglayici);
    const usdc = new ethers.Contract(t.usdc, USDC_ABI, saglayici);
    const spender = new ethers.Contract(t.spender, SPENDER_ABI, saglayici);

    const [kilit, attested, limit, borc, cuzdanBakiye, likidite] = await Promise.all([
      escrow.locked(hesap),
      ledger.collateral(hesap, t.key),
      ledger.available(hesap),
      ledger.outstanding(hesap),
      usdc.balanceOf(hesap),
      spender.liquidity(),
    ]);

    $("#o-limit").textContent = "$" + birim(limit);
    $("#o-kilit").textContent = "$" + birim(kilit);
    $("#o-attested").textContent = "$" + birim(attested);
    $("#o-borc").textContent = "$" + birim(borc);
    if ($("#b-cuzdan")) $("#b-cuzdan").textContent = "$" + birim(cuzdanBakiye);
    if ($("#b-havuz")) $("#b-havuz").textContent = "$" + birim(likidite);

    zincirListesiCiz("#zincir-listesi", { [t.key]: attested }, { [t.key]: likidite });
    zincirListesiCiz("#zincir-listesi-2", { [t.key]: attested }, { [t.key]: likidite });
    harcamaOnizle();
    gecmisYukle();
  } catch (hata) {
    gunluk("Refresh error: " + hataCevir(hata), "hata");
  }
}

function harcamaOnizle() {
  const el = $("#harca-onizleme");
  if (!el) return;
  const deger = $("#harca-miktar").value;
  const hedef = zincirBul(seciliHedefKey());
  if (!deger || Number(deger) <= 0 || !hedef) { el.textContent = ""; return; }
  try {
    const miktar = ethers.parseUnits(deger, 6);
    const fee = (miktar * feeBpsDeger) / 10000n;
    const kaynak = teminatZinciri();
    el.textContent = `Recipient receives $${birim(miktar)} on ${hedef.ad} · $${birim(miktar + fee)} auto-deducted from your ${kaynak ? kaynak.ad : "source"} collateral (fee $${birim(fee)})`;
  } catch { el.textContent = ""; }
}

function zamanKisa(saniye) {
  if (!saniye) return "—";
  const fark = Math.floor(Date.now() / 1000) - Number(saniye);
  if (fark < 60) return "just now";
  if (fark < 3600) return Math.floor(fark / 60) + "m ago";
  if (fark < 86400) return Math.floor(fark / 3600) + "h ago";
  return Math.floor(fark / 86400) + "d ago";
}

async function gecmisYukle() {
  if (!hesap || !yapilandirmaTamam()) return;
  try {
    const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
    const guncel = await ccOkuyucu.getBlockNumber();
    const bastan = Math.max(0, guncel - 45_000);

    const [talepler, odenenler, kapananlar, senkronlar] = await Promise.all([
      ledger.queryFilter(ledger.filters.PaymentAuthorized(null, hesap), bastan, guncel),
      ledger.queryFilter(ledger.filters.PaymentProven(), bastan, guncel),
      ledger.queryFilter(ledger.filters.ClaimSettled(null, hesap), bastan, guncel),
      ledger.queryFilter(ledger.filters.CollateralSynced(hesap), bastan, guncel),
    ]);

    const odendi = new Set(odenenler.map((o) => o.args[0]));
    const kapandi = new Set(kapananlar.map((o) => o.args[0]));
    const bloklar = new Map();
    async function blokZamani(no) {
      if (!bloklar.has(no)) bloklar.set(no, (await ccOkuyucu.getBlock(no))?.timestamp ?? 0);
      return bloklar.get(no);
    }

    const satirlar = [];
    for (const o of [...talepler].reverse()) {
      const [claimId, , hedefKey, alici, tutar, komisyon] = o.args;
      const hedef = zincirBul(Number(hedefKey));
      const durum = kapandi.has(claimId) ? ["tamam", "Settled"]
        : odendi.has(claimId) ? ["bekliyor", "Paid · settling"] : ["bekliyor", "Sending"];
      satirlar.push(`<tr>
        <td>${zamanKisa(await blokZamani(o.blockNumber))}</td>
        <td class="mono">${alici.slice(0, 10)}…${alici.slice(-4)}</td>
        <td>${hedef ? hedef.ad : "chain " + hedefKey}</td>
        <td><b>$${birim(tutar)}</b><div class="kucuk">fee $${birim(komisyon)}</div></td>
        <td><span class="rozet ${durum[0]}">${durum[1]}</span></td>
        <td><a href="${C.creditcoin.explorer}/tx/${o.transactionHash}" target="_blank" rel="noopener">View ↗</a></td>
      </tr>`);
    }
    const basliklar = "<thead><tr><th>When</th><th>To</th><th>Paid on</th><th>Amount</th><th>Status</th><th></th></tr></thead>";
    const tablo = satirlar.length ? `<table>${basliklar}<tbody>${satirlar.join("")}</tbody></table>`
      : '<div class="tablo-bos">No payments yet</div>';
    if ($("#tablo-odemeler")) $("#tablo-odemeler").innerHTML = tablo;
    if ($("#son-odemeler")) {
      $("#son-odemeler").innerHTML = satirlar.length
        ? `<table>${basliklar}<tbody>${satirlar.slice(0, 4).join("")}</tbody></table>`
        : '<div class="tablo-bos">No payments yet</div>';
    }

    const olaylar = [];
    for (const o of senkronlar) olaylar.push({ blok: o.blockNumber, tur: "Collateral proven",
      detay: "$" + birim(o.args[2]) + " locked, verified via Attestcoin", hash: o.transactionHash });
    for (const o of talepler) olaylar.push({ blok: o.blockNumber, tur: "Payment authorized",
      detay: "$" + birim(o.args[4]) + " to " + o.args[3].slice(0, 10) + "… on " + (zincirBul(Number(o.args[2]))?.ad ?? o.args[2]), hash: o.transactionHash });
    for (const o of odenenler) olaylar.push({ blok: o.blockNumber, tur: "Payout proven",
      detay: "$" + birim(o.args[2]) + " confirmed on " + (zincirBul(Number(o.args[1]))?.ad ?? o.args[1]), hash: o.transactionHash });
    for (const o of kapananlar) olaylar.push({ blok: o.blockNumber, tur: "Deduction proven",
      detay: "$" + birim(o.args[2]) + " deducted, claim settled", hash: o.transactionHash });
    olaylar.sort((a, b) => b.blok - a.blok);

    const aktivite = [];
    for (const e of olaylar) {
      aktivite.push(`<tr><td>${zamanKisa(await blokZamani(e.blok))}</td><td><b>${e.tur}</b></td>
        <td class="kucuk">${e.detay}</td>
        <td><a href="${C.creditcoin.explorer}/tx/${e.hash}" target="_blank" rel="noopener">View ↗</a></td></tr>`);
    }
    if ($("#tablo-aktivite")) {
      $("#tablo-aktivite").innerHTML = aktivite.length
        ? `<table><thead><tr><th>When</th><th>Event</th><th>Detail</th><th></th></tr></thead><tbody>${aktivite.join("")}</tbody></table>`
        : '<div class="tablo-bos">No activity yet</div>';
    }
  } catch { /* gecmis okunamazsa ana akis etkilenmesin */ }
}

async function baglan() {
  if (!window.ethereum) { gunluk("MetaMask not found. Install it and refresh.", "hata"); return; }
  if (!yapilandirmaTamam()) { gunluk("Contracts are not deployed yet.", "hata"); return; }
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
      feeBpsDeger = BigInt(await new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu).feeBps());
    } catch {}

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
    gunluk(`✔ Attestcoin proof verified — collateral synced to $${birim(total)}`, "ok");
    adim(2, "tamam"); tazele();
  });
  ledger.on(ledger.getEvent("PaymentAuthorized"), (claimId, user, hedefKey, alici, tutar) => {
    if (user.toLowerCase() !== hesap.toLowerCase()) return;
    const hedef = zincirBul(Number(hedefKey));
    gunluk(`✔ Payment authorized: $${birim(tutar)} to ${alici.slice(0, 8)}… on ${hedef ? hedef.ad : hedefKey}`, "ok");
    adim(3, "aktif"); tazele();
  });
  ledger.on(ledger.getEvent("PaymentProven"), (claimId, hedefKey, tutar) => {
    const hedef = zincirBul(Number(hedefKey));
    gunluk(`✔ Payout proven on ${hedef ? hedef.ad : hedefKey}: recipient received $${birim(tutar)}`, "ok");
    adim(3, "tamam"); adim(4, "aktif"); tazele();
  });
  ledger.on(ledger.getEvent("ClaimSettled"), (claimId, user, toplam) => {
    if (user.toLowerCase() !== hesap.toLowerCase()) return;
    gunluk(`✔ Deduction proven — $${birim(toplam)} settled. No debt remains.`, "ok");
    adim(4, "tamam"); adim(5, "tamam"); tazele();
  });
}

async function testParasiAl() {
  if (!hesap) { gunluk("Connect your wallet first.", "hata"); return; }
  const t = teminatZinciri();
  try {
    mesgul("#faucet", true, "Minting…");
    const imzaci = await agSec(t);
    const usdc = new ethers.Contract(t.usdc, USDC_ABI, imzaci);
    gunluk(`Minting 10,000 test mUSDC on ${t.ad}…`, "bekle");
    const islem = await usdc.mint(hesap, ethers.parseUnits("10000", 6));
    await islem.wait();
    gunluk(`✔ Minted ${kesifLink(t, islem.hash)}`, "ok");
    tazele();
  } catch (hata) {
    gunluk("Mint error: " + hataCevir(hata), "hata");
  } finally { mesgul("#faucet", false); }
}

async function kilitle() {
  if (!hesap) { gunluk("Connect your wallet first.", "hata"); return; }
  const t = teminatZinciri();
  const deger = $("#kilit-miktar").value;
  if (!deger || Number(deger) <= 0) { gunluk("Enter an amount greater than zero.", "hata"); return; }
  let miktar;
  try { miktar = ethers.parseUnits(deger, 6); } catch { gunluk("Invalid amount.", "hata"); return; }

  try {
    mesgul("#kilitle", true, "Locking…");
    adimlariSifirla(); adim(1, "aktif");
    const imzaci = await agSec(t);
    const usdc = new ethers.Contract(t.usdc, USDC_ABI, imzaci);
    const escrow = new ethers.Contract(t.escrow, ESCROW_ABI, imzaci);

    const bakiye = await usdc.balanceOf(hesap);
    if (bakiye < miktar) {
      gunluk(`Insufficient mUSDC (you have $${birim(bakiye)}). Use the faucet.`, "hata");
      adim(1, ""); mesgul("#kilitle", false); return;
    }
    if ((await usdc.allowance(hesap, t.escrow)) < miktar) {
      gunluk("Approving escrow (one-time)…", "bekle");
      await (await usdc.approve(t.escrow, ethers.MaxUint256)).wait();
    }
    gunluk(`Locking $${deger} on ${t.ad}…`, "bekle");
    const islem = await escrow.lock(miktar);
    await islem.wait();
    gunluk(`✔ Locked ${kesifLink(t, islem.hash)}`, "ok");
    adim(1, "tamam"); adim(2, "aktif");
    gunluk("Attestation in progress (~8 min). Your balance opens once the proof lands on Creditcoin.", "bekle");
    tazele();
  } catch (hata) {
    adim(1, "");
    gunluk("Lock error: " + hataCevir(hata), "hata");
  } finally { mesgul("#kilitle", false); }
}

async function harca() {
  if (!hesap) { gunluk("Connect your wallet first.", "hata"); return; }
  const alici = $("#harca-alici").value.trim();
  const deger = $("#harca-miktar").value;
  const hedef = zincirBul(seciliHedefKey());
  const kaynak = teminatZinciri();
  if (!ethers.isAddress(alici)) { gunluk("Enter a valid recipient address.", "hata"); return; }
  if (!deger || Number(deger) <= 0) { gunluk("Enter an amount greater than zero.", "hata"); return; }
  if (!hedef) { gunluk("Pick a chain to pay on.", "hata"); return; }
  let miktar;
  try { miktar = ethers.parseUnits(deger, 6); } catch { gunluk("Invalid amount.", "hata"); return; }

  try {
    mesgul("#harca", true, "Sending…");
    const ledgerOku = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, ccOkuyucu);
    const uygun = await ledgerOku.available(hesap);
    const fee = (miktar * feeBpsDeger) / 10000n;
    if (miktar + fee > uygun) {
      gunluk(`Amount + fee ($${birim(miktar + fee)}) exceeds your balance ($${birim(uygun)}).`, "hata");
      mesgul("#harca", false); return;
    }
    try {
      const likidite = await new ethers.Contract(hedef.spender, SPENDER_ABI, okuyucu(hedef)).liquidity();
      if (likidite < miktar) {
        gunluk(`${hedef.ad} pool has only $${birim(likidite)} available. Try a smaller amount.`, "hata");
        mesgul("#harca", false); return;
      }
    } catch {}

    const imzaci = await agSec("creditcoin");
    const ledger = new ethers.Contract(C.creditcoin.ledger, LEDGER_ABI, imzaci);
    gunluk(`Authorizing $${deger} to be paid on ${hedef.ad} (settled from your ${kaynak.ad} collateral)…`, "bekle");
    const islem = await ledger.requestPayment(alici, miktar, hedef.key, kaynak.key);
    await islem.wait();
    gunluk(`✔ Authorized ${kesifLink(null, islem.hash)} — the ${hedef.ad} pool is paying the recipient now`, "ok");
  } catch (hata) {
    gunluk("Send error: " + hataCevir(hata), "hata");
  } finally { mesgul("#harca", false); }
}

/* ── baslangic ── */
$("#baglan").onclick = baglan;
if ($("#faucet")) $("#faucet").onclick = testParasiAl;
if ($("#kilitle")) $("#kilitle").onclick = kilitle;
if ($("#harca")) $("#harca").onclick = harca;
if ($("#harca-miktar")) $("#harca-miktar").addEventListener("input", harcamaOnizle);

zincirListesiCiz("#zincir-listesi", null, null);
zincirListesiCiz("#zincir-listesi-2", null, null);
hedefSeciciCiz();

const _teminat = teminatZinciri();
if (_teminat && $("#kilit-zincir")) $("#kilit-zincir").textContent = _teminat.ad;

if (!yapilandirmaTamam()) {
  gunluk("Contracts not deployed yet. Testnet deployment is pending.", "hata");
} else {
  gunluk("Ready. Connect a wallet to begin.");
}

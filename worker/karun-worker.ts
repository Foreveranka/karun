/**
 * Karun Offchain Worker (dayanikli surum)
 *
 * Gorevler:
 *  1. KILIT: Sepolia'daki Locked olaylarini izler, Attestcoin kaniti uretir,
 *     KarunLedger.submitLockProof ile limiti acar.
 *  2. KESINTI: Creditcoin'deki DeductionQueued olaylarini izler, escrow'da
 *     deduct() calistirir, kesintiyi kanitlayip submitDeductionProof ile kapatir.
 *
 * Dayaniklilik:
 *  - Yeniden baslatmada son islenen bloklardan devam eder (worker/durum.json)
 *  - Zincir ustu durumu kontrol ederek mukerrer islemeyi atlar
 *  - Tum isler tek sirali kuyruktan gecer (nonce cakismasi olmaz)
 *  - Gecici hatalarda ussel bekleme ile 5 kez dener
 */
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { proofProvider, chainInfo } from "@gluwa/usc-sdk";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config();

const ESCROW_ABI = [
  "event Locked(address indexed user, uint256 amount, uint256 totalLocked)",
  "event Deducted(address indexed user, uint256 amount, bytes32 indexed claimId, uint256 remainingLocked)",
  "function deduct(address user, uint256 amount, bytes32 claimId) external",
  "function locked(address user) view returns (uint256)",
  "function processedClaims(bytes32) view returns (bool)",
];

const SPENDER_ABI = [
  "event Paid(bytes32 indexed payoutId, address indexed recipient, uint256 amount)",
  "function payout(bytes32 payoutId, address recipient, uint256 amount) external",
  "function processedPayouts(bytes32) view returns (bool)",
  "function liquidity() view returns (uint256)",
];

const KANIT_TIPI = "tuple(uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, tuple(bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots)";

const LEDGER_ABI = [
  "event PaymentAuthorized(bytes32 indexed claimId, address indexed user, uint64 indexed hedefZincir, address alici, uint256 tutar, uint256 komisyon, uint64 kaynakZincir)",
  `function submitLockProof(${KANIT_TIPI} k) external`,
  `function submitPaymentProof(${KANIT_TIPI} k) external`,
  `function submitDeductionProof(${KANIT_TIPI} k) external`,
  "function talepler(bytes32 claimId) view returns (address user, uint64 kaynakZincir, uint64 hedefZincir, address alici, uint256 tutar, uint256 toplam, bool odendi, bool kapandi)",
  "function collateral(address user, uint64 chainKey) view returns (uint256)",
  "function available(address user) view returns (uint256)",
];

const DURUM_YOLU = path.join(__dirname, "durum.json");
const CHAIN_KEY = Number(process.env.CHAIN_KEY ?? "1");
const TARAMA_ARALIGI = 15_000; // olay tarama periyodu (ms)

function zorunlu(ad: string): string {
  const deger = process.env[ad];
  if (!deger) throw new Error(`Ortam degiskeni eksik: ${ad}`);
  return deger;
}

function zaman(): string {
  return new Date().toISOString().slice(11, 19);
}
function bilgi(mesaj: string) {
  console.log(`[${zaman()}] ${mesaj}`);
}
function hataYaz(mesaj: string, hata: unknown) {
  const ozet = hata instanceof Error ? hata.message.slice(0, 300) : String(hata).slice(0, 300);
  console.error(`[${zaman()}] HATA ${mesaj}: ${ozet}`);
}

interface Durum {
  sepoliaSonBlok: number;
  creditcoinSonBlok: number;
}

function durumOku(): Durum {
  try {
    return JSON.parse(fs.readFileSync(DURUM_YOLU, "utf8"));
  } catch {
    return { sepoliaSonBlok: 0, creditcoinSonBlok: 0 };
  }
}
function durumYaz(durum: Durum) {
  fs.writeFileSync(DURUM_YOLU, JSON.stringify(durum));
}

async function bekle(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Ussel bekleme ile en cok 5 deneme. */
async function dene<T>(ad: string, is_: () => Promise<T>): Promise<T> {
  let sonHata: unknown;
  for (let deneme = 1; deneme <= 5; deneme++) {
    try {
      return await is_();
    } catch (hata) {
      sonHata = hata;
      hataYaz(`${ad} (deneme ${deneme}/5)`, hata);
      await bekle(Math.min(60_000, 2_000 * 2 ** deneme));
    }
  }
  throw sonHata;
}

/** Tek sirali is kuyrugu: ayni cuzdanla nonce cakismasini onler. */
class Kuyruk {
  private zincir: Promise<void> = Promise.resolve();

  ekle(ad: string, is_: () => Promise<void>) {
    this.zincir = this.zincir
      .then(() => is_())
      .catch((hata) => hataYaz(`kuyruk isi '${ad}' vazgecildi`, hata));
  }
}

async function main() {
  const sepoliaProvider = new JsonRpcProvider(zorunlu("SEPOLIA_RPC_URL"));
  const ccProvider = new JsonRpcProvider(zorunlu("CREDITCOIN_RPC_URL"));
  const proofBuilderUrl = zorunlu("PROOF_BUILDER_URL");

  const sepoliaCuzdan = new Wallet(zorunlu("PRIVATE_KEY"), sepoliaProvider);
  const ccCuzdan = new Wallet(zorunlu("PRIVATE_KEY"), ccProvider);

  const escrow = new Contract(zorunlu("ESCROW_ADDRESS"), ESCROW_ABI, sepoliaCuzdan);
  const spender = new Contract(zorunlu("SPENDER_ADDRESS"), SPENDER_ABI, sepoliaCuzdan);
  const ledger = new Contract(zorunlu("LEDGER_ADDRESS"), LEDGER_ABI, ccCuzdan);
  const escrowAdres = await escrow.getAddress();
  const ledgerAdres = await ledger.getAddress();

  const kuyruk = new Kuyruk();
  const durum = durumOku();

  bilgi("Karun worker basladi");
  bilgi(`  Escrow (Sepolia):    ${escrowAdres}`);
  bilgi(`  Spender (Sepolia):   ${await spender.getAddress()}`);
  bilgi(`  Ledger (Creditcoin): ${ledgerAdres}`);
  bilgi(`  Operator/imzaci:     ${sepoliaCuzdan.address}`);

  // ── kanit uretimi ──
  async function kanitUret(txHash: string): Promise<proofProvider.ContinuityResponse> {
    const tx = await sepoliaProvider.getTransaction(txHash);
    if (!tx || !tx.blockNumber) throw new Error(`Islem bulunamadi/kazilmadi: ${txHash}`);

    const proofBuilder = new proofProvider.service.ProofBuilder(CHAIN_KEY, proofBuilderUrl);
    const bilgiSaglayici = new chainInfo.PrecompileChainInfoProvider(ccProvider);
    const son = await bilgiSaglayici.getLatestAttestedHeightAndHash(CHAIN_KEY);
    bilgi(`  Blok ${tx.blockNumber} icin attestation bekleniyor (son attest: ${son.height})...`);

    await proofBuilder.waitUntilHeightAttested(CHAIN_KEY, tx.blockNumber, 15_000, 1_800_000);
    bilgi(`  Blok ${tx.blockNumber} attest edildi, kanit uretiliyor...`);

    const kanit = await proofBuilder.getProof(txHash);
    if (!kanit.success || !kanit.data) throw new Error(`Kanit uretilemedi: ${kanit.error}`);
    return kanit.data;
  }

  function kanitPaketi(p: proofProvider.ContinuityResponse) {
    return {
      chainKey: p.chainKey,
      blockHeight: p.headerNumber,
      encodedTransaction: p.txBytes,
      merkleRoot: p.merkleProof.root,
      siblings: p.merkleProof.siblings,
      lowerEndpointDigest: p.continuityProof.lowerEndpointDigest,
      continuityRoots: p.continuityProof.roots,
    };
  }

  // ── is tanimlari ──
  async function kilitIsle(user: string, totalLocked: bigint, txHash: string) {
    // zincir ustu senkron zaten bu duzeydeyse atla (mukerrer/yeniden baslatma)
    const mevcut: bigint = await ledger.collateral(user, CHAIN_KEY);
    if (mevcut >= totalLocked) {
      bilgi(`[KILIT] ${user} zaten senkron (${mevcut}), atlandi`);
      return;
    }
    await dene("kilit kaniti", async () => {
      const kanit = await kanitUret(txHash);
      const gonderim = await ledger.submitLockProof(kanitPaketi(kanit), { gasLimit: 5_000_000n });
      bilgi(`[KILIT] Kanit gonderildi: ${gonderim.hash}`);
      await gonderim.wait();
      bilgi(`[KILIT] ${user} yeni limiti: ${await ledger.available(user)}`);
    });
  }

  async function odemeVeKesintiIsle(claimId: string, user: string, alici: string, tutar: bigint, toplam: bigint) {
    const talep = await ledger.talepler(claimId);
    if (talep.kapandi) {
      bilgi(`[TALEP] ${claimId.slice(0, 10)}… zaten kapali, atlandi`);
      return;
    }

    // 0. hedef zincirde odeme (Spender havuzundan aliciya)
    if (!talep.odendi) {
      const islenmisOdeme: boolean = await spender.processedPayouts(claimId);
      let odemeTxHash: string;
      if (islenmisOdeme) {
        const filtre = spender.filters.Paid(claimId);
        const olaylar = await spender.queryFilter(filtre, -400_000);
        if (olaylar.length === 0) throw new Error("islenmis odemenin Paid olayi bulunamadi");
        odemeTxHash = olaylar[olaylar.length - 1].transactionHash;
      } else {
        odemeTxHash = await dene("hedef zincir odemesi", async () => {
          const odeme = await spender.payout(claimId, alici, tutar);
          bilgi(`[ODEME] Aliciya gonderildi: ${odeme.hash}`);
          const makbuz = await odeme.wait();
          if (!makbuz || makbuz.status !== 1) throw new Error("odeme islemi basarisiz");
          return odeme.hash;
        });
      }
      await dene("odeme kaniti", async () => {
        const kanit = await kanitUret(odemeTxHash);
        const gonderim = await ledger.submitPaymentProof(kanitPaketi(kanit), { gasLimit: 5_000_000n });
        bilgi(`[ODEME] Kanit gonderildi: ${gonderim.hash}`);
        await gonderim.wait();
      });
    }

    const amount = toplam;

    // 1. escrow'da kesinti (islenmisse atla)
    const islendi: boolean = await escrow.processedClaims(claimId);
    let kesintiTxHash: string;
    if (islendi) {
      bilgi(`[KESINTI] Escrow kesintisi zaten yapilmis, olay araniyor...`);
      const filtre = escrow.filters.Deducted(user, null, claimId);
      const olaylar = await escrow.queryFilter(filtre, -400_000);
      if (olaylar.length === 0) throw new Error("islenmis talebin Deducted olayi bulunamadi");
      kesintiTxHash = olaylar[olaylar.length - 1].transactionHash;
    } else {
      kesintiTxHash = await dene("escrow kesintisi", async () => {
        const kesinti = await escrow.deduct(user, amount, claimId);
        bilgi(`[KESINTI] Escrow kesintisi gonderildi: ${kesinti.hash}`);
        const makbuz = await kesinti.wait();
        if (!makbuz || makbuz.status !== 1) throw new Error("kesinti islemi basarisiz");
        return kesinti.hash;
      });
    }

    // 2. kesinti kanitini ledger'a isle
    await dene("kesinti kaniti", async () => {
      const kanit = await kanitUret(kesintiTxHash);
      const gonderim = await ledger.submitDeductionProof(kanitPaketi(kanit), { gasLimit: 5_000_000n });
      bilgi(`[KESINTI] Talep kapatildi: ${gonderim.hash}`);
      await gonderim.wait();
    });
  }

  // ── olay tarayicilar (yoklama; yeniden baslatmada gecmisi kapar) ──
  async function sepoliaTara() {
    const guncel = await sepoliaProvider.getBlockNumber();
    if (durum.sepoliaSonBlok === 0) durum.sepoliaSonBlok = guncel - 5_000; // ilk calisma: son ~1 gun
    const bastan = durum.sepoliaSonBlok + 1;
    if (bastan > guncel) return;
    const olaylar = await escrow.queryFilter(escrow.filters.Locked(), bastan, guncel);
    for (const olay of olaylar) {
      const [user, amount, totalLocked] = (olay as any).args;
      bilgi(`[KILIT] Olay: ${user} +${amount} (toplam ${totalLocked}) tx=${olay.transactionHash}`);
      kuyruk.ekle("kilit " + olay.transactionHash, () => kilitIsle(user, totalLocked, olay.transactionHash));
    }
    durum.sepoliaSonBlok = guncel;
    durumYaz(durum);
  }

  async function creditcoinTara() {
    const guncel = await ccProvider.getBlockNumber();
    if (durum.creditcoinSonBlok === 0) durum.creditcoinSonBlok = guncel - 5_000;
    const bastan = durum.creditcoinSonBlok + 1;
    if (bastan > guncel) return;
    const olaylar = await ledger.queryFilter(ledger.filters.PaymentAuthorized(), bastan, guncel);
    for (const olay of olaylar) {
      const [claimId, user, hedefZincir, alici, tutar, komisyon] = (olay as any).args;
      bilgi(`[TALEP] ${claimId.slice(0, 10)}… ${user} -> ${alici} ${tutar} (zincir ${hedefZincir})`);
      kuyruk.ekle("talep " + claimId, () => odemeVeKesintiIsle(claimId, user, alici, tutar, tutar + komisyon));
    }
    durum.creditcoinSonBlok = guncel;
    durumYaz(durum);
  }

  // surekli dongu
  for (;;) {
    try {
      await sepoliaTara();
    } catch (hata) {
      hataYaz("Sepolia taramasi", hata);
    }
    try {
      await creditcoinTara();
    } catch (hata) {
      hataYaz("Creditcoin taramasi", hata);
    }
    await bekle(TARAMA_ARALIGI);
  }
}

main().catch((hata) => {
  console.error(hata);
  process.exit(1);
});

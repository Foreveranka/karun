/**
 * Karun Offchain Worker
 *
 * Iki isi vardir:
 *  1. KILIT AKISI: Sepolia'daki KarunEscrow'un Locked olaylarini izler, blok
 *     Creditcoin'de attest edilince Proof Builder'dan kanit alir ve
 *     KarunLedger.submitLockProof ile kullanicinin limitini acar.
 *  2. KESINTI AKISI: Creditcoin'deki KarunLedger'in DeductionQueued olaylarini
 *     izler, Sepolia escrow'unda deduct() calistirir (operator; Attestcoin
 *     Writability testnete cikinca bu adim trustless mesaja donusecek),
 *     ardindan kesinti islemini kanitlayip submitDeductionProof ile talebi kapatir.
 *
 * Calistirma: npm run worker
 */
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import { proofProvider, chainInfo } from "@gluwa/usc-sdk";
import * as dotenv from "dotenv";

dotenv.config();

const ESCROW_ABI = [
  "event Locked(address indexed user, uint256 amount, uint256 totalLocked)",
  "event Deducted(address indexed user, uint256 amount, bytes32 indexed claimId, uint256 remainingLocked)",
  "function deduct(address user, uint256 amount, bytes32 claimId) external",
  "function locked(address user) view returns (uint256)",
];

const LEDGER_ABI = [
  "event DeductionQueued(bytes32 indexed claimId, address indexed user, uint64 indexed chainKey, uint256 amount)",
  "event CollateralSynced(address indexed user, uint64 indexed chainKey, uint256 totalLocked, bytes32 queryId)",
  "event ClaimSettled(bytes32 indexed claimId, address indexed user, uint256 amount, bytes32 queryId)",
  "function submitLockProof(uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, tuple(bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots) external",
  "function submitDeductionProof(uint64 chainKey, uint64 blockHeight, bytes encodedTransaction, bytes32 merkleRoot, tuple(bytes32 hash, bool isLeft)[] siblings, bytes32 lowerEndpointDigest, bytes32[] continuityRoots) external",
  "function claims(bytes32 claimId) view returns (address user, uint64 chainKey, uint256 amount, bool settled)",
  "function collateral(address user, uint64 chainKey) view returns (uint256)",
  "function available(address user) view returns (uint256)",
];

function zorunlu(ad: string): string {
  const deger = process.env[ad];
  if (!deger) throw new Error(`Ortam degiskeni eksik: ${ad}`);
  return deger;
}

const CHAIN_KEY = Number(process.env.CHAIN_KEY ?? "1"); // Sepolia = 1

async function kanitUretVeBekle(
  txHash: string,
  proofBuilderUrl: string,
  ccProvider: JsonRpcProvider,
  kaynakProvider: JsonRpcProvider
): Promise<proofProvider.ContinuityResponse> {
  const tx = await kaynakProvider.getTransaction(txHash);
  if (!tx || !tx.blockNumber) throw new Error(`Islem bulunamadi/kazilmadi: ${txHash}`);

  const proofBuilder = new proofProvider.service.ProofBuilder(CHAIN_KEY, proofBuilderUrl);
  const bilgi = new chainInfo.PrecompileChainInfoProvider(ccProvider);
  const sonAttest = await bilgi.getLatestAttestedHeightAndHash(CHAIN_KEY);
  console.log(`   Blok ${tx.blockNumber} icin attestation bekleniyor (son: ${sonAttest.height})...`);

  // attestation araligi ~8 dk; 20 dk'ya kadar sabirli ol
  await proofBuilder.waitUntilHeightAttested(CHAIN_KEY, tx.blockNumber, 15_000, 1_200_000);
  console.log(`   Blok ${tx.blockNumber} attest edildi, kanit uretiliyor...`);

  const kanit = await proofBuilder.getProof(txHash);
  if (!kanit.success || !kanit.data) throw new Error(`Kanit uretilemedi: ${kanit.error}`);
  return kanit.data;
}

function kanitParametreleri(p: proofProvider.ContinuityResponse) {
  return [
    p.chainKey,
    p.headerNumber,
    p.txBytes,
    p.merkleProof.root,
    p.merkleProof.siblings,
    p.continuityProof.lowerEndpointDigest,
    p.continuityProof.roots,
  ] as const;
}

async function main() {
  const sepoliaProvider = new JsonRpcProvider(zorunlu("SEPOLIA_RPC_URL"));
  const ccProvider = new JsonRpcProvider(zorunlu("CREDITCOIN_RPC_URL"));
  const proofBuilderUrl = zorunlu("PROOF_BUILDER_URL");

  const sepoliaCuzdan = new Wallet(zorunlu("PRIVATE_KEY"), sepoliaProvider);
  const ccCuzdan = new Wallet(zorunlu("PRIVATE_KEY"), ccProvider);

  const escrow = new Contract(zorunlu("ESCROW_ADDRESS"), ESCROW_ABI, sepoliaCuzdan);
  const ledger = new Contract(zorunlu("LEDGER_ADDRESS"), LEDGER_ABI, ccCuzdan);

  console.log("Karun worker basladi");
  console.log(`  Escrow (Sepolia):    ${await escrow.getAddress()}`);
  console.log(`  Ledger (Creditcoin): ${await ledger.getAddress()}`);

  // ── 1. kilit akisi ──
  escrow.on(escrow.getEvent("Locked"), async (user, amount, totalLocked, olay) => {
    const txHash = olay.log.transactionHash;
    console.log(`\n[KILIT] ${user} ${amount} kilitledi (toplam ${totalLocked}) tx=${txHash}`);
    try {
      const kanit = await kanitUretVeBekle(txHash, proofBuilderUrl, ccProvider, sepoliaProvider);
      const gonderim = await ledger.submitLockProof(...kanitParametreleri(kanit), { gasLimit: 5_000_000n });
      console.log(`[KILIT] Ledger'a islendi: ${gonderim.hash}`);
      await gonderim.wait();
      console.log(`[KILIT] Yeni limit: ${await ledger.available(user)}`);
    } catch (hata) {
      console.error(`[KILIT] HATA:`, hata);
    }
  });

  // ── 2. kesinti akisi ──
  ledger.on(ledger.getEvent("DeductionQueued"), async (claimId, user, chainKey, amount) => {
    console.log(`\n[KESINTI] Talep ${claimId}: ${user} -> ${amount} (zincir ${chainKey})`);
    try {
      // 2a. escrow'da kesintiyi calistir (operator rolu)
      const kesinti = await escrow.deduct(user, amount, claimId);
      console.log(`[KESINTI] Escrow kesintisi gonderildi: ${kesinti.hash}`);
      await kesinti.wait();

      // 2b. kesintiyi Attestcoin ile kanitla ve talebi kapat
      const kanit = await kanitUretVeBekle(kesinti.hash, proofBuilderUrl, ccProvider, sepoliaProvider);
      const gonderim = await ledger.submitDeductionProof(...kanitParametreleri(kanit), { gasLimit: 5_000_000n });
      console.log(`[KESINTI] Talep kapatildi: ${gonderim.hash}`);
      await gonderim.wait();
    } catch (hata) {
      console.error(`[KESINTI] HATA:`, hata);
    }
  });

  // olay dinleyicileri calisir durumda tut
  await new Promise(() => {});
}

main().catch((hata) => {
  console.error(hata);
  process.exit(1);
});

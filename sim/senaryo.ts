/**
 * Karun UCTAN UCA YEREL SIMULASYON (coklu zincir mimarisi)
 *
 * Uc yerel zincir:
 *   A (8545) "Sepolia"    : mUSDC + KarunEscrow (teminat) + KarunSpender (odeme)
 *   B (8547) "Base"       : mUSDC + KarunSpender (yalnizca odeme; kullanicinin orada HIC parasi yok)
 *   C (8546) "Creditcoin" : SimVerifier + KarunLedger (HAKEM: token tutmaz, odeme yapmaz)
 *
 * Gercek makbuz loglari Attestcoin kodlamasina cevrilip ledger'a kanit olarak sunulur.
 * Calistirma: sim/calistir.sh
 */
import { AbiCoder, Contract, ContractFactory, JsonRpcProvider, Wallet, parseUnits } from "ethers";
import * as fs from "fs";

const abiCoder = AbiCoder.defaultAbiCoder();

/** anvil "pending" nonce'a 0 donduruyor; "latest" kullan (akis tamamen sirali). */
class YerelCuzdan extends Wallet {
  override async getNonce(): Promise<number> {
    return this.provider!.getTransactionCount(this.address, "latest");
  }
}

const OPERATOR_ADRES = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ANVIL_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KULLANICI_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const ALICI = "0x000000000000000000000000000000000000bEEF";
const SIFIR = "0x0000000000000000000000000000000000000000";

const secenek = { polling: true, pollingInterval: 200, cacheTimeout: -1 };
const A = new JsonRpcProvider("http://127.0.0.1:8545", undefined, secenek);  // teminat zinciri
const B = new JsonRpcProvider("http://127.0.0.1:8547", undefined, secenek);  // hedef zincir
const CC = new JsonRpcProvider("http://127.0.0.1:8546", undefined, secenek); // Creditcoin

const opA = new YerelCuzdan(ANVIL_PK, A);
const opB = new YerelCuzdan(ANVIL_PK, B);
const opCC = new YerelCuzdan(ANVIL_PK, CC);
const kullaniciA = new YerelCuzdan(KULLANICI_PK, A);
const kullaniciCC = new YerelCuzdan(KULLANICI_PK, CC);
const kullaniciAdres = new Wallet(KULLANICI_PK).address;

const ZINCIR_A = 1n;
const ZINCIR_B = 2n;

function art(yol: string) {
  const j = JSON.parse(fs.readFileSync(yol, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

let gecti = 0, kaldi = 0;
function dogrula(ad: string, kosul: boolean, detay = "") {
  if (kosul) { gecti++; console.log(`  ✔ ${ad}`); }
  else { kaldi++; console.log(`  ✘ ${ad} ${detay}`); }
}
async function reverteBekle(ad: string, is_: () => Promise<unknown>, beklenen: string) {
  try {
    await is_();
    dogrula(ad, false, "(revert beklenirdi)");
  } catch (hata: any) {
    const mesaj = String(hata.shortMessage ?? hata.message ?? hata);
    dogrula(ad, mesaj.includes(beklenen) || String(hata).includes(beklenen), `(gelen: ${mesaj.slice(0, 70)})`);
  }
}

/** Gercek makbuz loglarini Attestcoin kodlanmis islem bicimine cevirir. */
function makbuzdanKodla(status: number, logs: { address: string; topics: readonly string[]; data: string }[]): string {
  const logTuple = logs.map((l) => [l.address, [...l.topics], l.data]);
  const chunk0 = abiCoder.encode(
    ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
    [0, 21000, SIFIR, false, SIFIR, 0, "0x"]
  );
  const chunk2 = abiCoder.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [status, 50000, logTuple, "0x"]
  );
  return abiCoder.encode(["uint8", "bytes[]"], [2, [chunk0, "0x", chunk2]]);
}

let sorgu = 0;

async function main() {
  console.log("\n═══ KARUN SIMULASYON · coklu zincir ═══\n");

  const usdcArt = art("out/MockUSDC.sol/MockUSDC.json");
  const escrowArt = art("out/KarunEscrow.sol/KarunEscrow.json");
  const spenderArt = art("out/KarunSpender.sol/KarunSpender.json");
  const ledgerArt = art("out/KarunLedger.sol/KarunLedger.json");
  const verifierArt = art("out/SimVerifier.sol/SimVerifier.json");

  // A zinciri: teminat + odeme
  const usdcA = await (await new ContractFactory(usdcArt.abi, usdcArt.bytecode, opA).deploy()).waitForDeployment();
  const escrowA = await (await new ContractFactory(escrowArt.abi, escrowArt.bytecode, opA)
    .deploy(await usdcA.getAddress(), OPERATOR_ADRES, OPERATOR_ADRES, 120)).waitForDeployment();
  const spenderA = await (await new ContractFactory(spenderArt.abi, spenderArt.bytecode, opA)
    .deploy(await usdcA.getAddress(), OPERATOR_ADRES)).waitForDeployment();

  // B zinciri: yalnizca odeme
  const usdcB = await (await new ContractFactory(usdcArt.abi, usdcArt.bytecode, opB).deploy()).waitForDeployment();
  const spenderB = await (await new ContractFactory(spenderArt.abi, spenderArt.bytecode, opB)
    .deploy(await usdcB.getAddress(), OPERATOR_ADRES)).waitForDeployment();

  // Creditcoin: hakem
  const verifier = await (await new ContractFactory(verifierArt.abi, verifierArt.bytecode, opCC).deploy()).waitForDeployment();
  const ledger = await (await new ContractFactory(ledgerArt.abi, ledgerArt.bytecode, opCC)
    .deploy(30, await verifier.getAddress())).waitForDeployment();

  await (await (ledger as any).zincirTanimla(ZINCIR_A, await escrowA.getAddress(), await spenderA.getAddress(), 8000, true, true)).wait();
  await (await (ledger as any).zincirTanimla(ZINCIR_B, SIFIR, await spenderB.getAddress(), 8000, false, true)).wait();

  for (const [usdc, spender] of [[usdcA, spenderA], [usdcB, spenderB]] as const) {
    await (await (usdc as any).mint(OPERATOR_ADRES, parseUnits("50000", 6))).wait();
    await (await (usdc as any).approve(await spender.getAddress(), parseUnits("50000", 6))).wait();
    await (await (spender as any).fund(parseUnits("50000", 6))).wait();
  }
  await (await (usdcA as any).mint(kullaniciAdres, parseUnits("10000", 6))).wait();

  console.log("Dagitim tamam.");
  console.log(`  A zinciri  escrow ${await escrowA.getAddress()}  spender ${await spenderA.getAddress()}`);
  console.log(`  B zinciri  spender ${await spenderB.getAddress()}`);
  console.log(`  Creditcoin ledger (hakem) ${await ledger.getAddress()}\n`);

  const escrowK = escrowA.connect(kullaniciA) as Contract;
  const usdcAK = usdcA.connect(kullaniciA) as Contract;
  const ledgerK = ledger.connect(kullaniciCC) as Contract;

  function kanitPaketi(chainKey: bigint, blok: number, kodlu: string) {
    return {
      chainKey, blockHeight: blok, encodedTransaction: kodlu,
      merkleRoot: "0x" + "00".repeat(32), siblings: [],
      lowerEndpointDigest: "0x" + "00".repeat(32), continuityRoots: [],
    };
  }
  async function kanitla(saglayici: JsonRpcProvider, chainKey: bigint, txHash: string, fn: string) {
    const makbuz = await saglayici.getTransactionReceipt(txHash);
    if (!makbuz) throw new Error("makbuz yok");
    const kodlu = makbuzdanKodla(makbuz.status ?? 0, makbuz.logs as any);
    await (await (verifier as any).ayarla(true, ++sorgu)).wait();
    await (await (ledger as any)[fn](kanitPaketi(chainKey, makbuz.blockNumber, kodlu))).wait();
  }

  // 1) kilit → limit
  console.log("1) Teminat kilidi (A zinciri) ve limit acilisi");
  await (await usdcAK.approve(await escrowA.getAddress(), parseUnits("10000", 6))).wait();
  const kilitTx = await escrowK.lock(parseUnits("5000", 6));
  await kilitTx.wait();
  await kanitla(A, ZINCIR_A, kilitTx.hash, "submitLockProof");
  dogrula("teminat 5000 senkron", (await (ledger as any).collateral(kullaniciAdres, ZINCIR_A)) === parseUnits("5000", 6));
  dogrula("limit %80 = 4000", (await (ledger as any).available(kullaniciAdres)) === parseUnits("4000", 6));

  // 2) B zincirinde odeme talebi
  console.log("2) B zincirinde odeme talebi (kullanicinin orada parasi YOK)");
  dogrula("kullanicinin B zincirinde parasi yok", (await (usdcB as any).balanceOf(kullaniciAdres)) === 0n);
  const talepTx = await ledgerK.requestPayment(ALICI, parseUnits("1000", 6), ZINCIR_B, ZINCIR_A);
  const talepMakbuz = await talepTx.wait();
  const yetki = await (ledger as any).queryFilter(
    (ledger as any).filters.PaymentAuthorized(), talepMakbuz!.blockNumber, talepMakbuz!.blockNumber);
  dogrula("odeme talimati cikti", yetki.length === 1);
  const claimId = yetki[0].args[0];
  dogrula("borc 1003 (komisyon %0,30)", (await (ledger as any).outstanding(kullaniciAdres)) === parseUnits("1003", 6));

  // 3) B zincirindeki havuz oder
  console.log("3) B zincirindeki havuz aliciya oder");
  const odemeTx = await (spenderB as any).payout(claimId, ALICI, parseUnits("1000", 6));
  await odemeTx.wait();
  dogrula("alici B zincirinde 1000 aldi", (await (usdcB as any).balanceOf(ALICI)) === parseUnits("1000", 6));

  // 4) odeme kaniti
  console.log("4) Odeme Attestcoin ile kanitlanir");
  await kanitla(B, ZINCIR_B, odemeTx.hash, "submitPaymentProof");
  dogrula("odeme kanitlandi", (await (ledger as any).talepler(claimId)).odendi === true);

  // 5) kesinti + kanit
  console.log("5) A zincirindeki escrow'dan otomatik kesinti ve kaniti");
  const kesintiTx = await (escrowA as any).deduct(kullaniciAdres, parseUnits("1003", 6), claimId);
  await kesintiTx.wait();
  dogrula("A zincirinde kilit 3997'ye dustu", (await (escrowA as any).locked(kullaniciAdres)) === parseUnits("3997", 6));
  await kanitla(A, ZINCIR_A, kesintiTx.hash, "submitDeductionProof");
  dogrula("borc sifirlandi", (await (ledger as any).outstanding(kullaniciAdres)) === 0n);
  dogrula("talep kapandi", (await (ledger as any).talepler(claimId)).kapandi === true);
  dogrula("yeni limit kalan teminatin %80'i",
    (await (ledger as any).available(kullaniciAdres)) === (parseUnits("3997", 6) * 8000n) / 10000n);

  // 6) ayni zincirde odeme
  console.log("6) Ayni zincirde odeme (A'da kilitle, A'da ode)");
  const t3 = await ledgerK.requestPayment(ALICI, parseUnits("500", 6), ZINCIR_A, ZINCIR_A);
  const m3 = await t3.wait();
  const o3 = await (ledger as any).queryFilter((ledger as any).filters.PaymentAuthorized(), m3!.blockNumber, m3!.blockNumber);
  const claim3 = o3[0].args[0];
  const odeme3 = await (spenderA as any).payout(claim3, ALICI, parseUnits("500", 6));
  await odeme3.wait();
  dogrula("alici A zincirinde 500 aldi", (await (usdcA as any).balanceOf(ALICI)) === parseUnits("500", 6));
  await kanitla(A, ZINCIR_A, odeme3.hash, "submitPaymentProof");
  dogrula("ayni zincir odemesi kanitlandi", (await (ledger as any).talepler(claim3)).odendi === true);

  // 7) hata yollari
  console.log("7) Hata yollari");
  await reverteBekle("limit asilamaz", () => ledgerK.requestPayment(ALICI, parseUnits("9999", 6), ZINCIR_B, ZINCIR_A), "limit yetersiz");
  await reverteBekle("tanimsiz zincire odeme yok", () => ledgerK.requestPayment(ALICI, parseUnits("10", 6), 99n, ZINCIR_A), "odeme zinciri kapali");
  await reverteBekle("teminatsiz zincirden kesinti yok", () => ledgerK.requestPayment(ALICI, parseUnits("10", 6), ZINCIR_B, ZINCIR_B), "teminat zinciri kapali");
  await reverteBekle("operator disinda odeme yapilamaz",
    () => (spenderB.connect(new YerelCuzdan(KULLANICI_PK, B)) as any).payout("0x" + "22".repeat(32), ALICI, 1n), "operator degil");
  await reverteBekle("ayni odeme iki kez yapilamaz",
    () => (spenderB as any).payout(claimId, ALICI, parseUnits("1000", 6)), "odeme islendi");

  // 8) cekim gecikmesi
  console.log("8) Cekim gecikmesi");
  await (await escrowK.requestUnlock(parseUnits("1000", 6))).wait();
  await reverteBekle("gecikme dolmadan cekilemez", () => escrowK.withdraw(), "bekleme suresi");
  await A.send("evm_increaseTime", [130]);
  await A.send("evm_mine", []);
  await (await escrowK.withdraw()).wait();
  dogrula("gecikme sonrasi cekim basarili", (await (escrowA as any).locked(kullaniciAdres)) === parseUnits("2997", 6));

  console.log(`\n═══ SONUC: ${gecti} dogrulama gecti, ${kaldi} kaldi ═══`);
  if (kaldi > 0) process.exit(1);
  console.log("Simulasyon TEMIZ: coklu zincir odeme dongusu calisiyor.\n");
  process.exit(0);
}

main().catch((hata) => {
  console.error("SIMULASYON HATASI:", hata);
  process.exit(1);
});

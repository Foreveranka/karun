/**
 * Karun UCTAN UCA YEREL SIMULASYON
 *
 * Iki yerel zincir (anvil) uzerinde tam donguyu ve hata yollarini calistirir:
 *   A (8545, "Sepolia")    : mUSDC + KarunEscrow
 *   B (8546, "Creditcoin") : mUSDC + SimVerifier + KarunLedger
 *
 * Simulasyon worker'i, GERCEK islem makbuzundaki loglari Attestcoin'in
 * kodlanmis islem bicimine cevirip ledger'a kanit olarak sunar; boylece
 * cozumleme (decode) yolu gercek olay verisiyle test edilir. Gercek agda
 * ayni parametreleri Proof Builder + precompile saglar.
 *
 * Calistirma: sim/calistir.sh
 */
import { AbiCoder, Contract, ContractFactory, JsonRpcProvider, Wallet, parseUnits } from "ethers";

/** anvil 1.3.x "pending" nonce etiketine 0 donduruyor; "latest" kullan.
 *  Akis tamamen sirali oldugu icin (her tx await .wait()) bu guvenli. */
class YerelCuzdan extends Wallet {
  override async getNonce(): Promise<number> {
    return this.provider!.getTransactionCount(this.address, "latest");
  }
}
import * as fs from "fs";

const abiCoder = AbiCoder.defaultAbiCoder();

// anvil'in 0. standart hesabi (yalnizca yerel simulasyon)
const OPERATOR_ADRES = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ANVIL_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const KULLANICI_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d"; // hesap 1
const ALICI = "0x000000000000000000000000000000000000BEEF";

const A = new JsonRpcProvider("http://127.0.0.1:8545", undefined, { polling: true, pollingInterval: 200, cacheTimeout: -1 });
const B = new JsonRpcProvider("http://127.0.0.1:8546", undefined, { polling: true, pollingInterval: 200, cacheTimeout: -1 });

const opA = new YerelCuzdan(ANVIL_PK, A); // dagitici + operator (Sepolia)
const opB = new YerelCuzdan(ANVIL_PK, B); // dagitici + worker (Creditcoin)
const kullaniciA = new YerelCuzdan(KULLANICI_PK, A);
const kullaniciAAdres = new Wallet(KULLANICI_PK).address;
const kullaniciB = new YerelCuzdan(KULLANICI_PK, B);

const SEPOLIA_KEY = 1n;

function art(yol: string) {
  const j = JSON.parse(fs.readFileSync(yol, "utf8"));
  return { abi: j.abi, bytecode: j.bytecode.object };
}

let gecti = 0;
let kaldi = 0;
function dogrula(ad: string, kosul: boolean, detay = "") {
  if (kosul) {
    gecti++;
    console.log(`  ✔ ${ad}`);
  } else {
    kaldi++;
    console.log(`  ✘ ${ad} ${detay}`);
  }
}
async function reverteBekle(ad: string, is_: () => Promise<unknown>, beklenen: string) {
  try {
    await is_();
    dogrula(ad, false, "(revert beklenirdi)");
  } catch (hata: any) {
    const mesaj = String(hata.shortMessage ?? hata.message ?? hata);
    dogrula(ad, mesaj.includes(beklenen) || String(hata).includes(beklenen), `(gelen: ${mesaj.slice(0, 80)})`);
  }
}

/** Gercek makbuz loglarini Attestcoin kodlanmis islem bicimine cevirir. */
function makbuzdanKodla(status: number, logs: { address: string; topics: readonly string[]; data: string }[]): string {
  const logTuple = logs.map((l) => [l.address, [...l.topics], l.data]);
  const chunk0 = abiCoder.encode(
    ["uint64", "uint64", "address", "bool", "address", "uint256", "bytes"],
    [0, 21000, "0x0000000000000000000000000000000000000000", false, "0x0000000000000000000000000000000000000000", 0, "0x"]
  );
  const chunk2 = abiCoder.encode(
    ["uint8", "uint64", "tuple(address,bytes32[],bytes)[]", "bytes"],
    [status, 50000, logTuple, "0x"]
  );
  return abiCoder.encode(["uint8", "bytes[]"], [2, [chunk0, "0x", chunk2]]);
}

let sorgusayaci = 0;

async function main() {
  console.log("\n═══ KARUN YEREL SIMULASYON ═══\n");

  // ── dagitim ──
  const usdcArt = art("out/MockUSDC.sol/MockUSDC.json");
  const escrowArt = art("out/KarunEscrow.sol/KarunEscrow.json");
  const ledgerArt = art("out/KarunLedger.sol/KarunLedger.json");
  const verifierArt = art("out/SimVerifier.sol/SimVerifier.json");

  const usdcA = await (await new ContractFactory(usdcArt.abi, usdcArt.bytecode, opA).deploy()).waitForDeployment();
  const escrow = await (
    await new ContractFactory(escrowArt.abi, escrowArt.bytecode, opA).deploy(
      await usdcA.getAddress(), OPERATOR_ADRES, OPERATOR_ADRES, 120 // hazine=operator, 2 dk cekim gecikmesi
    )
  ).waitForDeployment();

  const usdcB = await (await new ContractFactory(usdcArt.abi, usdcArt.bytecode, opB).deploy()).waitForDeployment();
  const verifier = await (await new ContractFactory(verifierArt.abi, verifierArt.bytecode, opB).deploy()).waitForDeployment();
  const ledger = await (
    await new ContractFactory(ledgerArt.abi, ledgerArt.bytecode, opB).deploy(
      await usdcB.getAddress(), 30, await verifier.getAddress()
    )
  ).waitForDeployment();

  const escrowAdres = await escrow.getAddress();
  await (await (ledger as any).registerEscrow(SEPOLIA_KEY, escrowAdres, 8000)).wait();

  // havuz: 50.000
  await (await (usdcB as any).mint(OPERATOR_ADRES, parseUnits("50000", 6))).wait();
  await (await (usdcB as any).approve(await ledger.getAddress(), parseUnits("50000", 6))).wait();
  await (await (ledger as any).fundPool(parseUnits("50000", 6))).wait();

  // kullaniciya kaynak zincirde para
  await (await (usdcA as any).mint(kullaniciAAdres, parseUnits("10000", 6))).wait();

  console.log("Dagitim tamam.");
  console.log(`  Escrow: ${escrowAdres}`);
  console.log(`  Ledger: ${await ledger.getAddress()}\n`);

  const escrowK = escrow.connect(kullaniciA) as Contract;
  const usdcAK = usdcA.connect(kullaniciA) as Contract;
  const ledgerK = ledger.connect(kullaniciB) as Contract;

  // ── sim worker yardimcilari ──
  async function kanitla(txHash: string, fn: "submitLockProof" | "submitDeductionProof") {
    const makbuz = await A.getTransactionReceipt(txHash);
    if (!makbuz) throw new Error("makbuz yok");
    const kodlu = makbuzdanKodla(makbuz.status ?? 0, makbuz.logs as any);
    await (await (verifier as any).ayarla(true, ++sorgusayaci)).wait();
    const gonderim = await (ledger as any)[fn](SEPOLIA_KEY, makbuz.blockNumber, kodlu, "0x" + "00".repeat(32), [], "0x" + "00".repeat(32), []);
    await gonderim.wait();
  }

  // ═══ SENARYO 1: kilit → kanit → limit ═══
  console.log("Senaryo 1: kilit ve limit acilisi");
  await (await usdcAK.approve(escrowAdres, parseUnits("10000", 6))).wait();
  const kilitTx = await escrowK.lock(parseUnits("5000", 6));
  await kilitTx.wait();
  await kanitla(kilitTx.hash, "submitLockProof");

  dogrula("teminat senkronu 5000", (await (ledger as any).collateral(kullaniciAAdres, SEPOLIA_KEY)) === parseUnits("5000", 6));
  dogrula("limit %80 = 4000", (await (ledger as any).available(kullaniciAAdres)) === parseUnits("4000", 6));

  // ═══ SENARYO 2: ayni kaniti tekrar isleme (worker mukerrer korumasi) ═══
  console.log("Senaryo 2: tekrar oynatma korumasi");
  {
    const makbuz = await A.getTransactionReceipt(kilitTx.hash);
    const kodlu = makbuzdanKodla(1, makbuz!.logs as any);
    // ayni txIndex → ayni queryId → revert beklenir
    await reverteBekle(
      "ayni sorgu reddedilir",
      async () => {
        const gonderim = await (ledger as any).submitLockProof(SEPOLIA_KEY, makbuz!.blockNumber, kodlu, "0x" + "00".repeat(32), [], "0x" + "00".repeat(32), []);
        await gonderim.wait();
      },
      "sorgu islendi"
    );
  }

  // ═══ SENARYO 3: harcama + otomatik kesinti + mahsup ═══
  console.log("Senaryo 3: harca, kes, mahsupla");
  const harcamaTx = await ledgerK.spend(ALICI, parseUnits("1000", 6), SEPOLIA_KEY);
  const harcamaMakbuz = await harcamaTx.wait();

  dogrula("alici parayi ANINDA aldi (1000)", (await (usdcB as any).balanceOf(ALICI)) === parseUnits("1000", 6));
  dogrula("borc = 1003 (komisyon %0,30)", (await (ledger as any).outstanding(kullaniciAAdres)) === parseUnits("1003", 6));

  // DeductionQueued olayindan claimId al
  const kuyrukOlaylari = await (ledger as any).queryFilter((ledger as any).filters.DeductionQueued(), harcamaMakbuz!.blockNumber, harcamaMakbuz!.blockNumber);
  dogrula("kesinti talebi olustu", kuyrukOlaylari.length === 1);
  const claimId = kuyrukOlaylari[0].args[0];

  // operator escrow'da keser (gercekte worker yapar)
  const kesintiTx = await (escrow as any).deduct(kullaniciAAdres, parseUnits("1003", 6), claimId);
  await kesintiTx.wait();
  dogrula("escrow kilidi dustu (3997)", (await (escrow as any).locked(kullaniciAAdres)) === parseUnits("3997", 6));
  dogrula("hazine kesintiyi aldi (1003)", (await (usdcA as any).balanceOf(OPERATOR_ADRES)) === parseUnits("1003", 6));

  // kesinti kaniti ledger'da talebi kapatir
  await kanitla(kesintiTx.hash, "submitDeductionProof");
  dogrula("borc sifirlandi", (await (ledger as any).outstanding(kullaniciAAdres)) === 0n);
  dogrula("teminat kesinti sonrasi 3997", (await (ledger as any).collateral(kullaniciAAdres, SEPOLIA_KEY)) === parseUnits("3997", 6));
  const talep = await (ledger as any).claims(claimId);
  dogrula("talep kapali", talep.settled === true);

  // ═══ SENARYO 4: hata yollari ═══
  console.log("Senaryo 4: hata yollari");
  await reverteBekle(
    "limit asilamaz",
    () => ledgerK.spend(ALICI, parseUnits("9999", 6), SEPOLIA_KEY),
    "limit yetersiz"
  );
  await reverteBekle(
    "teminatsiz kullanici harcayamaz",
    async () => {
      const yabanci = new YerelCuzdan("0x" + "07".repeat(32), B);
      await (await opB.sendTransaction({ to: yabanci.address, value: parseUnits("1", 18) })).wait();
      await (ledger.connect(yabanci) as any).spend(ALICI, parseUnits("1", 6), SEPOLIA_KEY);
    },
    "limit yetersiz"
  );
  await reverteBekle(
    "operator disinda kimse kesemez",
    () => (escrow.connect(kullaniciA) as any).deduct(kullaniciAAdres, 1n, "0x" + "11".repeat(32)),
    "operator degil"
  );
  await reverteBekle(
    "gecersiz kanit reddedilir",
    async () => {
      await (await (verifier as any).ayarla(false, ++sorgusayaci)).wait();
      const makbuz = await A.getTransactionReceipt(kilitTx.hash);
      const kodlu = makbuzdanKodla(1, makbuz!.logs as any);
      const gonderim = await (ledger as any).submitLockProof(SEPOLIA_KEY, 999, kodlu, "0x" + "00".repeat(32), [], "0x" + "00".repeat(32), []);
      await gonderim.wait();
    },
    "kanit gecersiz"
  );

  // ═══ SENARYO 5: cekim gecikmesi ve kesinti onceligi ═══
  console.log("Senaryo 5: cekim gecikmesi");
  await (await escrowK.requestUnlock(parseUnits("1000", 6))).wait();
  await reverteBekle("gecikme dolmadan cekilemez", () => escrowK.withdraw(), "bekleme suresi");
  await A.send("evm_increaseTime", [130]);
  await A.send("evm_mine", []);
  await (await escrowK.withdraw()).wait();
  dogrula("gecikme sonrasi cekim basarili (kalan 2997)", (await (escrow as any).locked(kullaniciAAdres)) === parseUnits("2997", 6));

  // ═══ SENARYO 6: ikinci harcama dongusu (sistem kirli durumda da calisiyor) ═══
  console.log("Senaryo 6: ikinci tam dongu");
  {
    // yeni kilit senkronu (kumulatif: 2997 uzerine +2000 kilit)
    const kilit2 = await escrowK.lock(parseUnits("2000", 6));
    await kilit2.wait();
    await kanitla(kilit2.hash, "submitLockProof");
    dogrula("teminat 4997", (await (ledger as any).collateral(kullaniciAAdres, SEPOLIA_KEY)) === parseUnits("4997", 6));

    const h2 = await ledgerK.spend(ALICI, parseUnits("500", 6), SEPOLIA_KEY);
    const m2 = await h2.wait();
    const olay2 = await (ledger as any).queryFilter((ledger as any).filters.DeductionQueued(), m2!.blockNumber, m2!.blockNumber);
    const claim2 = olay2[0].args[0];
    const k2 = await (escrow as any).deduct(kullaniciAAdres, parseUnits("501.5", 6), claim2);
    await k2.wait();
    await kanitla(k2.hash, "submitDeductionProof");
    dogrula("ikinci dongu: borc sifir", (await (ledger as any).outstanding(kullaniciAAdres)) === 0n);
    dogrula("alici toplam 1500 aldi", (await (usdcB as any).balanceOf(ALICI)) === parseUnits("1500", 6));
  }

  // ═══ sonuc ═══
  console.log(`\n═══ SONUC: ${gecti} dogrulama gecti, ${kaldi} kaldi ═══`);
  if (kaldi > 0) process.exit(1);
  console.log("Simulasyon TEMIZ: tam dongu + hata yollari calisiyor.\n");
  process.exit(0);
}

main().catch((hata) => {
  console.error("SIMULASYON HATASI:", hata);
  process.exit(1);
});

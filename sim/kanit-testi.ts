/* Gercek Attestcoin kaniti ile uctan uca test (testnet). */
import { JsonRpcProvider } from "ethers";
import { proofProvider, chainInfo } from "@gluwa/usc-sdk";
import * as dotenv from "dotenv";
dotenv.config();

const CHAIN_KEY = 1; // Sepolia
(async () => {
  const cc = new JsonRpcProvider(process.env.CREDITCOIN_RPC_URL!);
  const bilgi = new chainInfo.PrecompileChainInfoProvider(cc);
  const son = await bilgi.getLatestAttestedHeightAndHash(CHAIN_KEY);
  console.log("son attest edilen Sepolia blogu:", son.height.toString());
  console.log("bizim kilit blogu:              11538379");
  const fark = 11538379 - Number(son.height);
  console.log(fark > 0 ? `  ${fark} blok geride, beklenecek` : "  ATTEST EDILDI, kanit uretilebilir");
  process.exit(0);
})().catch(e => { console.error("HATA:", e.message?.slice(0,200)); process.exit(1); });

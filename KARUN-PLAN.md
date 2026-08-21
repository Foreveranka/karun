# KARUN

**BUIDL CTC 2026 Fall** için proje (Creditcoin + Attestcoin Protocol hackathonu).
Teslim: **6 Eylül 2026, 23:59 ET** | Havuz: 15.000 $ | İlk 3: CEIP fast-track + CertiK denetim kredisi

## Tek cümle

Kullanıcının farklı ağlardaki parasını köprülemeden tek harcanabilir bakiyeye çeviren, her harcamayı Attestcoin ile başka ağdaki escrow'dan anında mahsuplaşan ödeme protokolü.

## Model (Mete'nin kurgusu)

1. Kullanıcı her ağdaki parasını o ağdaki **KarunEscrow** kontratına kilitler.
2. Attestcoin, kilitleri Creditcoin'deki **KarunLedger**'a attest eder; stabil varlıklara %80 limitle tek harcama limiti oluşur.
3. Kullanıcı herhangi bir ağda harcar: para **protokolün o ağdaki likidite bakiyesinden** anında çıkar.
4. Attestcoin mesajı kaynak ağa gider; escrow, karşılığı + komisyonu **otomatik keser** ve protokolün oradaki bakiyesine aktarır.
5. Borç birikmez; her harcama anında mahsuplaşır. %80 tamponu gecikme/fiyat riskini karşılar.
6. Gelir: harcama başına komisyon. Likidite kesintilerle kendini doldurur (rebalancing v2 konusu).

## Kontratlar

- `KarunEscrow.sol` (her EVM ağında): kilitle / Attestcoin mesajıyla otomatik kes / çöz
- `KarunLedger.sol` (Creditcoin testnet): attest edilen kilit defteri, limit muhasebesi, harcama onayı (çifte harcama koruması burada), likidite havuzu yönetimi
- `KarunSpender.sol` (her ağda): protokol likiditesi + harcama ucu (onaylı harcamayı öder)
- Mock USDC (test ağlarında)

## Akış (demo)

kilitle (ağ A) → attest → limit aç (Creditcoin) → harca (ağ B, parası olmayan ağ) → Attestcoin mesajı → escrow'dan otomatik kesinti (ağ A) → çöz/kalan iade

## Hackathon gereksinimleri

- Attestcoin Protocol ÇEKİRDEK özellik olmalı (bizde her akışta var) ✓
- Testnet deploy zorunlu: Creditcoin testnet + 2 EVM testnet
- Hackathon süresinde yazılmış orijinal kod (13 Ağustos sonrası)
- README'li GitHub reposu + deck/whitepaper PDF + demo video
- Kayıt formu: sektör DeFi, Attestcoin entegrasyon özeti yazılacak

## Kaynaklar

- Attestcoin docs: https://docs.creditcoin.org/creditcoin-usc
- USC SDK: github.com/gluwa/usc-sdk (detay sayfadaki link)
- Hackathon: https://dorahacks.io/hackathon/buidl-ctc-2026-fall/detail
- AMA kaydı: https://luma.com/buidlctc-fall26-ama (18 Ağustos'tu, kaydı varsa izlenebilir)

## Zaman planı (ETHOnline 4 Eylül'de başlıyor, çakışma var!)

- 22-24 Ağustos: Attestcoin SDK'yı öğren, iskelet kontratlar, yerel test
- 25-28 Ağustos: Escrow + Ledger + Spender uçtan uca, testnet deploylar
- 29-31 Ağustos: basit arayüz (tek sayfa: kilitle/limit/harca), uç durumlar
- 1-3 Eylül: demo video, deck PDF, README, DoraHacks BUIDL kaydı → ERKEN TESLİM hedefi 3 Eylül
- 4-6 Eylül: tampon (ETHOnline başlamış olacak, Karun bitmiş olmalı)

## Durum

- [ ] Attestcoin SDK incelemesi
- [ ] Kontratlar
- [ ] Testnet deploy
- [ ] Arayüz
- [ ] Video + deck
- [ ] DoraHacks teslimi

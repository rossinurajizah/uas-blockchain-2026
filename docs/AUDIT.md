# Audit Keamanan AcademicVerifier (Project 3)

Objek audit: `contracts/AcademicVerifier.sol` v2 (commit [ISI: hash commit v2]).
Hasil perbaikan: v3 (commit [ISI: hash commit perbaikan]). Metode: review kode manual, threat model, dan test eksploit (`test/Audit.test.js`) yang **gagal pada v2 dan lulus pada v3**.

## 1. Threat model ringkas
| Unsur | Isi |
|---|---|
| Aset | Integritas registri hash; kunci ISSUER_ROLE dan admin; privasi lulusan (holderRef); ketersediaan layanan verifikasi dan penerbitan |
| Aktor | Issuer sah; issuer yang kuncinya bocor/tidak jujur; admin dan pauser; penyerang eksternal tanpa role; verifier; node/RPC |
| Trust boundary | (1) off-chain dan on-chain (hanya hash yang melintas); (2) frontend/wallet dan node (JSON-RPC); (3) antar institusi konsorsium (pemegang role) |
| Skenario penyalahgunaan | Pencurian kunci issuer dan penerbitan ijazah palsu; admin mengunci/kehilangan kunci; issuer mendahului (front-run) hash penerbit lain; input kosong merusak catatan; pauser menghentikan layanan |

## 2. Pemeriksaan per aspek
| Aspek | Hasil |
|---|---|
| Reentrancy | Tidak berlaku: kontrak tidak melakukan external call maupun transfer ETH; semua fungsi mengubah state sebelum event. |
| Access-control flaw | Ditemukan A-01 (admin terakhir dapat hilang). Fungsi tulis lain dibatasi role dan diuji (T-08 sampai T-24). |
| Front-running / transaction ordering | Ditemukan A-04 (pra-registrasi hash). Risiko diterima dengan mitigasi. |
| Oracle | Tidak berlaku: tidak ada oracle atau data eksternal. |
| DoS | Tidak ada loop atau array tak terbatas; biaya gas tiap fungsi konstan. Pause oleh pauser dicatat di A-05. |
| Validasi input | Ditemukan A-03 (holderRef nol). hash nol sudah ditolak sejak v2 (T-07). |
| Error handling | Custom error dan revert eksplisit; tidak ada low-level call. |
| Respons insiden kunci bocor | Ditemukan A-02 (terbitan penyerang tetap valid setelah role dicabut). |

## 3. Tabel audit
| ID | Temuan dan bukti | Dampak | Kemungkinan | Risiko | Mitigasi / perubahan kode | Status verifikasi |
|---|---|---|---|---|---|---|
| A-01 | Admin terakhir dapat `renounceRole`/`revokeRole` atas dirinya, sehingga tidak ada lagi yang dapat memberi role, mencabut issuer, atau unpause (terkunci permanen). Bukti: `Audit.test.js` A-01 gagal pada v2. | Tinggi | Rendah (salah operasional) | Sedang | `adminCount` dan error `LastAdmin` pada `_revokeRole`; minimal satu admin selalu ada. | **Diperbaiki; retest lulus** |
| A-02 | Setelah kunci issuer bocor, mencabut ISSUER_ROLE tidak membatalkan ijazah palsu yang sudah terbit; satu-satunya cara mencabut per hash (hash tidak diketahui). Bukti: A-02 gagal pada v2 (fungsi pembekuan tidak ada). | Tinggi | Sedang | **Tinggi** | `invalidateIssuer(issuer, fromTimestamp)`: cabut role dan bekukan semua terbitan sejak waktu kebocoran; terbitan sebelumnya tetap valid; batas hanya dapat dimundurkan; status efektif `IssuerInvalidated`. | **Diperbaiki; retest lulus** |
| A-03 | `holderRef = bytes32(0)` diterima sehingga catatan tanpa referensi pemegang. Bukti: A-03 gagal pada v2. | Rendah | Sedang | Rendah | Validasi `InvalidHolderRef` pada `issueCredential`. | **Diperbaiki; retest lulus** |
| A-04 | Issuer lain dapat mendaftarkan hash yang sama lebih dulu (hash terlihat di mempool); transaksi penerbit sah revert `AlreadyRegistered`. Bukti: tes A-04 lulus pada v2 dan v3 (perilaku terdokumentasi). | Rendah | Rendah (butuh ISSUER_ROLE) | Rendah | Diterima: atribusi penerbit tersimpan dan tidak dapat dipalsukan; admin dapat mencabut; penerbit sah memakai salt baru (diuji). | **Risiko diterima; mitigasi terbukti** |
| A-05 | Admin dan pauser berupa satu akun biasa (EOA) tanpa multisig atau time-lock; pauser dapat menghentikan penerbitan sepihak. | Sedang | Rendah | Rendah-Sedang | Tidak diubah pada prototipe. Produksi: multisig (mis. 3 dari 5), time-lock, dan pemisahan akun pauser. | **Terbuka (rencana lanjutan)** |

## 4. Perubahan kode v2 ke v3
- `adminCount` dan override `_grantRole`/`_revokeRole` (A-01).
- `invalidateIssuer`, mapping `issuerInvalidFrom`, status `IssuerInvalidated`, event `IssuerInvalidated` (A-02).
- Validasi `InvalidHolderRef` (A-03).
- Frontend menampilkan status "PENERBIT DIBEKUKAN".

## 5. Retest
| Perintah | Hasil |
|---|---|
| `npm test` pada v2 + `Audit.test.js` | [ISI: jumlah passing/failing, mis. 3 passing, 10 failing] |
| `npm test` pada v3 | [ISI: 37 passing] |
| `npm run coverage` pada v3 | [ISI: 100% statement/branch/function/line] |

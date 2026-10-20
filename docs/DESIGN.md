# Catatan Desain: AcademicVerifier v1 -> v2

## Perubahan dari UTS (alasan)
| # | v1 (UTS) | v2 (UAS) | Alasan |
|---|---|---|---|
| 1 | Penerbit hanya tertulis di desain, tidak ada di struct | Field `issuer` per kredensial | Teks UTS (4.2, Gbr 4.1) tidak cocok dengan kode; pencabutan oleh penerbit asal butuh data ini |
| 2 | `studentWallet` publik di mapping dan event | `holderRef = keccak256(wallet, salt)` | Menutup TM-4: alamat lulusan tidak bisa dikorelasikan |
| 3 | Revoke hanya admin | Revoke oleh issuer asal atau admin | Sesuai desain tata kelola; issuer lain tetap tidak bisa |
| 4 | Deployer = admin + issuer | Admin dan issuer dipisah; `admin` parameter constructor | Pemisahan tugas; admin bisa diganti multisig saat deploy |
| 5 | Tanpa pause | `Pausable`: hanya menghentikan penerbitan | Respons insiden (kunci issuer bocor); verifikasi dan revoke tetap jalan |
| 6 | `bool isValid` + string revert | `enum Status` + custom error | Lebih jelas (None/Valid/Revoked), hemat gas, mudah diuji |

## Masih desain (belum diimplementasi)
Time-lock/multisig admin, Merkle proof, DID/VC, konsensus QBFT multi-validator.

## Trade-off
- `holderRef` melindungi privasi, tetapi lulusan harus menyimpan salt untuk membuktikan kepemilikan.
- Status Revoked bersifat akhir; koreksi dilakukan dengan menerbitkan hash baru (salt baru).

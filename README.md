# UAS Blockchain 2026/2027 - AcademicVerifier

Sistem verifikasi kredensial akademik (ijazah, transkrip, sertifikat) berbasis consortium EVM.
Hanya **hash dokumen** dan status yang disimpan on-chain; dokumen, salt, dan data pribadi tetap off-chain.

- Mata kuliah: Blockchain (KP70067008), Universitas Siliwangi
- Penyusun: Rossi Nur Ajizah - 237006003 (individu)
- Lanjutan dari UTS: <https://github.com/rossinurajizah/test-blockchain> (commit `9f65fe6`)

## Struktur
| Path | Isi |
|---|---|
| `contracts/AcademicVerifier.sol` | Smart contract v2 |
| `test/` | Unit test (Hardhat + Chai) |
| `scripts/deploy.js` | Deploy ke local network, tulis Deployment Record dan konfigurasi frontend |
| `frontend/` | Client web sederhana (ethers.js v6 + MetaMask) |
| `deployments/` | Hasil deploy (address, tx hash) |
| `docs/DESIGN.md` | Keputusan desain dan perubahan v1 -> v2 |

## Prasyarat
Node.js >= 18 (diuji pada Node 22) dan npm. Hanya **local network** / akun uji Hardhat. Jangan memakai aset atau private key asli.

## Instalasi dan reproduksi
```bash
git clone https://github.com/rossinurajizah/uas-blockchain-2026.git
cd uas-blockchain-2026
npm install
npm run compile
npm test                 # 24 unit test
npm run coverage         # laporan coverage

# Deploy ke local blockchain
npx hardhat node                  # terminal 1 (biarkan berjalan)
npm run deploy:local              # terminal 2 -> deployments/localhost.json + frontend/contract-config.js
npm run frontend                  # terminal 3 -> http://127.0.0.1:3000/frontend/
```

## Menjalankan frontend dengan MetaMask (local network)
1. Gunakan profil browser khusus uji. Tambahkan jaringan: nama `Hardhat Local`, RPC `http://127.0.0.1:8545`, Chain ID `31337`, simbol `ETH`.
2. Impor akun uji dari keluaran `npx hardhat node` (key ini **publik dan hanya untuk local**; jangan dipakai di jaringan asli atau dikirimi dana):
   - Account #0 = admin/pauser, Account #1 = issuer (diberi ISSUER_ROLE oleh `deploy.js`), Account #2 = contoh wallet lulusan.
3. Buka halaman, klik **Hubungkan wallet**, lalu coba: terbitkan, verifikasi, cabut, pause.
4. Setelah `hardhat node` dijalankan ulang: jalankan `npm run deploy:local` lagi, lalu di MetaMask pilih *Settings > Advanced > Clear activity tab data* (reset nonce).

Private key tidak disimpan di repositori.

## Status pengerjaan
- [x] Tahap 1: kontrak v2, unit test, deploy script
- [x] Tahap 2: frontend/client + integrasi wallet
- [ ] Tahap 3: audit keamanan dan perbaikan
- [ ] Tahap 4: evaluasi enterprise/privasi
- [ ] Tahap 5: laporan, slide, video demo

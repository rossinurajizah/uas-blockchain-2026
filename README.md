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
| `scripts/deploy.js` | Deploy ke local network + Deployment Record |
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
npm run deploy:local              # terminal 2 -> tulis deployments/localhost.json
```

## Status pengerjaan
- [x] Tahap 1: kontrak v2, unit test, deploy script
- [ ] Tahap 2: frontend/client + integrasi wallet
- [ ] Tahap 3: audit keamanan dan perbaikan
- [ ] Tahap 4: evaluasi enterprise/privasi
- [ ] Tahap 5: laporan, slide, video demo

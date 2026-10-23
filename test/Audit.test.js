// Tes audit keamanan (Project 3). Menguji PERILAKU YANG DIHARAPKAN setelah perbaikan.
// Pada AcademicVerifier v2 tes A-01..A-03 GAGAL (membuktikan temuan); pada v3 semuanya LULUS (retest).
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const Status = { None: 0n, Valid: 1n, Revoked: 2n, IssuerInvalidated: 3n };
const sha = (doc, salt) => ethers.sha256(ethers.concat([ethers.toUtf8Bytes(doc), salt]));
const ref = (wallet, salt) => ethers.keccak256(ethers.concat([ethers.getBytes(wallet), salt]));
const rnd = () => ethers.hexlify(ethers.randomBytes(32));

async function fixture() {
  const [admin, admin2, issuerA, issuerB, student, attacker] = await ethers.getSigners();
  const v = await (await ethers.getContractFactory("AcademicVerifier")).deploy(admin.address);
  await v.waitForDeployment();
  const ISSUER_ROLE = await v.ISSUER_ROLE();
  const ADMIN_ROLE = await v.DEFAULT_ADMIN_ROLE();
  await v.connect(admin).grantRole(ISSUER_ROLE, issuerA.address);
  await v.connect(admin).grantRole(ISSUER_ROLE, issuerB.address);
  return { v, admin, admin2, issuerA, issuerB, student, attacker, ISSUER_ROLE, ADMIN_ROLE };
}
async function issueAs(v, signer, student, docText) {
  const salt = rnd();
  const h = sha(docText, salt);
  await v.connect(signer).issueCredential(h, ref(student.address, salt));
  return { h, salt };
}

describe("AUDIT Project 3", function () {
  describe("A-01 Admin tunggal dapat mengunci tata kelola (renounce / revoke diri sendiri)", function () {
    it("admin terakhir tidak dapat renounceRole(DEFAULT_ADMIN_ROLE)", async function () {
      const { v, admin, ADMIN_ROLE } = await loadFixture(fixture);
      await expect(v.connect(admin).renounceRole(ADMIN_ROLE, admin.address)).to.be.revertedWithCustomError(v, "LastAdmin");
      expect(await v.hasRole(ADMIN_ROLE, admin.address)).to.equal(true);
    });
    it("admin terakhir tidak dapat mencabut role-nya sendiri lewat revokeRole", async function () {
      const { v, admin, ADMIN_ROLE } = await loadFixture(fixture);
      await expect(v.connect(admin).revokeRole(ADMIN_ROLE, admin.address)).to.be.revertedWithCustomError(v, "LastAdmin");
    });
    it("[regresi] dengan dua admin, satu admin boleh mundur dan admin lain tetap berfungsi", async function () {
      const { v, admin, admin2, issuerA, ADMIN_ROLE, ISSUER_ROLE } = await loadFixture(fixture);
      await v.connect(admin).grantRole(ADMIN_ROLE, admin2.address);
      await v.connect(admin).renounceRole(ADMIN_ROLE, admin.address);
      expect(await v.hasRole(ADMIN_ROLE, admin.address)).to.equal(false);
      await v.connect(admin2).revokeRole(ISSUER_ROLE, issuerA.address); // admin2 masih berkuasa
      expect(await v.hasRole(ISSUER_ROLE, issuerA.address)).to.equal(false);
    });
  });

  describe("A-02 Kunci issuer bocor: kredensial terbitan penyerang tetap VALID setelah role dicabut", function () {
    it("admin dapat membekukan kredensial issuer sejak waktu kebocoran; terbitan lama tetap valid", async function () {
      const { v, admin, issuerA, issuerB, student } = await loadFixture(fixture);
      const good = await issueAs(v, issuerB, student, "IJAZAH|sah|0001");
      await time.increase(100);
      const tCompromise = BigInt(await time.latest()) + 1n;
      const bad = await issueAs(v, issuerB, student, "IJAZAH|PALSU|0002"); // diterbitkan penyerang
      const other = await issueAs(v, issuerA, student, "IJAZAH|issuerA|0003");
      expect(await v.verifyCredential(bad.h)).to.equal(true); // sebelum tindakan: palsu lolos verifikasi

      await expect(v.connect(admin).invalidateIssuer(issuerB.address, tCompromise))
        .to.emit(v, "IssuerInvalidated").withArgs(issuerB.address, tCompromise, admin.address);

      expect(await v.verifyCredential(bad.h)).to.equal(false);      // palsu ditolak
      expect(await v.verifyCredential(good.h)).to.equal(true);      // terbitan sah sebelum kebocoran aman
      expect(await v.verifyCredential(other.h)).to.equal(true);     // issuer lain tidak terdampak
      const [status] = await v.getCredential(bad.h);
      expect(status).to.equal(Status.IssuerInvalidated);
    });
    it("issuer yang dibekukan kehilangan ISSUER_ROLE sehingga tidak dapat menerbitkan lagi", async function () {
      const { v, admin, issuerB, student, ISSUER_ROLE } = await loadFixture(fixture);
      await v.connect(admin).invalidateIssuer(issuerB.address, BigInt(await time.latest()));
      expect(await v.hasRole(ISSUER_ROLE, issuerB.address)).to.equal(false);
      await expect(v.connect(issuerB).issueCredential(sha("x", rnd()), ref(student.address, rnd())))
        .to.be.revertedWithCustomError(v, "AccessControlUnauthorizedAccount");
    });
    it("[akses] hanya admin yang dapat membekukan issuer", async function () {
      const { v, attacker, issuerB } = await loadFixture(fixture);
      await expect(v.connect(attacker).invalidateIssuer(issuerB.address, 1n))
        .to.be.revertedWithCustomError(v, "AccessControlUnauthorizedAccount");
    });
    it("[batas] waktu di masa depan ditolak", async function () {
      const { v, admin, issuerB } = await loadFixture(fixture);
      const future = BigInt(await time.latest()) + 10_000n;
      await expect(v.connect(admin).invalidateIssuer(issuerB.address, future)).to.be.revertedWithCustomError(v, "InvalidTimestamp");
    });
    it("[batas] waktu nol ditolak", async function () {
      const { v, admin, issuerB } = await loadFixture(fixture);
      await expect(v.connect(admin).invalidateIssuer(issuerB.address, 0n)).to.be.revertedWithCustomError(v, "InvalidTimestamp");
    });
    it("batas pembekuan hanya boleh dimundurkan, tidak dimajukan", async function () {
      const { v, admin, issuerB } = await loadFixture(fixture);
      const now = BigInt(await time.latest());
      await v.connect(admin).invalidateIssuer(issuerB.address, now);
      await expect(v.connect(admin).invalidateIssuer(issuerB.address, now))
        .to.be.revertedWithCustomError(v, "AlreadyInvalidated");
      await v.connect(admin).invalidateIssuer(issuerB.address, now - 1n); // memundurkan: boleh
      expect(await v.issuerInvalidFrom(issuerB.address)).to.equal(now - 1n);
    });
    it("kredensial beku tetap dapat dicabut secara eksplisit oleh admin", async function () {
      const { v, admin, issuerB, student } = await loadFixture(fixture);
      const bad = await issueAs(v, issuerB, student, "PALSU");
      await v.connect(admin).invalidateIssuer(issuerB.address, BigInt(await time.latest()));
      await v.connect(admin).revokeCredential(bad.h);
      const [status] = await v.getCredential(bad.h);
      expect(status).to.equal(Status.Revoked);
    });
  });

  describe("A-03 Validasi input: holderRef kosong diterima", function () {
    it("issueCredential menolak holderRef = bytes32(0)", async function () {
      const { v, issuerA } = await loadFixture(fixture);
      await expect(v.connect(issuerA).issueCredential(sha("doc", rnd()), ethers.ZeroHash))
        .to.be.revertedWithCustomError(v, "InvalidHolderRef");
    });
  });

  describe("A-04 Front-running / pra-registrasi hash (RISIKO DITERIMA, dimitigasi tata kelola)", function () {
    it("issuer lain dapat mendaftarkan hash yang sama lebih dulu; terbitan tampak jelas siapa penerbitnya", async function () {
      const { v, issuerA, issuerB, student } = await loadFixture(fixture);
      const salt = rnd(); const h = sha("IJAZAH|korban|0004", salt);
      await v.connect(issuerB).issueCredential(h, ref(student.address, salt)); // B mendahului
      await expect(v.connect(issuerA).issueCredential(h, ref(student.address, salt)))
        .to.be.revertedWithCustomError(v, "AlreadyRegistered");
      const [, issuer] = await v.getCredential(h);
      expect(issuer).to.equal(issuerB.address); // atribusi tidak dapat dipalsukan
    });
    it("mitigasi: admin mencabut terbitan penyerang, penerbit sah memakai salt baru", async function () {
      const { v, admin, issuerA, issuerB, student } = await loadFixture(fixture);
      const salt = rnd(); const h = sha("IJAZAH|korban|0004", salt);
      await v.connect(issuerB).issueCredential(h, ref(student.address, salt));
      await v.connect(admin).revokeCredential(h);
      const salt2 = rnd(); const h2 = sha("IJAZAH|korban|0004", salt2);
      await v.connect(issuerA).issueCredential(h2, ref(student.address, salt2));
      expect(await v.verifyCredential(h2)).to.equal(true);
      expect(await v.verifyCredential(h)).to.equal(false);
    });
  });
});

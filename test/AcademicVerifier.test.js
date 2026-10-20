const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

// Status enum: 0 None, 1 Valid, 2 Revoked
const Status = { None: 0n, Valid: 1n, Revoked: 2n };

/** Hash dokumen kanonik + salt (dihitung off-chain, sama seperti sisi verifier). */
function docHashOf(document, salt) {
  return ethers.keccak256(ethers.concat([ethers.toUtf8Bytes(document), salt]));
}
/** holderRef = hash(wallet lulusan || salt) -> alamat lulusan tidak tampil di chain. */
function holderRefOf(wallet, salt) {
  return ethers.keccak256(ethers.concat([ethers.getBytes(wallet), salt]));
}

async function deployFixture() {
  const [admin, issuerA, issuerB, student, attacker] = await ethers.getSigners();
  const Factory = await ethers.getContractFactory("AcademicVerifier");
  const verifier = await Factory.deploy(admin.address);
  await verifier.waitForDeployment();

  const ISSUER_ROLE = await verifier.ISSUER_ROLE();
  const PAUSER_ROLE = await verifier.PAUSER_ROLE();
  const ADMIN_ROLE = await verifier.DEFAULT_ADMIN_ROLE();
  await verifier.connect(admin).grantRole(ISSUER_ROLE, issuerA.address);
  await verifier.connect(admin).grantRole(ISSUER_ROLE, issuerB.address);

  const salt = ethers.hexlify(ethers.randomBytes(32));
  const docHash = docHashOf("IJAZAH|S1-Informatika|2026|0001", salt);
  const holderRef = holderRefOf(student.address, salt);

  return { verifier, admin, issuerA, issuerB, student, attacker, ISSUER_ROLE, PAUSER_ROLE, ADMIN_ROLE, salt, docHash, holderRef };
}

describe("AcademicVerifier v2", function () {
  describe("Deployment & role", function () {
    it("T-01 admin memegang DEFAULT_ADMIN_ROLE dan PAUSER_ROLE, tetapi BUKAN issuer", async function () {
      const { verifier, admin, ISSUER_ROLE, PAUSER_ROLE, ADMIN_ROLE } = await loadFixture(deployFixture);
      expect(await verifier.hasRole(ADMIN_ROLE, admin.address)).to.equal(true);
      expect(await verifier.hasRole(PAUSER_ROLE, admin.address)).to.equal(true);
      expect(await verifier.hasRole(ISSUER_ROLE, admin.address)).to.equal(false);
    });

    it("T-02 [batas] constructor menolak admin address(0)", async function () {
      const Factory = await ethers.getContractFactory("AcademicVerifier");
      await expect(Factory.deploy(ethers.ZeroAddress)).to.be.revertedWithCustomError(Factory, "ZeroAddress");
    });
  });

  describe("Penerbitan (positif)", function () {
    it("T-03 issuer menerbitkan kredensial: event, status Valid, issuer & waktu tersimpan", async function () {
      const { verifier, issuerA, docHash, holderRef } = await loadFixture(deployFixture);
      await expect(verifier.connect(issuerA).issueCredential(docHash, holderRef))
        .to.emit(verifier, "CredentialIssued")
        .withArgs(docHash, issuerA.address, holderRef);

      const [status, issuer, issuedAt, revokedAt] = await verifier.getCredential(docHash);
      expect(status).to.equal(Status.Valid);
      expect(issuer).to.equal(issuerA.address);
      expect(issuedAt).to.equal(BigInt(await time.latest()));
      expect(revokedAt).to.equal(0n);
    });

    it("T-04 verifyCredential bernilai true untuk hash aktif (dipanggil siapa pun)", async function () {
      const { verifier, issuerA, attacker, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      expect(await verifier.connect(attacker).verifyCredential(docHash)).to.equal(true);
    });

    it("T-05 [privasi] wallet lulusan tidak muncul di data/event on-chain", async function () {
      const { verifier, issuerA, student, docHash, holderRef } = await loadFixture(deployFixture);
      const tx = await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      const receipt = await tx.wait();
      const raw = JSON.stringify(receipt.logs.map((l) => [l.topics, l.data])).toLowerCase();
      expect(raw).to.not.include(student.address.slice(2).toLowerCase());
    });
  });

  describe("Penerbitan (negatif, batas, akses)", function () {
    it("T-06 hash yang sama tidak bisa diterbitkan dua kali", async function () {
      const { verifier, issuerA, issuerB, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await expect(verifier.connect(issuerB).issueCredential(docHash, holderRef))
        .to.be.revertedWithCustomError(verifier, "AlreadyRegistered")
        .withArgs(docHash);
    });

    it("T-07 [batas] hash nol (bytes32(0)) ditolak", async function () {
      const { verifier, issuerA, holderRef } = await loadFixture(deployFixture);
      await expect(verifier.connect(issuerA).issueCredential(ethers.ZeroHash, holderRef))
        .to.be.revertedWithCustomError(verifier, "InvalidHash");
    });

    it("T-08 [akses] akun tanpa ISSUER_ROLE tidak dapat menerbitkan", async function () {
      const { verifier, attacker, docHash, holderRef, ISSUER_ROLE } = await loadFixture(deployFixture);
      await expect(verifier.connect(attacker).issueCredential(docHash, holderRef))
        .to.be.revertedWithCustomError(verifier, "AccessControlUnauthorizedAccount")
        .withArgs(attacker.address, ISSUER_ROLE);
    });

    it("T-09 [akses] admin sendiri juga tidak bisa menerbitkan (pemisahan tugas)", async function () {
      const { verifier, admin, docHash, holderRef } = await loadFixture(deployFixture);
      await expect(verifier.connect(admin).issueCredential(docHash, holderRef))
        .to.be.revertedWithCustomError(verifier, "AccessControlUnauthorizedAccount");
    });
  });

  describe("Verifikasi (negatif & batas)", function () {
    it("T-10 hash tidak terdaftar -> false dan status None", async function () {
      const { verifier, docHash } = await loadFixture(deployFixture);
      expect(await verifier.verifyCredential(docHash)).to.equal(false);
      const [status] = await verifier.getCredential(docHash);
      expect(status).to.equal(Status.None);
    });

    it("T-11 [integritas] dokumen diubah 1 karakter -> hash beda -> verifikasi false", async function () {
      const { verifier, issuerA, salt, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      const tampered = docHashOf("IJAZAH|S1-Informatika|2026|0002", salt);
      expect(await verifier.verifyCredential(tampered)).to.equal(false);
    });
  });

  describe("Pencabutan", function () {
    it("T-12 issuer asal dapat mencabut kredensialnya; event & waktu tercatat", async function () {
      const { verifier, issuerA, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await expect(verifier.connect(issuerA).revokeCredential(docHash))
        .to.emit(verifier, "CredentialRevoked")
        .withArgs(docHash, issuerA.address);
      expect(await verifier.verifyCredential(docHash)).to.equal(false);
      const [status, , , revokedAt] = await verifier.getCredential(docHash);
      expect(status).to.equal(Status.Revoked);
      expect(revokedAt).to.equal(BigInt(await time.latest()));
    });

    it("T-13 admin dapat mencabut kredensial issuer mana pun", async function () {
      const { verifier, admin, issuerA, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await verifier.connect(admin).revokeCredential(docHash);
      expect(await verifier.verifyCredential(docHash)).to.equal(false);
    });

    it("T-14 [akses] issuer LAIN tidak dapat mencabut kredensial milik issuer asal", async function () {
      const { verifier, issuerA, issuerB, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await expect(verifier.connect(issuerB).revokeCredential(docHash))
        .to.be.revertedWithCustomError(verifier, "NotIssuerOrAdmin")
        .withArgs(issuerB.address);
      expect(await verifier.verifyCredential(docHash)).to.equal(true);
    });

    it("T-15 [akses] akun acak tidak dapat mencabut", async function () {
      const { verifier, issuerA, attacker, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await expect(verifier.connect(attacker).revokeCredential(docHash))
        .to.be.revertedWithCustomError(verifier, "NotIssuerOrAdmin");
    });

    it("T-16 mencabut hash yang tidak ada -> NotFound", async function () {
      const { verifier, admin, docHash } = await loadFixture(deployFixture);
      await expect(verifier.connect(admin).revokeCredential(docHash))
        .to.be.revertedWithCustomError(verifier, "NotFound")
        .withArgs(docHash);
    });

    it("T-17 mencabut dua kali -> AlreadyRevoked", async function () {
      const { verifier, issuerA, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await verifier.connect(issuerA).revokeCredential(docHash);
      await expect(verifier.connect(issuerA).revokeCredential(docHash))
        .to.be.revertedWithCustomError(verifier, "AlreadyRevoked");
    });

    it("T-18 status DICABUT bersifat akhir: hash lama tidak dapat diterbitkan ulang", async function () {
      const { verifier, issuerA, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await verifier.connect(issuerA).revokeCredential(docHash);
      await expect(verifier.connect(issuerA).issueCredential(docHash, holderRef))
        .to.be.revertedWithCustomError(verifier, "AlreadyRegistered");
    });

    it("T-19 penerbitan ulang sah memakai salt baru -> hash baru berstatus Valid", async function () {
      const { verifier, issuerA, student, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await verifier.connect(issuerA).revokeCredential(docHash);
      const newSalt = ethers.hexlify(ethers.randomBytes(32));
      const newHash = docHashOf("IJAZAH|S1-Informatika|2026|0001", newSalt);
      await verifier.connect(issuerA).issueCredential(newHash, holderRefOf(student.address, newSalt));
      expect(await verifier.verifyCredential(newHash)).to.equal(true);
      expect(await verifier.verifyCredential(docHash)).to.equal(false);
    });
  });

  describe("Pause & manajemen role", function () {
    it("T-20 pause menghentikan penerbitan (EnforcedPause)", async function () {
      const { verifier, admin, issuerA, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(admin).pause();
      await expect(verifier.connect(issuerA).issueCredential(docHash, holderRef))
        .to.be.revertedWithCustomError(verifier, "EnforcedPause");
    });

    it("T-21 saat pause, verifikasi dan pencabutan tetap berjalan", async function () {
      const { verifier, admin, issuerA, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      await verifier.connect(admin).pause();
      expect(await verifier.verifyCredential(docHash)).to.equal(true);
      await verifier.connect(issuerA).revokeCredential(docHash);
      expect(await verifier.verifyCredential(docHash)).to.equal(false);
    });

    it("T-22 unpause memulihkan penerbitan", async function () {
      const { verifier, admin, issuerA, docHash, holderRef } = await loadFixture(deployFixture);
      await verifier.connect(admin).pause();
      await verifier.connect(admin).unpause();
      await verifier.connect(issuerA).issueCredential(docHash, holderRef);
      expect(await verifier.verifyCredential(docHash)).to.equal(true);
    });

    it("T-23 [akses] non-pauser tidak dapat pause/unpause", async function () {
      const { verifier, attacker, PAUSER_ROLE } = await loadFixture(deployFixture);
      await expect(verifier.connect(attacker).pause())
        .to.be.revertedWithCustomError(verifier, "AccessControlUnauthorizedAccount")
        .withArgs(attacker.address, PAUSER_ROLE);
      await expect(verifier.connect(attacker).unpause())
        .to.be.revertedWithCustomError(verifier, "AccessControlUnauthorizedAccount");
    });

    it("T-24 [akses] non-admin tidak dapat memberi role; role yang dicabut kehilangan hak terbit", async function () {
      const { verifier, admin, issuerA, attacker, docHash, holderRef, ISSUER_ROLE, ADMIN_ROLE } =
        await loadFixture(deployFixture);
      await expect(verifier.connect(attacker).grantRole(ISSUER_ROLE, attacker.address))
        .to.be.revertedWithCustomError(verifier, "AccessControlUnauthorizedAccount")
        .withArgs(attacker.address, ADMIN_ROLE);

      await verifier.connect(admin).revokeRole(ISSUER_ROLE, issuerA.address);
      await expect(verifier.connect(issuerA).issueCredential(docHash, holderRef))
        .to.be.revertedWithCustomError(verifier, "AccessControlUnauthorizedAccount");
    });
  });
});

// Deploy ke local network (npx hardhat node) dan simpan Deployment Record.
// Hanya akun uji bawaan Hardhat. Tidak ada private key di repositori.
const fs = require("fs");
const path = require("path");
const { ethers, network, artifacts } = require("hardhat");

async function main() {
  const [admin, issuer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();

  const Factory = await ethers.getContractFactory("AcademicVerifier");
  const verifier = await Factory.deploy(admin.address);
  const deployTx = verifier.deploymentTransaction();
  await verifier.waitForDeployment();
  const deployReceipt = await deployTx.wait();

  // Beri ISSUER_ROLE ke akun #1 (simulasi kampus penerbit)
  const grantTx = await verifier.connect(admin).grantRole(await verifier.ISSUER_ROLE(), issuer.address);
  const grantReceipt = await grantTx.wait();

  const record = {
    network: network.name,
    chainId: net.chainId.toString(),
    contract: "AcademicVerifier",
    address: await verifier.getAddress(),
    admin: admin.address,
    issuer: issuer.address,
    deployTxHash: deployTx.hash,
    deployBlock: deployReceipt.blockNumber,
    grantIssuerTxHash: grantTx.hash,
    grantIssuerBlock: grantReceipt.blockNumber,
    deployedAt: new Date().toISOString(),
  };

  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${network.name}.json`), JSON.stringify(record, null, 2));
  // Konfigurasi untuk frontend (address + ABI; tanpa private key)
  const art = await artifacts.readArtifact("AcademicVerifier");
  const feDir = path.join(__dirname, "..", "frontend");
  fs.mkdirSync(feDir, { recursive: true });
  fs.writeFileSync(
    path.join(feDir, "contract-config.js"),
    "// Dibuat otomatis oleh scripts/deploy.js. Jangan diedit manual.\nwindow.CONTRACT_CONFIG = " +
      JSON.stringify({ chainId: record.chainId, address: record.address, abi: art.abi }, null, 2) + ";\n"
  );
  console.log(record);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

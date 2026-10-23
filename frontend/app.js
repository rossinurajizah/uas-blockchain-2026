/* Client AcademicVerifier: ethers v6 + wallet EIP-1193 (MetaMask) ke local network. */
const $ = (id) => document.getElementById(id);
const CFG = window.CONTRACT_CONFIG;
const enc = new TextEncoder();
let provider, signer, contract, account;

/** H = SHA-256(dokumen kanonik || salt), sama dengan unit test dan verifier. */
const docHashOf = (doc, salt) => ethers.sha256(ethers.concat([enc.encode(doc), salt]));
/** holderRef = keccak256(wallet lulusan || salt): alamat lulusan tidak tampil di chain. */
const holderRefOf = (wallet, salt) => ethers.keccak256(ethers.concat([wallet, salt]));
const short = (s) => (s ? s.slice(0, 8) + "..." + s.slice(-6) : "-");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function show(id, cls, html) { const o = $(id); o.className = "out " + cls; o.innerHTML = html; }
/** Cari data revert (hex) di dalam objek error wallet/provider. */
function revertData(e, depth = 0) {
  if (!e || depth > 5) return null;
  if (typeof e === "string") return /^0x[0-9a-fA-F]{8,}$/.test(e) ? e : null;
  for (const k of ["data", "error", "info"]) { const r = revertData(e[k], depth + 1); if (r) return r; }
  return null;
}
function errText(e) {
  if (e.code === "ACTION_REJECTED" || e.code === 4001) return "Transaksi ditolak di wallet.";
  const data = revertData(e);
  if (data && contract) {
    try {
      const pe = contract.interface.parseError(data);
      if (pe) return `Revert: <b>${esc(pe.name)}</b>(${esc(pe.args.map(String).join(", "))})`;
    } catch (_) { /* bukan error milik ABI ini */ }
  }
  if (e.revert && e.revert.name) return `Revert: <b>${esc(e.revert.name)}</b>(${esc((e.revert.args || []).join(", "))})`;
  return esc(e.shortMessage || e.message || e);
}
function setEnabled(on) {
  ["btn-issue", "btn-verify", "btn-revoke", "btn-grant", "btn-pause", "btn-unpause", "btn-events"].forEach((id) => ($(id).disabled = !on));
}
function randomSalt() { return ethers.hexlify(ethers.randomBytes(32)); }

function refreshHashes() {
  try { $("i-hash").textContent = $("i-salt").value ? docHashOf($("i-doc").value, $("i-salt").value) : "-"; } catch { $("i-hash").textContent = "salt tidak valid"; }
  try { $("v-hash").textContent = $("v-salt").value ? docHashOf($("v-doc").value, $("v-salt").value) : "-"; } catch { $("v-hash").textContent = "salt tidak valid"; }
}

async function connect() {
  try {
    if (!window.ethereum) return show("out-conn", "err", "Wallet tidak ditemukan. Pasang MetaMask.");
    await window.ethereum.request({ method: "eth_requestAccounts" });
    let bp = new ethers.BrowserProvider(window.ethereum);
    let net = await bp.getNetwork();
    if (net.chainId !== BigInt(CFG.chainId)) {
      const hex = "0x" + Number(CFG.chainId).toString(16);
      try { await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] }); }
      catch (e) {
        await window.ethereum.request({ method: "wallet_addEthereumChain", params: [{ chainId: hex, chainName: "Hardhat Local", rpcUrls: ["http://127.0.0.1:8545"], nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }] });
      }
      bp = new ethers.BrowserProvider(window.ethereum);
      net = await bp.getNetwork();
    }
    provider = bp;
    signer = await provider.getSigner();
    account = await signer.getAddress();
    const code = await provider.getCode(CFG.address);
    if (code === "0x") throw new Error(`Tidak ada kontrak di ${CFG.address}. Jalankan ulang: npm run deploy:local`);
    contract = new ethers.Contract(CFG.address, CFG.abi, signer);
    await refreshStatus(net);
    setEnabled(true);
    $("out-conn").className = "out";
    await loadEvents();
  } catch (e) { show("out-conn", "err", errText(e)); }
}

async function refreshStatus(net) {
  net = net || (await provider.getNetwork());
  const [isAdmin, isIssuer, isPauser, paused] = await Promise.all([
    contract.hasRole(await contract.DEFAULT_ADMIN_ROLE(), account),
    contract.hasRole(await contract.ISSUER_ROLE(), account),
    contract.hasRole(await contract.PAUSER_ROLE(), account),
    contract.paused(),
  ]);
  $("conn-info").innerHTML = `Akun: <b>${esc(account)}</b><br>Chain ID: <b>${net.chainId}</b> &middot; Kontrak: <b>${esc(CFG.address)}</b>`;
  const chip = (t, on) => `<span class="${on ? "on" : "off"}">${t}</span>`;
  $("roles").innerHTML = chip("ADMIN", isAdmin) + chip("ISSUER", isIssuer) + chip("PAUSER", isPauser) + chip(paused ? "PAUSED" : "AKTIF", !paused);
  if (!$("i-wallet").value) $("i-wallet").value = account;
}

async function sendTx(outId, label, fn) {
  try {
    show(outId, "info", "Menunggu konfirmasi wallet...");
    const tx = await fn();
    show(outId, "info", `Tx terkirim: ${esc(tx.hash)}<br>Menunggu blok...`);
    const rc = await tx.wait();
    await refreshStatus(); await loadEvents();
    return { tx, rc };
  } catch (e) { show(outId, "err", `${label} gagal. ${errText(e)}`); return null; }
}

async function issue() {
  let salt = $("i-salt").value;
  if (!salt) { salt = randomSalt(); $("i-salt").value = salt; }
  let docHash, holderRef;
  try { docHash = docHashOf($("i-doc").value, salt); holderRef = holderRefOf($("i-wallet").value, salt); }
  catch { return show("out-issue", "err", "Salt atau alamat wallet tidak valid."); }
  refreshHashes();
  const r = await sendTx("out-issue", "Penerbitan", () => contract.issueCredential(docHash, holderRef));
  if (!r) return;
  $("r-hash").value = docHash;
  $("v-doc").value = $("i-doc").value; $("v-salt").value = salt; refreshHashes();
  show("out-issue", "ok", `Kredensial diterbitkan.<br>docHash: <b>${esc(docHash)}</b><br>Tx: ${esc(r.tx.hash)}<br>Blok: ${r.rc.blockNumber}<br><i>Simpan dokumen dan salt; keduanya tidak ada di chain.</i>`);
}

async function verify() {
  try {
    const h = docHashOf($("v-doc").value, $("v-salt").value);
    const [valid, c] = await Promise.all([contract.verifyCredential(h), contract.getCredential(h)]);
    const st = Number(c.status);
    const badge = st === 1 ? '<span class="badge b-valid">VALID</span>' : st === 2 ? '<span class="badge b-rev">DICABUT</span>' : '<span class="badge b-none">TIDAK TERDAFTAR</span>';
    let extra = "";
    if (st !== 0) extra = `<br>Penerbit: ${esc(c.issuer)}<br>Terbit: ${new Date(Number(c.issuedAt) * 1000).toLocaleString("id-ID")}` + (st === 2 ? `<br>Dicabut: ${new Date(Number(c.revokedAt) * 1000).toLocaleString("id-ID")}` : "");
    show("out-verify", valid ? "ok" : "err", `${badge} &nbsp; verifyCredential = <b>${valid}</b><br>docHash: ${esc(h)}${extra}`);
  } catch (e) { show("out-verify", "err", "Verifikasi gagal. " + errText(e)); }
}

async function revoke() {
  const h = $("r-hash").value.trim();
  const r = await sendTx("out-revoke", "Pencabutan", () => contract.revokeCredential(h));
  if (r) show("out-revoke", "ok", `Kredensial dicabut.<br>Tx: ${esc(r.tx.hash)}<br>Blok: ${r.rc.blockNumber}`);
}

async function grant() {
  const r = await sendTx("out-admin", "Pemberian role", async () => contract.grantRole(await contract.ISSUER_ROLE(), $("a-addr").value.trim()));
  if (r) show("out-admin", "ok", `ISSUER_ROLE diberikan.<br>Tx: ${esc(r.tx.hash)}`);
}
async function setPause(on) {
  const r = await sendTx("out-admin", on ? "Pause" : "Unpause", () => (on ? contract.pause() : contract.unpause()));
  if (r) show("out-admin", "ok", `${on ? "Kontrak di-pause" : "Kontrak aktif kembali"}.<br>Tx: ${esc(r.tx.hash)}`);
}

async function loadEvents() {
  const [iss, rev] = await Promise.all([contract.queryFilter(contract.filters.CredentialIssued(), 0), contract.queryFilter(contract.filters.CredentialRevoked(), 0)]);
  const rows = [...iss, ...rev].sort((a, b) => b.blockNumber - a.blockNumber || b.index - a.index);
  $("events").innerHTML = rows.length ? rows.map((e) => {
    const isIssue = e.fragment.name === "CredentialIssued";
    return `<tr><td>${e.blockNumber}</td><td>${e.fragment.name}</td><td title="${esc(e.args[0])}">${short(e.args[0])}</td><td title="${esc(e.args[1])}">${short(e.args[1])}</td><td title="${esc(e.transactionHash)}">${short(e.transactionHash)}</td></tr>`;
  }).join("") : '<tr><td colspan="5">Belum ada event.</td></tr>';
}

$("btn-connect").onclick = connect;
$("btn-salt").onclick = () => { $("i-salt").value = randomSalt(); refreshHashes(); };
$("btn-issue").onclick = issue;
$("btn-verify").onclick = verify;
$("btn-revoke").onclick = revoke;
$("btn-grant").onclick = grant;
$("btn-pause").onclick = () => setPause(true);
$("btn-unpause").onclick = () => setPause(false);
$("btn-events").onclick = loadEvents;
["i-doc", "i-salt", "v-doc", "v-salt"].forEach((id) => $(id).addEventListener("input", refreshHashes));
if (window.ethereum && window.ethereum.on) {
  window.ethereum.on("accountsChanged", () => location.reload());
  window.ethereum.on("chainChanged", () => location.reload());
}
if (!CFG) $("out-conn").outerHTML = '<div class="out err">contract-config.js belum ada. Jalankan: npm run deploy:local</div>';
   // Sambung otomatis bila wallet sudah pernah diizinkan (mis. setelah halaman reload karena ganti jaringan)
   window.addEventListener("load", async () => {
     try {
       if (!window.ethereum || !CFG) return;
       const accts = await window.ethereum.request({ method: "eth_accounts" });
       if (accts.length) connect();
     } catch (_) { /* abaikan; pengguna dapat menekan tombol hubungkan */ }
   });

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AcademicVerifier v3
 * @notice Registri hash kredensial akademik untuk konsorsium perguruan tinggi.
 * @dev Hanya hash dan status yang disimpan on-chain. Dokumen, salt, dan data pribadi off-chain.
 *      v2: issuer per kredensial, holderRef, revoke oleh issuer asal/admin, pause, custom error.
 *      v3 (perbaikan audit, lihat docs/AUDIT.md):
 *        - A-01: admin terakhir tidak dapat dicabut/mundur (penghitung admin + LastAdmin)
 *        - A-02: admin dapat membekukan semua terbitan issuer sejak waktu kebocoran kunci
 *        - A-03: holderRef nol ditolak (validasi input)
 */
contract AcademicVerifier is AccessControl, Pausable {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum Status {
        None, // belum terdaftar (default mapping)
        Valid,
        Revoked,
        IssuerInvalidated // terbitan issuer yang dibekukan sejak waktu kebocoran
    }

    struct Credential {
        address issuer; // institusi penerbit
        uint64 issuedAt; // block.timestamp saat terbit
        uint64 revokedAt; // 0 bila belum dicabut
        Status status; // status tersimpan: None/Valid/Revoked
        bytes32 holderRef; // keccak256(wallet lulusan, salt) dihitung off-chain; bukan alamat langsung
    }

    mapping(bytes32 => Credential) private _credentials;
    /// @notice Bila bukan nol: terbitan issuer ini pada atau setelah waktu tersebut dianggap tidak sah.
    mapping(address => uint64) public issuerInvalidFrom;
    /// @notice Jumlah pemegang DEFAULT_ADMIN_ROLE; selalu >= 1 (A-01).
    uint256 public adminCount;

    event CredentialIssued(bytes32 indexed docHash, address indexed issuer, bytes32 holderRef);
    event CredentialRevoked(bytes32 indexed docHash, address indexed revokedBy);
    event IssuerInvalidated(address indexed issuer, uint64 fromTimestamp, address indexed by);

    error InvalidHash();
    error InvalidHolderRef();
    error AlreadyRegistered(bytes32 docHash);
    error NotFound(bytes32 docHash);
    error AlreadyRevoked(bytes32 docHash);
    error NotIssuerOrAdmin(address caller);
    error ZeroAddress();
    error LastAdmin();
    error InvalidTimestamp();
    error AlreadyInvalidated(address issuer);

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
    }

    /// @notice Terbitkan kredensial baru. Hanya ISSUER_ROLE, tidak saat pause.
    function issueCredential(bytes32 docHash, bytes32 holderRef)
        external
        onlyRole(ISSUER_ROLE)
        whenNotPaused
    {
        if (docHash == bytes32(0)) revert InvalidHash();
        if (holderRef == bytes32(0)) revert InvalidHolderRef();
        if (_credentials[docHash].status != Status.None) revert AlreadyRegistered(docHash);

        _credentials[docHash] = Credential({
            issuer: msg.sender,
            issuedAt: uint64(block.timestamp),
            revokedAt: 0,
            status: Status.Valid,
            holderRef: holderRef
        });
        emit CredentialIssued(docHash, msg.sender, holderRef);
    }

    /// @notice Cabut kredensial. Hanya issuer asal atau admin. Tetap bisa saat pause.
    function revokeCredential(bytes32 docHash) external {
        Credential storage c = _credentials[docHash];
        if (c.status == Status.None) revert NotFound(docHash);
        if (c.status == Status.Revoked) revert AlreadyRevoked(docHash);
        if (msg.sender != c.issuer && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotIssuerOrAdmin(msg.sender);
        }

        c.status = Status.Revoked;
        c.revokedAt = uint64(block.timestamp);
        emit CredentialRevoked(docHash, msg.sender);
    }

    /**
     * @notice Respons insiden kunci issuer bocor: cabut ISSUER_ROLE dan bekukan semua terbitannya
     *         sejak `fromTimestamp` (waktu perkiraan kebocoran). Terbitan sebelum waktu itu tetap valid.
     * @dev Batas hanya boleh dimundurkan (lebih awal) pada pemanggilan berikutnya, tidak dimajukan.
     */
    function invalidateIssuer(address issuer, uint64 fromTimestamp) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (fromTimestamp == 0 || fromTimestamp > block.timestamp) revert InvalidTimestamp();
        uint64 current = issuerInvalidFrom[issuer];
        if (current != 0 && fromTimestamp >= current) revert AlreadyInvalidated(issuer);

        issuerInvalidFrom[issuer] = fromTimestamp;
        _revokeRole(ISSUER_ROLE, issuer);
        emit IssuerInvalidated(issuer, fromTimestamp, msg.sender);
    }

    /// @notice true hanya bila terdaftar, belum dicabut, dan penerbitnya belum dibekukan pada waktu terbit.
    function verifyCredential(bytes32 docHash) external view returns (bool) {
        return _effectiveStatus(_credentials[docHash]) == Status.Valid;
    }

    /// @notice Detail untuk verifier (status efektif, penerbit, waktu).
    function getCredential(bytes32 docHash)
        external
        view
        returns (Status status, address issuer, uint64 issuedAt, uint64 revokedAt)
    {
        Credential storage c = _credentials[docHash];
        return (_effectiveStatus(c), c.issuer, c.issuedAt, c.revokedAt);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function _effectiveStatus(Credential storage c) private view returns (Status) {
        if (c.status == Status.Valid) {
            uint64 from = issuerInvalidFrom[c.issuer];
            if (from != 0 && c.issuedAt >= from) return Status.IssuerInvalidated;
        }
        return c.status;
    }

    /// @dev A-01: hitung admin agar admin terakhir tidak dapat hilang (renounceRole/revokeRole).
    function _grantRole(bytes32 role, address account) internal virtual override returns (bool granted) {
        granted = super._grantRole(role, account);
        if (granted && role == DEFAULT_ADMIN_ROLE) adminCount++;
    }

    function _revokeRole(bytes32 role, address account) internal virtual override returns (bool revoked) {
        if (role == DEFAULT_ADMIN_ROLE && hasRole(role, account) && adminCount == 1) revert LastAdmin();
        revoked = super._revokeRole(role, account);
        if (revoked && role == DEFAULT_ADMIN_ROLE) adminCount--;
    }
}

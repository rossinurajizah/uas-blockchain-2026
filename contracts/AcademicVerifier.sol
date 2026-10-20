// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/**
 * @title AcademicVerifier v2
 * @notice Registri hash kredensial akademik untuk konsorsium perguruan tinggi.
 * @dev Hanya hash dan status yang disimpan on-chain. Dokumen, salt, dan data pribadi off-chain.
 *      Perubahan dari v1 (lihat docs/DESIGN.md):
 *        - issuer disimpan per kredensial (sebelumnya hanya tertulis di desain)
 *        - alamat wallet lulusan diganti holderRef (hash buram) agar tidak bisa dikorelasikan
 *        - revoke oleh issuer asal ATAU admin (sebelumnya hanya admin)
 *        - admin dan issuer dipisah (admin tidak otomatis menjadi issuer)
 *        - pause hanya menghentikan penerbitan; verifikasi dan pencabutan tetap jalan
 *        - custom error dan enum status menggantikan string revert dan bool
 */
contract AcademicVerifier is AccessControl, Pausable {
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    enum Status {
        None, // belum terdaftar (default mapping)
        Valid,
        Revoked
    }

    struct Credential {
        address issuer; // institusi penerbit
        uint64 issuedAt; // block.timestamp saat terbit
        uint64 revokedAt; // 0 bila belum dicabut
        Status status;
        bytes32 holderRef; // keccak256(wallet lulusan, salt) dihitung off-chain; bukan alamat langsung
    }

    mapping(bytes32 => Credential) private _credentials;

    event CredentialIssued(bytes32 indexed docHash, address indexed issuer, bytes32 holderRef);
    event CredentialRevoked(bytes32 indexed docHash, address indexed revokedBy);

    error InvalidHash();
    error AlreadyRegistered(bytes32 docHash);
    error NotFound(bytes32 docHash);
    error AlreadyRevoked(bytes32 docHash);
    error NotIssuerOrAdmin(address caller);
    error ZeroAddress();

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

    /// @notice true hanya bila terdaftar dan belum dicabut.
    function verifyCredential(bytes32 docHash) external view returns (bool) {
        return _credentials[docHash].status == Status.Valid;
    }

    /// @notice Detail untuk verifier (status, penerbit, waktu).
    function getCredential(bytes32 docHash)
        external
        view
        returns (Status status, address issuer, uint64 issuedAt, uint64 revokedAt)
    {
        Credential storage c = _credentials[docHash];
        return (c.status, c.issuer, c.issuedAt, c.revokedAt);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}

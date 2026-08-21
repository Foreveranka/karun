// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {INativeQueryVerifier} from "./interfaces/INativeQueryVerifier.sol";

/// @title KarunAscBase
/// @notice Karun'un Attestcoin Smart Contract (ASC) tabani. Kaynak zincir islemlerini
///         Block Prover Precompile (0x...0FD2) ile dogrular, tekrar oynatmayi engeller.
/// @dev Precompile yalnizca islemin bloga dahil oldugunu kanitlar; islemin BASARILI
///      oldugunu (receipt status == 1) tureyen kontrat kontrol etmek ZORUNDADIR.
abstract contract KarunAscBase {
    address internal constant PRECOMPILE = 0x0000000000000000000000000000000000000FD2;

    INativeQueryVerifier public immutable VERIFIER;

    mapping(bytes32 => bool) public processedQueries;

    event QueryProcessed(bytes32 indexed queryId, uint64 indexed chainKey, uint64 blockHeight);

    /// @param verifierOverride test icin dogrulayici adresi; sifir adres verilirse precompile kullanilir
    constructor(address verifierOverride) {
        VERIFIER = INativeQueryVerifier(verifierOverride == address(0) ? PRECOMPILE : verifierOverride);
    }

    /// @notice Kaniti dogrular, tekrar oynatmayi engeller ve queryId dondurur.
    function _verifyQuery(
        uint64 chainKey,
        uint64 blockHeight,
        bytes calldata encodedTransaction,
        bytes32 merkleRoot,
        INativeQueryVerifier.MerkleProofEntry[] calldata siblings,
        bytes32 lowerEndpointDigest,
        bytes32[] calldata continuityRoots
    ) internal returns (bytes32 queryId) {
        INativeQueryVerifier.MerkleProof memory merkleProof =
            INativeQueryVerifier.MerkleProof({root: merkleRoot, siblings: siblings});

        uint64 txIndex = VERIFIER.calculateTxIndex(merkleProof);
        queryId = keccak256(abi.encodePacked(chainKey, blockHeight, txIndex));
        require(!processedQueries[queryId], "Karun: sorgu islendi");

        INativeQueryVerifier.ContinuityProof memory continuityProof =
            INativeQueryVerifier.ContinuityProof({lowerEndpointDigest: lowerEndpointDigest, roots: continuityRoots});

        bool verified = VERIFIER.verifyAndEmit(chainKey, blockHeight, encodedTransaction, merkleProof, continuityProof);
        require(verified, "Karun: kanit gecersiz");

        processedQueries[queryId] = true;
        emit QueryProcessed(queryId, chainKey, blockHeight);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {INativeQueryVerifier} from "../interfaces/INativeQueryVerifier.sol";

/// @notice YEREL SIMULASYON icin dogrulayici. Gercek agda Block Prover
///         Precompile (0x0FD2) kullanilir; bu kontrat yalnizca uctan uca
///         akisi zincir kanitlari olmadan calistirmak icindir.
contract SimVerifier is INativeQueryVerifier {
    bool public sonuc = true;
    uint64 public txIndex;

    function ayarla(bool sonuc_, uint64 txIndex_) external {
        sonuc = sonuc_;
        txIndex = txIndex_;
    }

    function verifyAndEmit(uint64, uint64, bytes calldata, MerkleProof calldata, ContinuityProof calldata)
        external
        view
        returns (bool)
    {
        return sonuc;
    }

    function calculateTxIndex(MerkleProof calldata) external view returns (uint64) {
        return txIndex;
    }
}

/**
 * Authoritative Verification Status Service
 * 
 * Computes authoritative verification statuses and sanitizes sensitive internal
 * identifiers (raw IPFS CIDs, blockchain transaction hashes, SHA-256 file hashes,
 * encryption keys, and internal quarantine storage paths) from user-facing API responses.
 * 
 * Internal database records, blockchain verification services, audit logs,
 * and recovery routines preserve all real identifiers intact.
 */

/**
 * Compute authoritative verification statuses for a PendingUploadRequest or Evidence record.
 * 
 * Statuses:
 * - IPFS Storage: 'Verified' | 'Pending' | 'Failed'
 * - Blockchain Integrity: 'Verified' | 'Awaiting Confirmation' | 'Pending' | 'Failed'
 * - Evidence Integrity Check: 'Passed' | 'Pending' | 'Failed'
 * - Evidence Status: 'Processing' | 'Finalized' | 'Rejected'
 * - Last Verified: ISO date string | null
 */
function computeVerificationStatus(record) {
    if (!record) {
        return {
            ipfsStorage: 'Pending',
            blockchainIntegrity: 'Pending',
            integrityCheck: 'Pending',
            evidenceStatus: 'Processing',
            lastVerified: null
        };
    }

    const workflowStatus = record.workflowStatus || record.status;
    const isFinalized = workflowStatus === 'FINALIZED' || workflowStatus === 'stored_on_chain';
    const isRejected = workflowStatus === 'REJECTED' || workflowStatus === 'rejected';
    const isFailed = workflowStatus === 'PROCESSING_FAILED' || workflowStatus === 'error' || Boolean(record.systemFinalization?.error);

    // Has IPFS CID been confirmed
    const hasIpfsCid = Boolean(record.systemFinalization?.ipfsCID || record.ipfsCID);
    // Has blockchain transaction been confirmed
    const hasBlockchainTx = Boolean(record.systemFinalization?.blockchainTxHash || record.blockchainTxHash);

    // 1. IPFS Storage Status
    let ipfsStorage = 'Pending';
    if (isFinalized && hasIpfsCid) {
        ipfsStorage = 'Verified';
    } else if (hasIpfsCid && ['IPFS_STORED', 'BLOCKCHAIN_PENDING', 'stored_ipfs'].includes(workflowStatus)) {
        ipfsStorage = 'Verified';
    } else if (isFailed && !hasIpfsCid) {
        ipfsStorage = 'Failed';
    } else if (isRejected) {
        ipfsStorage = 'Failed';
    }

    // 2. Blockchain Integrity Status
    let blockchainIntegrity = 'Pending';
    if (isFinalized && hasBlockchainTx) {
        blockchainIntegrity = 'Verified';
    } else if (record.blockchainStatus === 'confirmed' && hasBlockchainTx) {
        blockchainIntegrity = 'Verified';
    } else if (workflowStatus === 'BLOCKCHAIN_PENDING' || record.blockchainStatus === 'pending') {
        blockchainIntegrity = 'Awaiting Confirmation';
    } else if (isFailed && !hasBlockchainTx) {
        blockchainIntegrity = 'Failed';
    } else if (isRejected) {
        blockchainIntegrity = 'Failed';
    } else if (record.blockchainRequested === false) {
        blockchainIntegrity = 'Pending';
    }

    // 3. Evidence Integrity Check Status
    let integrityCheck = 'Pending';
    if (isFinalized || record.integrityVerified === true) {
        integrityCheck = 'Passed';
    } else if (isFailed || isRejected) {
        integrityCheck = 'Failed';
    }

    // 4. Evidence Overall Status
    let evidenceStatus = 'Processing';
    if (isFinalized) {
        evidenceStatus = 'Finalized';
    } else if (isRejected) {
        evidenceStatus = 'Rejected';
    } else if (['APPROVED_PROCESSING', 'IPFS_STORED', 'BLOCKCHAIN_PENDING', 'PENDING_REVIEW', 'processing'].includes(workflowStatus)) {
        evidenceStatus = 'Processing';
    }

    // 5. Last Verified Timestamp
    let lastVerified = null;
    if (isFinalized || record.integrityVerified) {
        lastVerified = record.systemFinalization?.finalizedAt ||
            record.verifiedAt ||
            record.updatedAt ||
            record.createdAt ||
            null;
        if (lastVerified instanceof Date) {
            lastVerified = lastVerified.toISOString();
        }
    }

    return {
        ipfsStorage,
        blockchainIntegrity,
        integrityCheck,
        evidenceStatus,
        lastVerified
    };
}

/**
 * Sanitize a pending upload request for client-facing presentation.
 * Strips raw hashes, IPFS CIDs, tx hashes, DEK envelopes, and internal quarantine paths.
 */
function sanitizePendingUploadForClient(doc) {
    if (!doc) return null;
    const raw = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };

    const verification = computeVerificationStatus(raw);

    // Remove sensitive encryption keys and quarantine file paths
    delete raw.dekEnvelope;
    delete raw.quarantineStorageReference;

    // Remove raw identifiers from client view
    delete raw.fileHash;

    if (raw.systemFinalization) {
        const hasIpfs = Boolean(raw.systemFinalization.ipfsCID);
        const hasTx = Boolean(raw.systemFinalization.blockchainTxHash);
        const errorMsg = raw.systemFinalization.error;

        // Clean error messages so internal paths/keys are not leaked
        let sanitizedError = null;
        if (errorMsg) {
            sanitizedError = String(errorMsg)
                .replace(/0x[a-fA-F0-9]{40,64}/g, '[redacted]')
                .replace(/Qm[1-9A-HJ-NP-Za-km-z]{44,}|bafy[a-z0-9]{55,}|bafk[a-z0-9]{55,}/g, '[redacted]')
                .replace(/[A-Za-z]:\\[^"'\n]+/g, '[internal storage]');
        }

        raw.systemFinalization = {
            finalizedAt: raw.systemFinalization.finalizedAt,
            ipfsStored: hasIpfs,
            blockchainConfirmed: hasTx,
            error: sanitizedError,
            retryCount: raw.systemFinalization.retryCount || 0
        };
    }

    raw.verification = verification;
    return raw;
}

/**
 * Sanitize finalized Evidence document for client-facing presentation.
 */
function sanitizeEvidenceForClient(doc, options = {}) {
    if (!doc) return null;
    const raw = typeof doc.toObject === 'function' ? doc.toObject() : { ...doc };

    const verification = computeVerificationStatus(raw);

    // Remove keys and encryption metadata
    delete raw.encryption;
    delete raw.encryptedDEKs;

    // Unless specifically required for internal MetaMask signing payload
    if (!options.preserveRawForSigner) {
        delete raw.fileHash;
        delete raw.ipfsCID;
        delete raw.blockchainTxHash;
    }

    raw.verification = verification;
    return raw;
}

module.exports = {
    computeVerificationStatus,
    sanitizePendingUploadForClient,
    sanitizeEvidenceForClient
};

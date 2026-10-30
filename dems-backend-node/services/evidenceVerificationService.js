const EvidenceModel = require('../model/evidenceModel');
const PendingUploadRequest = require('../model/pendingUploadRequestModel');
const { getOnChainEvidence } = require('./blockchainService');
const { decryptFile, computeSha256 } = require('./cryptoService');
const { fetchEncryptedBlobFromIpfs } = require('./ipfsService');
const { canVerifyEvidence } = require('./accessControl');
const { writeAuditLog } = require('./auditService');

function normalizeHash(value) {
    return String(value || '').trim().toLowerCase().replace(/^0x/, '');
}

function normalizeWallet(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeId(value) {
    return String(value || '').trim().toLowerCase();
}

function cidEquals(left, right) {
    return String(left || '').trim() === String(right || '').trim();
}

function buildMismatch(field, expected, actual) {
    return { field, expected, actual };
}

function buildCheck({ field, label, mongodb = null, ipfs = null, blockchain = null, matched, status }) {
    return {
        field,
        label,
        mongodb,
        ipfs,
        blockchain,
        matched: Boolean(matched),
        status: status || (matched ? 'MATCH' : 'MISMATCH')
    };
}

function assertCanVerify(evidence, requester) {
    if (!requester) {
        const error = new Error('Authentication is required to verify evidence.');
        error.statusCode = 401;
        throw error;
    }

    if (!canVerifyEvidence(requester, evidence)) {
        const error = new Error('You are not authorized to verify this evidence.');
        error.statusCode = 403;
        throw error;
    }
}

function isAvailabilityError(error) {
    return [
        'CONTRACT_NOT_DEPLOYED',
        'CONTRACT_CALL_FAILED',
        'CONTRACT_NOT_CONFIGURED',
        'RPC_NOT_CONFIGURED',
        'RPC_UNAVAILABLE'
    ].includes(error?.code);
}

async function verifyEvidenceIntegrity(evidenceId, requester) {
    const evidence = await EvidenceModel.findById(evidenceId).select(
        '_id user organizationId fileHash ipfsCID UploaderWallet blockchainTxHash blockchainStatus blockchainRequested encryption createdAt status'
    );

    if (!evidence) {
        const error = new Error('Evidence not found.');
        error.statusCode = 404;
        throw error;
    }

    assertCanVerify(evidence, requester);

    const stages = {
        mongodb: { available: true, detail: 'Evidence metadata loaded from MongoDB.' },
        ipfs: { available: false, detail: 'IPFS was not checked.' },
        blockchain: { available: false, detail: 'Blockchain was not checked.' }
    };

    let generatedHash = null;
    if (!evidence.ipfsCID) {
        stages.ipfs = { available: false, detail: 'Evidence does not have an IPFS CID.' };
    } else if (!evidence.encryption?.iv || !evidence.encryption?.authTag) {
        stages.ipfs = { available: false, detail: 'Evidence encryption metadata is missing.' };
    } else {
        try {
            const encryptedBuffer = await fetchEncryptedBlobFromIpfs(evidence.ipfsCID);
            try {
                const decryptedBuffer = decryptFile(encryptedBuffer, evidence.encryption);
                generatedHash = computeSha256(decryptedBuffer);
                stages.ipfs = { available: true, detail: 'IPFS content was retrieved and decrypted.' };
            } catch {
                stages.ipfs = { available: true, detail: 'IPFS content was retrieved but could not be decrypted with stored keys.' };
            }
        } catch (error) {
            stages.ipfs = { available: false, detail: error.message || 'IPFS content could not be retrieved.' };
        }
    }

    let onChain = null;
    let pendingUploadDoc = null;
    const chainRequested = Boolean(evidence.blockchainRequested) || evidence.blockchainStatus === 'confirmed' || Boolean(evidence.blockchainTxHash);

    if (!chainRequested) {
        stages.blockchain = { available: false, detail: 'Blockchain registration was not requested for this evidence.' };
    } else {
        try {
            onChain = await getOnChainEvidence(evidence._id.toString());
            stages.blockchain = { available: true, detail: 'On-chain evidence record was read.' };
        } catch (error) {
            if (error.code === 'EVIDENCE_NOT_ON_CHAIN') {
                pendingUploadDoc = await PendingUploadRequest.findOne({ 'systemFinalization.evidenceId': evidence._id }).select('evidenceId');
                if (pendingUploadDoc?.evidenceId) {
                    try {
                        onChain = await getOnChainEvidence(pendingUploadDoc.evidenceId);
                        stages.blockchain = { available: true, detail: 'On-chain evidence record was read.' };
                    } catch (innerErr) {
                        stages.blockchain = { available: false, detail: 'Evidence is not registered on the configured contract.' };
                    }
                } else {
                    stages.blockchain = { available: false, detail: 'Evidence is not registered on the configured contract.' };
                }
            } else if (isAvailabilityError(error)) {
                stages.blockchain = { available: false, detail: error.message };
            } else {
                stages.blockchain = { available: false, detail: error.message || 'Blockchain lookup failed.' };
            }
        }
    }

    const mongoFileHash = normalizeHash(evidence.fileHash);
    const mongoIpfsCID = String(evidence.ipfsCID || '').trim();
    const mongoUploader = normalizeWallet(evidence.UploaderWallet);
    const mongoEvidenceId = normalizeId(evidence._id);
    const chainFileHash = normalizeHash(onChain?.fileHash);
    const chainIpfsCID = String(onChain?.ipfsCID || '').trim();
    const chainUploader = normalizeWallet(onChain?.uploadedBy);
    const chainEvidenceId = normalizeId(onChain?.evidenceId);
    const ipfsContentHash = normalizeHash(generatedHash);

    const mongoEqualsIpfs = Boolean(mongoFileHash && ipfsContentHash && mongoFileHash === ipfsContentHash);
    const mongoEqualsChain = Boolean(onChain && mongoFileHash && chainFileHash && mongoFileHash === chainFileHash);
    const ipfsEqualsChain = Boolean(onChain && ipfsContentHash && chainFileHash && ipfsContentHash === chainFileHash);
    const hashesAligned = stages.ipfs.available && stages.blockchain.available
        ? (mongoEqualsIpfs && mongoEqualsChain && ipfsEqualsChain)
        : false;
    const cidMatched = Boolean(onChain && cidEquals(mongoIpfsCID, chainIpfsCID));
    const uploaderMatched = Boolean(onChain && mongoUploader && chainUploader && mongoUploader === chainUploader);
    const evidenceIdMatched = Boolean(onChain && ((mongoEvidenceId && chainEvidenceId && mongoEvidenceId === chainEvidenceId) || (pendingUploadDoc && normalizeId(pendingUploadDoc.evidenceId) === chainEvidenceId)));

    const incomplete = !stages.ipfs.available || (chainRequested && !stages.blockchain.available);

    const checks = [
        buildCheck({
            field: 'mongoFileHash',
            label: 'MongoDB Hash',
            mongodb: evidence.fileHash,
            ipfs: generatedHash,
            blockchain: onChain?.fileHash || null,
            matched: incomplete ? false : hashesAligned,
            status: !stages.ipfs.available || (chainRequested && !stages.blockchain.available) ? 'INCOMPLETE' : (hashesAligned ? 'MATCH' : 'MISMATCH')
        }),
        buildCheck({
            field: 'ipfsContentHash',
            label: 'IPFS Content Hash',
            mongodb: evidence.fileHash,
            ipfs: generatedHash,
            blockchain: onChain?.fileHash || null,
            matched: incomplete ? false : hashesAligned,
            status: !stages.ipfs.available ? 'INCOMPLETE' : (hashesAligned ? 'MATCH' : 'MISMATCH')
        }),
        buildCheck({
            field: 'blockchainHash',
            label: 'Blockchain Hash',
            mongodb: evidence.fileHash,
            ipfs: generatedHash,
            blockchain: onChain?.fileHash || null,
            matched: incomplete ? false : hashesAligned,
            status: chainRequested && !stages.blockchain.available ? 'INCOMPLETE' : (!chainRequested ? 'NOT_REQUESTED' : (hashesAligned ? 'MATCH' : 'MISMATCH'))
        }),
        buildCheck({
            field: 'ipfsCID',
            label: 'IPFS CID',
            mongodb: evidence.ipfsCID,
            ipfs: evidence.ipfsCID,
            blockchain: onChain?.ipfsCID || null,
            matched: cidMatched,
            status: !stages.blockchain.available && chainRequested ? 'INCOMPLETE' : (cidMatched ? 'MATCH' : 'MISMATCH')
        }),
        buildCheck({
            field: 'uploadedBy',
            label: 'Uploader',
            mongodb: evidence.UploaderWallet,
            blockchain: onChain?.uploadedBy || null,
            matched: uploaderMatched,
            status: !stages.blockchain.available && chainRequested ? 'INCOMPLETE' : (uploaderMatched ? 'MATCH' : 'MISMATCH')
        }),
        buildCheck({
            field: 'evidenceId',
            label: 'Evidence ID',
            mongodb: evidence._id.toString(),
            blockchain: onChain?.evidenceId || null,
            matched: evidenceIdMatched,
            status: !stages.blockchain.available && chainRequested ? 'INCOMPLETE' : (evidenceIdMatched ? 'MATCH' : 'MISMATCH')
        })
    ];

    const comparisons = {
        hashMatched: mongoEqualsChain,
        cidMatched,
        generatedHashMatched: ipfsEqualsChain,
        uploaderMatched,
        evidenceIdMatched,
        mongoHashMatched: mongoEqualsIpfs,
        hashesAligned,
        proofPresent: Boolean(onChain),
        stages
    };

    const mismatches = checks
        .filter((check) => check.status === 'MISMATCH')
        .map((check) => buildMismatch(
            check.field,
            check.blockchain,
            check.mongodb ?? check.ipfs
        ));

    const allChecksPassed = !incomplete && hashesAligned && cidMatched && uploaderMatched && evidenceIdMatched;
    let verificationStatus = 'INTEGRITY_MISMATCH';
    let message = 'INTEGRITY FAILURE. Possible evidence mismatch detected.';

    if (allChecksPassed) {
        verificationStatus = 'VERIFIED';
        message = 'INTEGRITY VERIFIED. MongoDB metadata, recovered IPFS content, and the blockchain proof match. No tampering detected.';
    } else if (incomplete) {
        verificationStatus = 'VERIFICATION_INCOMPLETE';
        const failedStages = Object.entries(stages)
            .filter(([, stage]) => !stage.available)
            .map(([name, stage]) => `${name}: ${stage.detail}`)
            .join(' ');
        message = `Verification is incomplete. ${failedStages}`;
    }

    const blockchainData = onChain
        ? {
            evidenceId: onChain.evidenceId,
            fileHash: onChain.fileHash,
            ipfsCID: onChain.ipfsCID,
            uploadedAt: onChain.uploadedAt,
            uploadedBy: onChain.uploadedBy,
            aiScore: onChain.aiScore,
            transactionHash: evidence.blockchainTxHash || null
        }
        : null;

    evidence.integrityVerified = allChecksPassed;
    await evidence.save();

    await writeAuditLog({
        actor: requester,
        organizationId: evidence.organizationId,
        action: 'integrity_verification',
        targetType: 'evidence',
        targetId: evidence._id,
        result: allChecksPassed ? 'success' : (incomplete ? 'incomplete' : 'mismatch'),
        metadata: { verificationStatus, stages }
    });

    const sanitizedChecks = checks.map((c) => ({
        field: c.field,
        label: c.label,
        mongodb: c.status === 'MATCH' ? 'Matched' : (c.mongodb ? 'Available' : '—'),
        ipfs: c.status === 'MATCH' ? 'Matched' : (c.ipfs ? 'Available' : '—'),
        blockchain: c.status === 'MATCH' ? 'Matched' : (c.blockchain ? 'Available' : '—'),
        matched: c.matched,
        status: c.status
    }));

    const sanitizedMismatches = mismatches.map((m) => ({
        field: m.field,
        expected: 'Recorded proof',
        actual: 'Mismatch detected'
    }));

    return {
        verificationStatus,
        verifiedAt: new Date().toISOString(),
        verification: {
            ipfsStorage: stages.ipfs.available ? 'Verified' : 'Failed',
            blockchainIntegrity: stages.blockchain.available ? 'Verified' : 'Failed',
            integrityCheck: allChecksPassed ? 'Passed' : 'Failed',
            evidenceStatus: 'Finalized',
            lastVerified: new Date().toISOString()
        },
        checks: sanitizedChecks,
        comparisons,
        mismatches: sanitizedMismatches,
        stages,
        message
    };
}

module.exports = {
    verifyEvidenceIntegrity
};

const fs = require('fs');
const { ethers } = require('ethers');
const EvidenceModel = require('../model/evidenceModel');
const QuarantineEvidence = require('../model/quarantineEvidenceModel');
const { decryptFile } = require('../services/cryptoService');
const { fetchEncryptedBlobFromIpfs } = require('../services/ipfsService');
const { processEvidenceUpload, blockchainPayload } = require('../services/evidencePipelineService');
const { getOnChainEvidence, evidenceExists } = require('../services/blockchainService');
const { canAccessEvidence, isAdmin, isEmployee, isEvidenceOwner, httpError } = require('../services/accessControl');
const { writeAuditLog } = require('../services/auditService');
const { getOrganizationPolicy } = require('../services/organizationService');
const { validateEvidenceImageType } = require('../services/imageValidationService');

const getFileBuffer = (file) => {
    if (file.buffer) return file.buffer;
    if (file.path) return fs.readFileSync(file.path);
    throw httpError(400, 'Uploaded file could not be read.');
};

const cleanupUploadedFile = (file) => {
    if (!file?.path) return;
    fs.unlink(file.path, (err) => {
        if (err) {
            console.error('[CLEANUP] Delete failed:', err.message);
        }
    });
};

const uploadEvidence = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No evidence file provided.' });
        }

        const fileBuffer = getFileBuffer(req.file);
        const imageValidation = validateEvidenceImageType(fileBuffer, req.file.mimetype, req.file.originalname);
        if (!imageValidation.valid) {
            return res.status(400).json({ success: false, message: imageValidation.reason });
        }
        req.file.mimetype = imageValidation.mimeType;
        const uploadBody = { ...req.body };
        
        // Make caseId optional - allow uploads without caseId
        if (!uploadBody.caseId) {
            uploadBody.caseId = null;
        }
        
        const result = await processEvidenceUpload({
            user: req.user,
            file: req.file,
            fileBuffer,
            body: uploadBody
        });

        return res.status(result.requiresConfirmation ? 200 : 201).json({
            success: true,
            ...result
        });
    } catch (err) {
        if (err instanceof SyntaxError) {
            return res.status(400).json({ success: false, message: 'captureMetadata must be valid JSON.' });
        }
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    } finally {
        cleanupUploadedFile(req.file);
    }
};

const getUploadPolicy = async (req, res, next) => {
    try {
        const policy = await getOrganizationPolicy(req.user.organizationId);
        return res.status(200).json({
            success: true,
            data: {
                role: req.user.role,
                organizationId: req.user.organizationId || null,
                requireAIForEmployees: isEmployee(req.user) ? policy.requireAIForEmployees : false,
                requireBlockchainForEmployees: isEmployee(req.user) ? policy.requireBlockchainForEmployees : false,
                aiOptional: !isEmployee(req.user) || !policy.requireAIForEmployees,
                blockchainOptional: !isEmployee(req.user) || !policy.requireBlockchainForEmployees
            }
        });
    } catch (err) {
        next(err);
    }
};

const getMyFiles = async (req, res, next) => {
    try {
        const walletAddress = String(req.user?.walletAddress || '').toLowerCase();
        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
        const skip = (page - 1) * limit;
        const filter = { UploaderWallet: walletAddress };

        const [totalRecords, evidence, quarantine] = await Promise.all([
            EvidenceModel.countDocuments(filter),
            EvidenceModel.find(filter)
                .select('_id fileName ipfsCID fileHash fileSize mimeType status createdAt caseId blockchainTxHash blockchainStatus storageStatus reviewStatus processingStatus aiAnalysis organizationId versionNumber')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            isEmployee(req.user)
                ? QuarantineEvidence.find({ uploaderId: req.user.id })
                    .select('-temporaryStorageReference')
                    .sort({ createdAt: -1 })
                    .limit(50)
                : Promise.resolve([])
        ]);

        return res.status(200).json({
            success: true,
            count: evidence.length,
            data: evidence,
            quarantine: quarantine.map((record) => ({
                ...record.toObject(),
                isQuarantine: true,
                fileHash: record.originalFileHash,
                status: record.reviewStatus === 'rejected' ? 'rejected' : 'quarantine',
                storageStatus: 'quarantine',
                blockchainStatus: 'not_requested'
            })),
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit) || 1,
                hasNextPage: page < Math.ceil(totalRecords / limit),
                hasPrevPage: page > 1
            }
        });
    } catch (err) {
        next(err);
    }
};

const getOrganizationEvidence = async (req, res, next) => {
    try {
        if (!isAdmin(req.user)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to access this evidence.' });
        }

        if (!req.user.organizationId) {
            return res.status(403).json({ success: false, message: 'You must belong to an organization to access organization evidence.' });
        }

        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const skip = (page - 1) * limit;

        const search = req.query.search || '';
        const status = req.query.status;
        const blockchainStatus = req.query.blockchainStatus;
        const storageStatus = req.query.storageStatus;
        const uploaderWallet = req.query.uploaderWallet;
        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;

        const filter = { organizationId: req.user.organizationId };

        if (search) {
            filter.$or = [
                { fileName: { $regex: search, $options: 'i' } },
                { fileHash: { $regex: search, $options: 'i' } },
                { caseId: { $regex: search, $options: 'i' } }
            ];
        }

        if (status) {
            filter.status = status;
        }

        if (blockchainStatus) {
            filter.blockchainStatus = blockchainStatus;
        }

        if (storageStatus) {
            filter.storageStatus = storageStatus;
        }

        if (uploaderWallet) {
            filter.UploaderWallet = uploaderWallet.toLowerCase();
        }

        const [totalRecords, evidence] = await Promise.all([
            EvidenceModel.countDocuments(filter),
            EvidenceModel.find(filter)
                .select('-encryption')
                .populate('groupId', 'name')
                .sort({ [sortBy]: sortOrder })
                .skip(skip)
                .limit(limit)
        ]);

        return res.status(200).json({
            success: true,
            count: evidence.length,
            data: evidence,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit) || 1,
                hasNextPage: page < Math.ceil(totalRecords / limit),
                hasPrevPage: page > 1
            }
        });
    } catch (err) {
        next(err);
    }
};

const getEvidenceById = async (req, res, next) => {
    try {
        const { id } = req.params;
        const evidence = await EvidenceModel.findById(id);

        if (!evidence) {
            return res.status(404).json({ success: false, message: 'Evidence not found.' });
        }

        if (!(await canAccessEvidence(req.user, evidence))) {
            return res.status(403).json({ success: false, message: 'You are not authorized to access this evidence.' });
        }

        console.log('[Backend Evidence Diagnostics]', {
            evidenceId: evidence._id.toString(),
            uploaderWallet: evidence.UploaderWallet,
            authenticatedWallet: req.user.walletAddress,
            blockchainStatus: evidence.blockchainStatus,
            blockchainRequested: evidence.blockchainRequested,
            ipfsCID: evidence.ipfsCID
        });

        const canReviewImage = isAdmin(req.user);
        let fileContent = null;
        if (canReviewImage && evidence.ipfsCID && evidence.encryption?.iv && evidence.encryption?.authTag) {
            try {
                const encryptedBuffer = await fetchEncryptedBlobFromIpfs(evidence.ipfsCID);
                const originalBuffer = decryptFile(encryptedBuffer, evidence.encryption);
                fileContent = originalBuffer.toString('base64');
            } catch (err) {
                if (err.statusCode !== 422) {
                    throw err;
                }
            }
        }

        await writeAuditLog({
            actor: req.user,
            organizationId: evidence.organizationId,
            action: 'evidence_access',
            targetType: 'evidence',
            targetId: evidence._id
        });

        const evidencePayload = evidence.toObject();
        delete evidencePayload.encryption;
        delete evidencePayload.encryptedDEKs;

        const payload = blockchainPayload(evidence);
        console.log('[Backend Evidence Diagnostics] Blockchain payload:', {
            hasPayload: !!payload,
            payloadUploader: payload?.uploaderWallet,
            payloadEvidenceId: payload?.evidenceId
        });

        return res.status(200).json({
            success: true,
            data: {
                ...evidencePayload,
                ...(canReviewImage ? { fileContent } : {}),
                blockchainPayload: (evidence.blockchainStatus === 'pending' || evidence.blockchainStatus === 'failed') && evidence.ipfsCID
                    ? payload
                    : null
            }
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

const getEvidenceByCase = async (req, res, next) => {
    try {
        const caseId = String(req.params.caseId || '').trim();
        if (!caseId || caseId.length > 120) {
            return res.status(400).json({ success: false, message: 'Valid caseId is required.' });
        }

        const filter = { caseId };
        if (isAdmin(req.user)) {
            if (!req.user.organizationId) {
                return res.status(403).json({ success: false, message: 'You are not authorized to access this evidence.' });
            }
            filter.organizationId = req.user.organizationId;
        } else {
            filter.UploaderWallet = String(req.user.walletAddress).toLowerCase();
        }

        const evidence = await EvidenceModel.find(filter)
            .select('-encryption -encryptedDEKs')
            .sort({ createdAt: -1 });

        return res.status(200).json({ success: true, count: evidence.length, data: evidence });
    } catch (err) {
        next(err);
    }
};

const finalizeEvidence = async (req, res, next) => {
    try {
        const evidenceId = String(req.params.evidenceId || '').trim();
        const txHash = String(req.body.txHash || '').trim();
        const alreadyRegistered = Boolean(req.body.alreadyRegistered);

        if (!alreadyRegistered && (!txHash.startsWith('0x') || txHash.length !== 66)) {
            return res.status(400).json({ success: false, message: 'Valid blockchain transaction hash is required.' });
        }

        const evidence = await EvidenceModel.findById(evidenceId);
        if (!evidence) {
            return res.status(404).json({ success: false, message: 'Evidence record not found.' });
        }

        if (!isEvidenceOwner(req.user, evidence)) {
            return res.status(403).json({ success: false, message: 'Only the original uploader wallet can finalize the blockchain proof.' });
        }
        if (!evidence.blockchainRequested || !['pending', 'failed', 'confirmed'].includes(evidence.blockchainStatus)) {
            return res.status(409).json({ success: false, message: 'This evidence is not waiting for a blockchain proof.' });
        }

        const exists = await evidenceExists(evidence._id.toString());
        if (!exists) {
            return res.status(409).json({
                success: false,
                message: 'The blockchain transaction was not found as a registered EvidenceRegistry record. The evidence remains stored on IPFS only.'
            });
        }

        const onChain = await getOnChainEvidence(evidence._id.toString());
        const hashMatches = String(onChain.fileHash || '').toLowerCase() === String(evidence.fileHash || '').toLowerCase();
        const cidMatches = String(onChain.ipfsCID || '').trim() === String(evidence.ipfsCID || '').trim();
        if (!hashMatches || !cidMatches) {
            return res.status(409).json({
                success: false,
                message: 'On-chain evidence does not match the MongoDB file hash or IPFS CID. Blockchain status was not marked confirmed.'
            });
        }

        if (txHash.startsWith('0x') && txHash.length === 66) {
            evidence.blockchainTxHash = txHash;
        }
        evidence.blockchainRequested = true;
        evidence.blockchainStatus = 'confirmed';
        evidence.status = 'stored_on_chain';
        evidence.statusMessage = alreadyRegistered
            ? 'Existing on-chain evidence record verified and stored.'
            : 'Blockchain transaction confirmed and stored.';
        await evidence.save();

        await writeAuditLog({
            actor: req.user,
            organizationId: evidence.organizationId,
            action: 'blockchain_transaction',
            targetType: 'evidence',
            targetId: evidence._id,
            metadata: { txHash }
        });

        return res.status(200).json({
            success: true,
            message: 'Evidence finalized on-chain.',
            data: {
                ...evidence.toObject(),
                encryption: undefined,
                blockchainPayload: blockchainPayload(evidence)
            }
        });
    } catch (err) {
        next(err);
    }
};

const markBlockchainFailed = async (req, res, next) => {
    try {
        const evidence = await EvidenceModel.findById(req.params.evidenceId);
        if (!evidence) {
            return res.status(404).json({ success: false, message: 'Evidence record not found.' });
        }
        if (!isEvidenceOwner(req.user, evidence)) {
            return res.status(403).json({ success: false, message: 'Only the original uploader wallet can update this blockchain proof.' });
        }

        evidence.blockchainStatus = 'failed';
        evidence.statusMessage = 'Blockchain proof could not be created. Your evidence remains stored in IPFS.';
        await evidence.save();

        await writeAuditLog({
            actor: req.user,
            organizationId: evidence.organizationId,
            action: 'blockchain_failure',
            targetType: 'evidence',
            targetId: evidence._id,
            result: 'failed',
            reason: String(req.body.reason || '').slice(0, 500)
        });

        const payload = evidence.toObject();
        delete payload.encryption;

        return res.status(200).json({
            success: true,
            message: 'Blockchain proof could not be created. Your evidence remains stored in IPFS.',
            data: payload
        });
    } catch (err) {
        next(err);
    }
};

const retryBlockchainRegistration = async (req, res, next) => {
    try {
        const evidence = await EvidenceModel.findById(req.params.evidenceId);
        if (!evidence) {
            return res.status(404).json({ success: false, message: 'Evidence record not found.' });
        }
        if (!isEvidenceOwner(req.user, evidence)) {
            return res.status(403).json({ success: false, message: 'Only the original uploader wallet can retry blockchain proof.' });
        }
        if (!evidence.blockchainRequested || evidence.blockchainStatus !== 'failed') {
            return res.status(409).json({ success: false, message: 'This evidence is not eligible for blockchain retry.' });
        }
        if (!evidence.ipfsCID) {
            return res.status(409).json({ success: false, message: 'IPFS CID is missing. Cannot retry blockchain registration.' });
        }

        evidence.blockchainStatus = 'pending';
        evidence.status = 'pending_blockchain';
        evidence.statusMessage = 'Retrying blockchain proof registration.';
        await evidence.save();

        await writeAuditLog({
            actor: req.user,
            organizationId: evidence.organizationId,
            action: 'blockchain_retry',
            targetType: 'evidence',
            targetId: evidence._id
        });

        const payload = evidence.toObject();
        delete payload.encryption;

        return res.status(200).json({
            success: true,
            message: 'Blockchain registration retry initiated.',
            data: {
                ...payload,
                blockchainPayload: blockchainPayload(evidence)
            }
        });
    } catch (err) {
        next(err);
    }
};

const checkWalletBalance = async (req, res, next) => {
    try {
        const { address } = req.params;
        if (!address || !ethers.isAddress(address)) {
            return res.status(400).json({ success: false, message: 'Valid wallet address is required.' });
        }

        const { rpcUrl } = require('../services/blockchainService').getContractConfig();

        const provider = new ethers.JsonRpcProvider(rpcUrl);
        const balance = await provider.getBalance(address);
        const network = await provider.getNetwork();

        console.log('[Backend Wallet Balance Check]', {
            address,
            balance: ethers.formatEther(balance),
            balanceRaw: balance.toString(),
            chainId: Number(network.chainId),
            rpcUrl
        });

        return res.status(200).json({
            success: true,
            data: {
                address,
                balance: ethers.formatEther(balance),
                balanceRaw: balance.toString(),
                chainId: Number(network.chainId),
                rpcUrl
            }
        });
    } catch (err) {
        console.error('[Backend Wallet Balance Check Error]', err);
        if (err.code === 'NETWORK_ERROR' || err.code === 'TIMEOUT' || err.code === 'SERVER_ERROR') {
            return res.status(503).json({
                success: false,
                message: 'Cannot reach blockchain RPC. Ensure Hardhat node is running.',
                error: err.message
            });
        }
        return res.status(500).json({
            success: false,
            message: 'Failed to check wallet balance.',
            error: err.message
        });
    }
};

const getPlatformEvidence = async (req, res, next) => {
    try {
        // Only super admin can access platform-wide evidence
        if (req.user.role !== 'super_admin') {
            return res.status(403).json({ success: false, message: 'Only Super Admin can access platform-wide evidence data.' });
        }

        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const skip = (page - 1) * limit;

        const {
            search = '',
            status = '',
            blockchainStatus = '',
            organizationId = '',
            groupId = '',
            uploaderWallet = '',
            fileType = '',
            startDate = '',
            endDate = '',
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        const filter = {};

        if (search) {
            filter.$or = [
                { fileName: { $regex: search, $options: 'i' } },
                { fileHash: { $regex: search, $options: 'i' } },
                { caseId: { $regex: search, $options: 'i' } }
            ];
        }

        if (status) {
            filter.status = status;
        }

        if (blockchainStatus) {
            filter.blockchainStatus = blockchainStatus;
        }

        if (organizationId) {
            filter.organizationId = organizationId;
        }

        if (groupId) {
            filter.groupId = groupId;
        }

        if (uploaderWallet) {
            filter.UploaderWallet = uploaderWallet.toLowerCase();
        }

        if (fileType) {
            if (fileType === 'image') {
                filter.mimeType = { $regex: '^image/', $options: 'i' };
            } else if (fileType === 'video') {
                filter.mimeType = { $regex: '^video/', $options: 'i' };
            } else if (fileType === 'audio') {
                filter.mimeType = { $regex: '^audio/', $options: 'i' };
            } else if (fileType === 'application/pdf') {
                filter.mimeType = 'application/pdf';
            } else if (fileType === 'application') {
                filter.mimeType = { $regex: '^application/', $options: 'i', $not: /pdf$/ };
            }
        }

        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) {
                filter.createdAt.$gte = new Date(startDate);
            }
            if (endDate) {
                filter.createdAt.$lte = new Date(endDate);
            }
        }

        const [totalRecords, evidence] = await Promise.all([
            EvidenceModel.countDocuments(filter),
            EvidenceModel.find(filter)
                .select('-encryption')
                .populate('groupId', 'name')
                .populate('uploadedBy', 'profile.displayName walletAddress')
                .populate('organizationId', 'name organizationCode')
                .sort({ [sortBy]: sortOrder })
                .skip(skip)
                .limit(limit)
        ]);

        return res.status(200).json({
            success: true,
            count: evidence.length,
            data: evidence,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit)
            }
        });
    } catch (err) {
        next(err);
    }
};

module.exports = {
    getEvidenceById,
    uploadEvidence,
    getMyFiles,
    getEvidenceByCase,
    finalizeEvidence,
    getUploadPolicy,
    getOrganizationEvidence,
    getPlatformEvidence,
    markBlockchainFailed,
    retryBlockchainRegistration,
    checkWalletBalance
};

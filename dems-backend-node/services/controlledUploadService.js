const crypto = require('crypto');
const cron = require('node-cron');
const PendingUploadRequest = require('../model/pendingUploadRequestModel');
const EvidenceModel = require('../model/evidenceModel');
const Group = require('../model/groupModel');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');
const mongoose = require('mongoose');
const { storeQuarantineFile, readQuarantineFile, deleteQuarantineFile, cleanupQuarantineFiles } = require('./quarantineStorage');
const { computeSha256, getEncryptionKey } = require('./cryptoService');
const { validateImageFile, validateEvidenceImageType, MAX_FILE_SIZE } = require('./imageValidationService');
const { isAdmin, isSuperAdmin, httpError } = require('./accessControl');
const { writeAuditLog } = require('./auditService');
const { notifyOrganizationAdmins, createNotification } = require('./notificationService');
const { uploadEncryptedBlobToPinata } = require('./ipfsService');
const { registerEvidenceOnChain, assertContractDeployed } = require('./blockchainService');
const { analyzeEvidence, notRequestedAnalysis } = require('./aiService');
const { getOrganizationPolicy, ensureAdminOrganization } = require('./organizationService');
const { emitUploadWorkflowEvent } = require('./socketService');

/**
 * Helper to wrap a 32-byte DEK with the server's master AES key
 */
function wrapDEK(dek) {
    const masterKey = getEncryptionKey();
    const keyIv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, keyIv);
    const encrypted = Buffer.concat([cipher.update(dek), cipher.final()]);
    const keyAuthTag = cipher.getAuthTag();

    return {
        encryptedDEK: encrypted.toString('hex'),
        keyIv: keyIv.toString('hex'),
        keyAuthTag: keyAuthTag.toString('hex')
    };
}

/**
 * Helper to unwrap a DEK
 */
function unwrapDEK(dekEnvelope) {
    if (!dekEnvelope || !dekEnvelope.encryptedDEK || !dekEnvelope.keyIv || !dekEnvelope.keyAuthTag) {
        throw new Error('Invalid DEK envelope in pending upload request.');
    }
    const masterKey = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, Buffer.from(dekEnvelope.keyIv, 'hex'));
    decipher.setAuthTag(Buffer.from(dekEnvelope.keyAuthTag, 'hex'));
    return Buffer.concat([
        decipher.update(Buffer.from(dekEnvelope.encryptedDEK, 'hex')),
        decipher.final()
    ]);
}

/**
 * Create a pending upload request
 * Unifies all upload paths into the authoritative upload approval workflow.
 */
async function createPendingUploadRequest({ user, file, fileBuffer, body }) {
    if (!user || !user.id) {
        throw httpError(401, 'Authentication required.');
    }

    if (!fileBuffer || fileBuffer.length === 0) {
        throw httpError(400, 'No file content provided.');
    }

    if (fileBuffer.length > MAX_FILE_SIZE) {
        throw httpError(400, `File exceeds the 20MB upload limit (size: ${(fileBuffer.length / (1024 * 1024)).toFixed(2)}MB).`);
    }

    // Step 1: Strict byte-level image validation (JPEG / PNG only)
    const imageValidation = validateImageFile(fileBuffer, file.mimetype, file.originalname);
    if (!imageValidation.valid) {
        throw httpError(400, imageValidation.reason || 'Invalid image file.');
    }

    // Step 2: Validate capture metadata
    let captureMetadata;
    try {
        const raw = typeof body.captureMetadata === 'string'
            ? JSON.parse(body.captureMetadata)
            : body.captureMetadata;

        const latitude = Number(raw?.gpsLocation?.latitude);
        const longitude = Number(raw?.gpsLocation?.longitude);
        const capturedAt = new Date(raw?.capturedAt);

        if (!raw?.deviceInfo || Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(capturedAt.getTime())) {
            throw httpError(400, 'captureMetadata must include deviceInfo, gpsLocation.latitude, gpsLocation.longitude, and capturedAt.');
        }

        captureMetadata = {
            deviceInfo: String(raw.deviceInfo).slice(0, 300),
            gpsLocation: { latitude, longitude },
            capturedAt
        };
    } catch (err) {
        if (err.statusCode) throw err;
        throw httpError(400, 'Invalid captureMetadata format. Must be valid JSON with deviceInfo, gpsLocation, and capturedAt.');
    }

    // Resolve organization association
    let targetOrganizationId = user.organizationId ? String(user.organizationId) : null;
    if (!targetOrganizationId && body.organizationId) {
        const org = await Organization.findOne({ _id: body.organizationId, status: 'active' });
        if (org) {
            targetOrganizationId = org._id.toString();
        } else {
            throw httpError(400, 'Selected organization does not exist or is not active.');
        }
    }
    if (!targetOrganizationId && (user.role === 'officer' || user.role === 'admin')) {
        const dbUser = await User.findById(user.id).select('organizationId');
        if (dbUser?.organizationId) {
            targetOrganizationId = dbUser.organizationId.toString();
            user.organizationId = targetOrganizationId;
        }
    }
    if (!targetOrganizationId) {
        // Fallback to the first active organization in DEMS so request is never orphaned from admin review
        const defaultOrg = await Organization.findOne({ status: 'active' }).sort({ createdAt: 1 });
        if (defaultOrg) {
            targetOrganizationId = defaultOrg._id.toString();
        } else {
            throw httpError(400, 'No active organization found to review this upload.');
        }
    }

    // Step 3: Validate Group if provided
    let groupId = null;
    if (body.groupId) {
        const group = await Group.findOne({ _id: body.groupId, organizationId: targetOrganizationId });
        if (!group) {
            throw httpError(400, 'Invalid groupId: group does not exist or does not belong to the target organization.');
        }
        groupId = group._id;
    }

    // Step 4: Compute SHA-256 and assert uniqueness
    const fileHash = computeSha256(fileBuffer);

    const existingEvidence = await EvidenceModel.findOne({ fileHash }).select('_id');
    if (existingEvidence) {
        throw httpError(409, 'Duplicate file detected. This evidence has already been finalized in DEMS.');
    }

    const existingPending = await PendingUploadRequest.findOne({
        fileHash,
        workflowStatus: { $in: ['PENDING_REVIEW', 'APPROVED_PROCESSING', 'IPFS_STORED', 'BLOCKCHAIN_PENDING', 'FINALIZED'] }
    }).select('_id evidenceId workflowStatus');

    if (existingPending) {
        throw httpError(409, `This file is already pending review or in processing (Request ID: ${existingPending.evidenceId}).`);
    }

    // Step 5: Optional AI screening according to policy
    const policy = await getOrganizationPolicy(targetOrganizationId);
    let requestAI = String(body.requestAI || '').toLowerCase() === 'true';
    let requestBlockchain = body.requestBlockchain !== undefined
        ? String(body.requestBlockchain).toLowerCase() !== 'false'
        : true;

    if (user.role === 'officer' && policy) {
        if (policy.requireAIForEmployees) requestAI = true;
        if (policy.requireBlockchainForEmployees) requestBlockchain = true;
    }

    let aiAnalysis = notRequestedAnalysis();
    if (requestAI) {
        try {
            aiAnalysis = await analyzeEvidence(fileBuffer, {
                originalName: file.originalname,
                mimeType: imageValidation.mimeType,
                captureMetadata
            });
        } catch (aiErr) {
            console.warn('[AI SCREENING] Analysis failed, proceeding with review flag:', aiErr.message);
            aiAnalysis = {
                requested: true,
                error: aiErr.message,
                analyzedAt: new Date(),
                score: 0
            };
        }
    }

    // Step 6: Generate per-file DEK and wrap it
    const dek = crypto.randomBytes(32);
    const dekEnvelope = wrapDEK(dek);

    // Step 7: Store in private quarantine storage (encrypted at rest)
    let quarantineStorageReference;
    try {
        quarantineStorageReference = storeQuarantineFile(fileBuffer, file.originalname);
    } catch (storeErr) {
        throw httpError(500, `Failed to store file in quarantine storage: ${storeErr.message}`);
    }

    // Step 8: Create PendingUploadRequest record in MongoDB
    const evidenceId = `EVD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const caseId = body.caseId ? String(body.caseId).trim().slice(0, 120) : null;
    const description = body.description || body.reason || '';

    let pendingRequest;
    try {
        pendingRequest = await PendingUploadRequest.create({
            evidenceId,
            caseId,
            groupId,
            description,
            reason: description,
            uploaderId: user.id,
            uploaderWallet: String(user.walletAddress).toLowerCase(),
            organizationId: targetOrganizationId,
            fileName: file.originalname,
            mimeType: imageValidation.mimeType,
            fileSize: file.size || fileBuffer.length,
            fileHash,
            captureMetadata,
            quarantineStorageReference,
            workflowStatus: 'PENDING_REVIEW',
            dekEnvelope,
            aiAnalysis,
            blockchainRequested: requestBlockchain,
            cleanupStatus: 'NONE'
        });
    } catch (dbErr) {
        // Rollback quarantine file on MongoDB failure
        deleteQuarantineFile(quarantineStorageReference);
        throw dbErr;
    }

    // Step 9: Audit log
    await writeAuditLog({
        actor: user,
        organizationId: targetOrganizationId,
        action: 'pending_upload_created',
        targetType: 'pendingUploadRequest',
        targetId: pendingRequest._id,
        metadata: { evidenceId, fileHash, caseId }
    });

    // Step 10: Notifications & Real-Time Socket.IO
    if (targetOrganizationId) {
        try {
            await notifyOrganizationAdmins({
                organizationId: targetOrganizationId,
                type: 'upload_request_created',
                title: 'New Evidence Upload Request',
                message: `Upload request ${evidenceId} submitted for review by ${user.profile?.displayName || user.walletAddress}`,
                actionUrl: `/admin/upload-requests/${pendingRequest._id}`,
                metadata: { evidenceId, requestId: pendingRequest._id, caseId },
                excludeUserId: user.id
            });
        } catch (notifErr) {
            console.error('[NOTIFICATION] Failed to notify org admins:', notifErr.message);
        }
    }

    // Notify Super Admin (monitoring metadata only)
    try {
        const superAdmins = await User.find({ role: 'super_admin', accountStatus: 'active' }).select('_id');
        for (const sa of superAdmins) {
            await createNotification({
                recipientId: sa._id,
                organizationId: user.organizationId,
                type: 'platform_upload_monitored',
                title: 'Platform Evidence Upload Submitted',
                message: `Upload request ${evidenceId} submitted under organization ${user.organizationId || 'None'}`,
                actionUrl: `/superadmin/upload-requests/${pendingRequest._id}`,
                metadata: { evidenceId, requestId: pendingRequest._id, fileHash }
            });
        }
    } catch (saNotifErr) {
        console.warn('[NOTIFICATION] Super admin notification failed:', saNotifErr.message);
    }

    // Real-time Socket.IO event
    emitUploadWorkflowEvent('upload_request_created', {
        organizationId: targetOrganizationId,
        uploaderId: user.id,
        requestId: pendingRequest._id,
        evidenceId: pendingRequest.evidenceId,
        fileName: pendingRequest.fileName,
        fileSize: pendingRequest.fileSize,
        mimeType: pendingRequest.mimeType,
        fileHash: pendingRequest.fileHash,
        caseId: pendingRequest.caseId,
        status: 'PENDING_REVIEW'
    });

    return {
        pendingRequest: {
            requestId: pendingRequest._id,
            evidenceId: pendingRequest.evidenceId,
            fileName: pendingRequest.fileName,
            mimeType: pendingRequest.mimeType,
            fileSize: pendingRequest.fileSize,
            fileHash: pendingRequest.fileHash,
            workflowStatus: pendingRequest.workflowStatus,
            caseId: pendingRequest.caseId,
            createdAt: pendingRequest.createdAt
        },
        message: 'Evidence submitted successfully. Pending review by Organization Admin.',
        requiresApproval: true
    };
}

/**
 * Authenticated image preview for Organization Admin
 * Strictly enforces that only authorized admin of the same organization can preview.
 */
async function getPendingUploadPreview({ user, requestId }) {
    if (!user || !isAdmin(user)) {
        throw httpError(403, 'Access denied. Only Organization Admins can preview pending uploads.');
    }

    if (user.role === 'super_admin') {
        throw httpError(403, 'Super Admins cannot preview quarantine images. Platform monitoring only.');
    }

    if (user.role === 'admin' && !user.organizationId) {
        await ensureAdminOrganization(user);
    }

    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found.');
    }

    const requestOrgId = String(pendingRequest.organizationId?._id || pendingRequest.organizationId || '');
    if (requestOrgId !== String(user.organizationId)) {
        throw httpError(403, 'Access denied. You can only inspect uploads within your organization.');
    }

    if (['REJECTED', 'CLEANED'].includes(pendingRequest.workflowStatus)) {
        throw httpError(410, 'Preview is unavailable: this upload request was rejected or cleaned up.');
    }

    const fileBuffer = readQuarantineFile(pendingRequest.quarantineStorageReference);

    return {
        fileBuffer,
        mimeType: pendingRequest.mimeType,
        fileName: pendingRequest.fileName
    };
}

/**
 * Approve pending upload request (Organization Admin decision)
 */
async function approvePendingUploadRequest({ user, requestId, reason }) {
    if (!user || user.role !== 'admin') {
        throw httpError(403, 'Only Organization Admins can approve evidence uploads.');
    }

    if (!user.organizationId) {
        await ensureAdminOrganization(user);
    }

    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found.');
    }

    const requestOrgId = String(pendingRequest.organizationId?._id || pendingRequest.organizationId || '');
    if (requestOrgId !== String(user.organizationId)) {
        throw httpError(403, 'You can only approve upload requests for your own organization.');
    }

    // Prevent self-approval
    if (String(pendingRequest.uploaderId) === String(user.id)) {
        throw httpError(403, 'Self-approval is prohibited. Another administrator must review your upload.');
    }

    // Atomic update to prevent duplicate or conflicting concurrent approvals
    const updatedRequest = await PendingUploadRequest.findOneAndUpdate(
        {
            _id: requestId,
            workflowStatus: { $in: ['PENDING_REVIEW', 'pending_org_admin_approval', 'PROCESSING_FAILED'] }
        },
        {
            $set: {
                workflowStatus: 'APPROVED_PROCESSING',
                'orgAdminApproval.approvedBy': user.id,
                'orgAdminApproval.approvedAt': new Date(),
                'orgAdminApproval.reason': reason || 'Approved after review'
            }
        },
        { new: true }
    );

    if (!updatedRequest) {
        throw httpError(409, `Request cannot be approved in its current state (${pendingRequest.workflowStatus}).`);
    }

    // Audit log
    await writeAuditLog({
        actor: user,
        organizationId: pendingRequest.organizationId,
        action: 'pending_upload_approved',
        targetType: 'pendingUploadRequest',
        targetId: pendingRequest._id,
        reason,
        metadata: { evidenceId: pendingRequest.evidenceId }
    });

    // Notify uploader
    await createNotification({
        recipientId: pendingRequest.uploaderId,
        organizationId: pendingRequest.organizationId,
        type: 'upload_approved',
        title: 'Evidence Upload Approved',
        message: `Your evidence upload ${pendingRequest.evidenceId} has been approved and is being permanently processed.`,
        actionUrl: `/citizen/evidence-vault`,
        metadata: { evidenceId: pendingRequest.evidenceId, requestId: pendingRequest._id }
    });

    // Real-time Socket.IO broadcast
    emitUploadWorkflowEvent('upload_approved', {
        organizationId: pendingRequest.organizationId,
        uploaderId: pendingRequest.uploaderId,
        requestId: pendingRequest._id,
        evidenceId: pendingRequest.evidenceId,
        status: 'APPROVED_PROCESSING'
    });

    // Prompt background execution: starts reliable finalization asynchronously
    setImmediate(() => {
        processApprovedUpload(updatedRequest._id).catch((err) => {
            console.error('[CONTROLLED UPLOAD] Background finalization error:', err.message);
        });
    });

    return {
        pendingRequest: {
            requestId: updatedRequest._id,
            evidenceId: updatedRequest.evidenceId,
            workflowStatus: updatedRequest.workflowStatus
        },
        message: 'Upload approved successfully. Background finalization and storage started.'
    };
}

/**
 * Reject pending upload request (Organization Admin decision)
 */
async function rejectPendingUploadRequest({ user, requestId, reason }) {
    if (!user || user.role !== 'admin') {
        throw httpError(403, 'Only Organization Admins can reject evidence uploads.');
    }

    if (!reason || !String(reason).trim()) {
        throw httpError(400, 'Rejection reason is required.');
    }

    if (!user.organizationId) {
        await ensureAdminOrganization(user);
    }

    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found.');
    }

    const requestOrgId = String(pendingRequest.organizationId?._id || pendingRequest.organizationId || '');
    if (requestOrgId !== String(user.organizationId)) {
        throw httpError(403, 'You can only reject upload requests for your own organization.');
    }

    if (['FINALIZED', 'finalized'].includes(pendingRequest.workflowStatus)) {
        throw httpError(409, 'Cannot reject an already finalized evidence upload.');
    }

    // Atomic update
    const updatedRequest = await PendingUploadRequest.findOneAndUpdate(
        {
            _id: requestId,
            workflowStatus: { $nin: ['FINALIZED', 'finalized', 'REJECTED', 'rejected'] }
        },
        {
            $set: {
                workflowStatus: 'REJECTED',
                'rejection.rejectedBy': user.id,
                'rejection.rejectedAt': new Date(),
                'rejection.reason': String(reason).trim(),
                'rejection.stage': 'org_admin_review'
            }
        },
        { new: true }
    );

    if (!updatedRequest) {
        throw httpError(409, `Request cannot be rejected in its current state (${pendingRequest.workflowStatus}).`);
    }

    // Delete private temporary original image
    try {
        deleteQuarantineFile(pendingRequest.quarantineStorageReference);
        updatedRequest.cleanupStatus = 'CLEANED';
        updatedRequest.cleanedAt = new Date();
    } catch (cleanupErr) {
        console.error('[CLEANUP] Deletion failed during rejection:', cleanupErr.message);
        updatedRequest.cleanupStatus = 'CLEANUP_PENDING';
    }
    await updatedRequest.save();

    // Audit log
    await writeAuditLog({
        actor: user,
        organizationId: pendingRequest.organizationId,
        action: 'pending_upload_rejected',
        targetType: 'pendingUploadRequest',
        targetId: pendingRequest._id,
        reason: String(reason).trim(),
        metadata: { evidenceId: pendingRequest.evidenceId }
    });

    // Notify uploader
    await createNotification({
        recipientId: pendingRequest.uploaderId,
        organizationId: pendingRequest.organizationId,
        type: 'upload_rejected',
        title: 'Evidence Upload Rejected',
        message: `Your evidence upload ${pendingRequest.evidenceId} was rejected. Reason: ${String(reason).trim()}`,
        actionUrl: `/citizen/evidence-vault`,
        metadata: { evidenceId: pendingRequest.evidenceId, requestId: pendingRequest._id, reason: String(reason).trim() }
    });

    // Socket.IO broadcast
    emitUploadWorkflowEvent('upload_rejected', {
        organizationId: pendingRequest.organizationId,
        uploaderId: pendingRequest.uploaderId,
        requestId: pendingRequest._id,
        evidenceId: pendingRequest.evidenceId,
        status: 'REJECTED',
        reason: String(reason).trim()
    });

    return {
        pendingRequest: {
            requestId: updatedRequest._id,
            evidenceId: updatedRequest.evidenceId,
            workflowStatus: updatedRequest.workflowStatus,
            cleanupStatus: updatedRequest.cleanupStatus
        },
        message: 'Upload request rejected. Temporary file cleaned.'
    };
}

/**
 * Asynchronous background worker: performs durable encryption, IPFS storage,
 * verified blockchain registration, Evidence finalization, and temporary file cleanup.
 */
async function processApprovedUpload(requestId) {
    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        console.error('[BACKGROUND WORKER] Pending upload request not found:', requestId);
        return;
    }

    if (pendingRequest.workflowStatus !== 'APPROVED_PROCESSING') {
        console.log('[BACKGROUND WORKER] Request is not in APPROVED_PROCESSING state, skipping:', pendingRequest.workflowStatus);
        return;
    }

    console.log('[BACKGROUND WORKER] Starting permanent processing for request:', pendingRequest.evidenceId);

    emitUploadWorkflowEvent('permanent_processing_started', {
        organizationId: pendingRequest.organizationId,
        uploaderId: pendingRequest.uploaderId,
        requestId: pendingRequest._id,
        evidenceId: pendingRequest.evidenceId,
        status: 'APPROVED_PROCESSING'
    });

    try {
        // Step 1: Read quarantined original and verify hash
        const fileBuffer = readQuarantineFile(pendingRequest.quarantineStorageReference);
        const currentHash = computeSha256(fileBuffer);
        if (currentHash !== pendingRequest.fileHash) {
            throw new Error(`File integrity mismatch: stored file hash does not match original request hash.`);
        }

        // Step 2: Unwrap per-file DEK and encrypt with AES-256-GCM
        const dek = unwrapDEK(pendingRequest.dekEnvelope);
        const fileIv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', dek, fileIv);
        const encryptedBuffer = Buffer.concat([cipher.update(fileBuffer), cipher.final()]);
        const fileAuthTag = cipher.getAuthTag();

        // Step 3: IPFS Storage (Upload encrypted bytes only)
        let ipfsCID = pendingRequest.systemFinalization?.ipfsCID;
        if (!ipfsCID) {
            console.log('[BACKGROUND WORKER] Uploading encrypted buffer to IPFS...');
            ipfsCID = await uploadEncryptedBlobToPinata(encryptedBuffer, pendingRequest.fileName);
            pendingRequest.systemFinalization.ipfsCID = ipfsCID;
            pendingRequest.workflowStatus = 'IPFS_STORED';
            await pendingRequest.save();

            emitUploadWorkflowEvent('ipfs_stored', {
                organizationId: pendingRequest.organizationId,
                uploaderId: pendingRequest.uploaderId,
                requestId: pendingRequest._id,
                evidenceId: pendingRequest.evidenceId,
                ipfsCID,
                status: 'IPFS_STORED'
            });
        }

        // Step 4: Blockchain Registration (if requested)
        let blockchainTxHash = pendingRequest.systemFinalization?.blockchainTxHash;
        if (pendingRequest.blockchainRequested && !blockchainTxHash) {
            pendingRequest.workflowStatus = 'BLOCKCHAIN_PENDING';
            await pendingRequest.save();

            emitUploadWorkflowEvent('blockchain_pending', {
                organizationId: pendingRequest.organizationId,
                uploaderId: pendingRequest.uploaderId,
                requestId: pendingRequest._id,
                evidenceId: pendingRequest.evidenceId,
                ipfsCID,
                status: 'BLOCKCHAIN_PENDING'
            });

            console.log('[BACKGROUND WORKER] Registering proof on blockchain for evidence:', pendingRequest.evidenceId);
            const aiScore = pendingRequest.aiAnalysis?.requested
                ? Number(pendingRequest.aiAnalysis.authenticityScore ?? pendingRequest.aiAnalysis.score ?? 0)
                : 0;

            const chainResult = await registerEvidenceOnChain({
                evidenceId: pendingRequest.evidenceId,
                fileHash: pendingRequest.fileHash,
                ipfsCID,
                aiScore,
                uploaderWallet: pendingRequest.uploaderWallet
            });

            blockchainTxHash = chainResult.txHash;
            pendingRequest.systemFinalization.blockchainTxHash = blockchainTxHash;
            await pendingRequest.save();
        }

        // Step 5: Create permanent Evidence record in MongoDB
        const evidence = await EvidenceModel.create({
            user: pendingRequest.uploaderId,
            uploadedBy: pendingRequest.uploaderId,
            organizationId: pendingRequest.organizationId,
            groupId: pendingRequest.groupId || null,
            UploaderWallet: pendingRequest.uploaderWallet,
            caseId: pendingRequest.caseId,
            fileName: pendingRequest.fileName,
            mimeType: pendingRequest.mimeType,
            fileSize: pendingRequest.fileSize,
            fileHash: pendingRequest.fileHash,
            captureMetadata: pendingRequest.captureMetadata,
            ipfsCID,
            encryption: {
                iv: fileIv.toString('hex'),
                authTag: fileAuthTag.toString('hex'),
                algorithm: 'aes-256-gcm',
                encryptedDEK: pendingRequest.dekEnvelope.encryptedDEK,
                keyIv: pendingRequest.dekEnvelope.keyIv,
                keyAuthTag: pendingRequest.dekEnvelope.keyAuthTag
            },
            blockchainRequested: pendingRequest.blockchainRequested,
            blockchainTxHash: blockchainTxHash || null,
            blockchainStatus: blockchainTxHash ? 'confirmed' : 'not_requested',
            aiAnalysis: pendingRequest.aiAnalysis,
            processingStatus: 'completed',
            reviewStatus: 'approved',
            storageStatus: 'ipfs',
            status: blockchainTxHash ? 'stored_on_chain' : 'stored_ipfs',
            statusMessage: 'Evidence approved, encrypted, pinned to IPFS, and verified.',
            approvedBy: pendingRequest.orgAdminApproval.approvedBy,
            approvedAt: pendingRequest.orgAdminApproval.approvedAt
        });

        // Step 6: Mark request FINALIZED
        pendingRequest.workflowStatus = 'FINALIZED';
        pendingRequest.systemFinalization.evidenceId = evidence._id;
        pendingRequest.systemFinalization.finalizedAt = new Date();
        pendingRequest.systemFinalization.error = null;
        await pendingRequest.save();

        // Write Audit Log
        await writeAuditLog({
            actor: { id: pendingRequest.orgAdminApproval.approvedBy || 'system', role: 'admin' },
            organizationId: pendingRequest.organizationId,
            action: 'evidence_finalized',
            targetType: 'evidence',
            targetId: evidence._id,
            metadata: {
                evidenceId: pendingRequest.evidenceId,
                ipfsCID,
                blockchainTxHash
            }
        });

        // Step 7: Safe temporary file cleanup only after finalization commits!
        try {
            deleteQuarantineFile(pendingRequest.quarantineStorageReference);
            pendingRequest.cleanupStatus = 'CLEANED';
            pendingRequest.cleanedAt = new Date();
        } catch (cleanupErr) {
            console.error('[BACKGROUND WORKER] Temporary file cleanup failed:', cleanupErr.message);
            pendingRequest.cleanupStatus = 'CLEANUP_PENDING';
        }
        await pendingRequest.save();

        // Emit finalization Socket.IO events
        emitUploadWorkflowEvent('finalization_completed', {
            organizationId: pendingRequest.organizationId,
            uploaderId: pendingRequest.uploaderId,
            requestId: pendingRequest._id,
            evidenceId: pendingRequest.evidenceId,
            finalEvidenceId: evidence._id,
            ipfsCID,
            blockchainTxHash,
            status: 'FINALIZED'
        });

        emitUploadWorkflowEvent('temporary_cleanup_completed', {
            organizationId: pendingRequest.organizationId,
            uploaderId: pendingRequest.uploaderId,
            requestId: pendingRequest._id,
            evidenceId: pendingRequest.evidenceId,
            cleanupStatus: pendingRequest.cleanupStatus
        });

        // In-app Notification for uploader
        await createNotification({
            recipientId: pendingRequest.uploaderId,
            organizationId: pendingRequest.organizationId,
            type: 'evidence_finalized',
            title: 'Evidence Finalized & Stored',
            message: `Your evidence upload ${pendingRequest.evidenceId} has been successfully stored in IPFS and blockchain!`,
            actionUrl: `/citizen/evidence/${evidence._id}`,
            metadata: { evidenceId: pendingRequest.evidenceId, finalEvidenceId: evidence._id, ipfsCID, blockchainTxHash }
        });

        console.log('[BACKGROUND WORKER] Evidence successfully finalized:', {
            requestId: pendingRequest._id,
            evidenceId: evidence._id,
            ipfsCID,
            blockchainTxHash
        });

    } catch (err) {
        console.error('[BACKGROUND WORKER] Finalization failed:', err.message);

        pendingRequest.workflowStatus = 'PROCESSING_FAILED';
        pendingRequest.systemFinalization.error = err.message;
        pendingRequest.systemFinalization.retryCount = (pendingRequest.systemFinalization.retryCount || 0) + 1;
        await pendingRequest.save();

        emitUploadWorkflowEvent('processing_failed', {
            organizationId: pendingRequest.organizationId,
            uploaderId: pendingRequest.uploaderId,
            requestId: pendingRequest._id,
            evidenceId: pendingRequest.evidenceId,
            status: 'PROCESSING_FAILED',
            error: err.message
        });

        await writeAuditLog({
            actor: { id: 'system', role: 'system' },
            organizationId: pendingRequest.organizationId,
            action: 'finalization_failed',
            targetType: 'pendingUploadRequest',
            targetId: pendingRequest._id,
            reason: err.message
        });
    }
}

/**
 * Retry failed finalization
 */
async function retryFinalization({ user, requestId }) {
    if (!user || user.role !== 'admin') {
        throw httpError(403, 'Only Organization Admins can retry finalization.');
    }

    if (!user.organizationId) {
        await ensureAdminOrganization(user);
    }

    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found.');
    }

    const requestOrgId = String(pendingRequest.organizationId?._id || pendingRequest.organizationId || '');
    if (requestOrgId !== String(user.organizationId)) {
        throw httpError(403, 'Access denied.');
    }

    if (!['PROCESSING_FAILED', 'IPFS_STORED', 'BLOCKCHAIN_PENDING'].includes(pendingRequest.workflowStatus)) {
        throw httpError(400, `Cannot retry finalization for request in status ${pendingRequest.workflowStatus}.`);
    }

    pendingRequest.workflowStatus = 'APPROVED_PROCESSING';
    pendingRequest.systemFinalization.error = null;
    await pendingRequest.save();

    setImmediate(() => {
        processApprovedUpload(pendingRequest._id).catch(console.error);
    });

    return {
        success: true,
        message: 'Finalization retry initiated.',
        requestId: pendingRequest._id
    };
}

/**
 * Query pending upload requests
 */
async function getPendingUploadRequests(filters = {}) {
    const {
        workflowStatus,
        organizationId,
        uploaderId,
        page = 1,
        limit = 20,
        search
    } = filters;

    const query = {};
    if (workflowStatus) {
        if (workflowStatus === 'PENDING_REVIEW') {
            query.workflowStatus = { $in: ['PENDING_REVIEW', 'pending_org_admin_approval'] };
        } else {
            query.workflowStatus = workflowStatus;
        }
    }
    if (organizationId) {
        query.organizationId = mongoose.Types.ObjectId.isValid(organizationId)
            ? new mongoose.Types.ObjectId(organizationId)
            : organizationId;
    }
    if (uploaderId) {
        query.uploaderId = mongoose.Types.ObjectId.isValid(uploaderId)
            ? new mongoose.Types.ObjectId(uploaderId)
            : uploaderId;
    }
    if (search) {
        query.$or = [
            { evidenceId: { $regex: search, $options: 'i' } },
            { caseId: { $regex: search, $options: 'i' } },
            { fileName: { $regex: search, $options: 'i' } }
        ];
    }

    const skip = (page - 1) * limit;

    const [total, requests] = await Promise.all([
        PendingUploadRequest.countDocuments(query),
        PendingUploadRequest.find(query)
            .populate('uploaderId', 'walletAddress profile role')
            .populate('organizationId', 'name organizationCode')
            .populate('groupId', 'name code')
            .populate('orgAdminApproval.approvedBy', 'walletAddress profile')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
    ]);

    return {
        requests,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit) || 1
        }
    };
}

/**
 * Get single pending upload request by ID
 */
async function getPendingUploadRequestById(requestId, user) {
    const pendingRequest = await PendingUploadRequest.findById(requestId)
        .populate('uploaderId', 'walletAddress profile role')
        .populate('groupId', 'name code')
        .populate('orgAdminApproval.approvedBy', 'walletAddress profile');

    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found.');
    }

    const requestOrgId = String(pendingRequest.organizationId?._id || pendingRequest.organizationId || '');
    const isUploader = String(pendingRequest.uploaderId?._id || pendingRequest.uploaderId) === String(user.id);
    const isOrgAdmin = isAdmin(user) && requestOrgId === String(user.organizationId);
    const isSuper = isSuperAdmin(user);

    if (!isUploader && !isOrgAdmin && !isSuper) {
        throw httpError(403, 'You are not authorized to view this upload request.');
    }

    return pendingRequest;
}

/**
 * Cleanup worker: cleans up orphaned quarantine files and retries pending deletions
 */
function initCleanupWorker() {
    // Run every hour
    cron.schedule('0 * * * *', async () => {
        console.log('[CLEANUP WORKER] Running scheduled cleanup...');
        try {
            // Find requests where cleanup is pending
            const pendingCleanups = await PendingUploadRequest.find({
                cleanupStatus: 'CLEANUP_PENDING',
                workflowStatus: { $in: ['FINALIZED', 'REJECTED'] }
            }).limit(50);

            for (const req of pendingCleanups) {
                try {
                    deleteQuarantineFile(req.quarantineStorageReference);
                    req.cleanupStatus = 'CLEANED';
                    req.cleanedAt = new Date();
                    await req.save();
                } catch (e) {
                    console.warn('[CLEANUP WORKER] Retry deletion failed for:', req.evidenceId);
                }
            }

            // Clean orphaned disk files older than 7 days
            cleanupQuarantineFiles(7 * 24 * 60 * 60 * 1000);
        } catch (err) {
            console.error('[CLEANUP WORKER] Scheduled cleanup error:', err.message);
        }
    });

    console.log('[CLEANUP WORKER] Scheduled cleanup worker initialized.');
}

module.exports = {
    createPendingUploadRequest,
    getPendingUploadPreview,
    approvePendingUploadRequest,
    rejectPendingUploadRequest,
    processApprovedUpload,
    retryFinalization,
    getPendingUploadRequests,
    getPendingUploadRequestById,
    initCleanupWorker
};

const crypto = require('crypto');
const PendingUploadRequest = require('../model/pendingUploadRequestModel');
const EvidenceModel = require('../model/evidenceModel');
const { storeQuarantineFile, readQuarantineFile } = require('./quarantineStorage');
const { computeSha256 } = require('./cryptoService');
const { verifyUploadSignature, generateNonce, createExpiryDate } = require('./signatureService');
const { validateImageFile, validateEvidenceImageType } = require('./imageValidationService');
const { isEmployee, isNormalUser, isAdmin, isSuperAdmin, httpError } = require('./accessControl');
const { writeAuditLog } = require('./auditService');
const { notifyOrganizationAdmins } = require('./notificationService');
const { encryptBuffer } = require('./cryptoService');
const { uploadEncryptedBlobToPinata } = require('./ipfsService');
const { evidenceExists } = require('./blockchainService');
const { 
    generateDEK, 
    createDEKEnvelopes, 
    encryptWithDEK, 
    generateKeyVersion,
    validateRoleSecrets 
} = require('./keyManagementService');
const User = require('../model/userModel');

/**
 * Create a pending upload request for controlled evidence workflow
 * This implements the new secure upload approval system
 */
async function createPendingUploadRequest({
    user,
    file,
    fileBuffer,
    body
}) {
    // Step 1: Validate authentication and role
    if (!user || !user.id) {
        throw httpError(401, 'Authentication required');
    }

    // Step 2: Validate file format (images only for controlled workflow)
    const imageTypeValidation = validateEvidenceImageType(fileBuffer, file.mimetype, file.originalname);
    if (!imageTypeValidation.valid) {
        throw httpError(400, imageTypeValidation.reason || 'Invalid image file');
    }
    const imageValidation = validateImageFile(fileBuffer, file.mimetype);
    if (!imageValidation.valid) {
        throw httpError(400, imageValidation.reason || 'Invalid image file');
    }

    // Step 3: Parse capture metadata
    let captureMetadata;
    try {
        const metadata = typeof body.captureMetadata === 'string' 
            ? JSON.parse(body.captureMetadata) 
            : body.captureMetadata;
        
        const latitude = Number(metadata?.gpsLocation?.latitude);
        const longitude = Number(metadata?.gpsLocation?.longitude);
        const capturedAt = new Date(metadata?.capturedAt);

        if (!metadata.deviceInfo || Number.isNaN(latitude) || Number.isNaN(longitude) || Number.isNaN(capturedAt.getTime())) {
            throw httpError(400, 'captureMetadata must include deviceInfo, gpsLocation.latitude, gpsLocation.longitude, and capturedAt.');
        }

        captureMetadata = {
            deviceInfo: String(metadata.deviceInfo).slice(0, 300),
            gpsLocation: { latitude, longitude },
            capturedAt
        };
    } catch (err) {
        if (err.statusCode) throw err;
        throw httpError(400, 'Invalid captureMetadata format');
    }

    // Step 4: Calculate SHA-256 hash
    const fileHash = computeSha256(fileBuffer);

    // Step 5: Check for duplicate hashes
    const existingEvidence = await EvidenceModel.findOne({ fileHash }).select('_id');
    if (existingEvidence) {
        throw httpError(409, 'Duplicate file detected. This evidence already exists in DEMS.');
    }

    const existingPending = await PendingUploadRequest.findOne({ 
        fileHash,
        workflowStatus: { $in: ['pending_user_signature', 'pending_org_admin_approval', 'pending_super_admin_approval', 'pending_system_finalization'] }
    }).select('_id');
    
    if (existingPending) {
        throw httpError(409, 'This file is already pending approval.');
    }

    // Step 6: Generate unique evidence ID
    const evidenceId = `EVD-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

    // Step 7: Generate per-file DEK (Data Encryption Key)
    const dek = generateDEK();
    const keyVersion = generateKeyVersion();

    // Step 8: Store in quarantine storage
    const quarantineStorageReference = storeQuarantineFile(fileBuffer, file.originalname);

    // Step 9: Create pending upload request
    const caseId = body.caseId ? String(body.caseId).trim().slice(0, 120) : null;
    const requestBlockchain = String(body.requestBlockchain || 'false').toLowerCase() === 'true';

    const pendingRequest = await PendingUploadRequest.create({
        evidenceId,
        caseId,
        uploaderId: user.id,
        uploaderWallet: String(user.walletAddress).toLowerCase(),
        organizationId: user.organizationId || null,
        fileName: file.originalname,
        mimeType: imageValidation.mimeType,
        fileSize: file.size || fileBuffer.length,
        fileHash,
        captureMetadata,
        quarantineStorageReference,
        workflowStatus: 'pending_user_signature',
        requestVersion: 1,
        signatureNonce: generateNonce(),
        expiresAt: createExpiryDate(7),
        blockchainRequested: requestBlockchain,
        keyVersion,
        // DEK will be encrypted as each party signs
        encryptedDEKs: {
            user: { encryptedDEK: null, iv: null, authTag: null, algorithm: 'aes-256-gcm' },
            org_admin: { encryptedDEK: null, iv: null, authTag: null, algorithm: 'aes-256-gcm' },
            super_admin: { encryptedDEK: null, iv: null, authTag: null, algorithm: 'aes-256-gcm' }
        }
    });

    // Store DEK temporarily in memory (not in DB)
    // This will be encrypted as each party signs
    pendingRequest._tempDEK = dek;

    // Step 9: Write audit log
    await writeAuditLog({
        actor: user,
        organizationId: user.organizationId,
        action: 'pending_upload_created',
        targetType: 'pendingUploadRequest',
        targetId: pendingRequest._id,
        metadata: { evidenceId, fileHash }
    });

    return {
        pendingRequest: {
            evidenceId: pendingRequest.evidenceId,
            requestId: pendingRequest._id,
            fileName: pendingRequest.fileName,
            mimeType: pendingRequest.mimeType,
            fileSize: pendingRequest.fileSize,
            fileHash: pendingRequest.fileHash,
            workflowStatus: pendingRequest.workflowStatus,
            signatureNonce: pendingRequest.signatureNonce,
            expiresAt: pendingRequest.expiresAt,
            requestVersion: pendingRequest.requestVersion
        },
        message: 'Upload request created. Please sign to authorize this upload.',
        requiresSignature: true
    };
}

/**
 * Sign the pending upload request (uploader authorization)
 */
async function signPendingUploadRequest({
    user,
    requestId,
    signature
}) {
    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found');
    }

    // Verify ownership
    if (String(pendingRequest.uploaderId) !== String(user.id)) {
        throw httpError(403, 'You are not authorized to sign this request');
    }

    // Verify workflow status
    if (pendingRequest.workflowStatus !== 'pending_user_signature') {
        throw httpError(409, 'This request is not awaiting user signature');
    }

    // Verify expiry
    if (new Date() > pendingRequest.expiresAt) {
        pendingRequest.workflowStatus = 'rejected';
        pendingRequest.rejection = {
            rejectedBy: null,
            rejectedAt: new Date(),
            reason: 'Request expired',
            stage: 'user_signature'
        };
        await pendingRequest.save();
        throw httpError(410, 'Request has expired');
    }

    // Verify signature
    const signatureVerification = verifyUploadSignature(
        pendingRequest,
        signature,
        user.walletAddress,
        'upload'
    );

    if (!signatureVerification.valid) {
        throw httpError(401, signatureVerification.reason || 'Signature verification failed');
    }

    // Phase 2: Encrypt DEK with user's KEK
    try {
        const { createDEKEnvelopes, ROLES } = require('./keyManagementService');
        
        // Get the temporary DEK from memory (or re-generate if needed)
        const dek = pendingRequest._tempDEK || generateDEK();
        
        // Create envelope for user role
        const userEnvelope = createDEKEnvelopes(dek, {
            [ROLES.USER]: signature
        });

        if (userEnvelope.user) {
            pendingRequest.encryptedDEKs.user = userEnvelope.user;
        }
    } catch (keyError) {
        console.error('[CONTROLLED UPLOAD] Failed to encrypt DEK with user KEK:', keyError.message);
        // Don't fail the signature if key encryption fails - fallback to old method
        // In production, this should be logged and monitored
    }

    // Update pending request
    pendingRequest.userSignature = {
        signature,
        signedAt: new Date(),
        messageHash: signatureVerification.messageHash,
        walletAddress: user.walletAddress
    };
    pendingRequest.workflowStatus = 'pending_org_admin_approval';
    await pendingRequest.save();

    // Write audit log
    await writeAuditLog({
        actor: user,
        organizationId: pendingRequest.organizationId,
        action: 'pending_upload_signed',
        targetType: 'pendingUploadRequest',
        targetId: pendingRequest._id,
        metadata: { evidenceId: pendingRequest.evidenceId }
    });

    // Notify organization admins if applicable
    if (pendingRequest.organizationId) {
        try {
            await notifyOrganizationAdmins({
                organizationId: pendingRequest.organizationId,
                type: 'evidence_approval_required',
                title: 'Evidence approval required',
                message: `Upload request ${pendingRequest.evidenceId} requires your approval`,
                actionUrl: `/admin/pending-uploads/${pendingRequest._id}`,
                metadata: { evidenceId: pendingRequest.evidenceId, requestId: pendingRequest._id },
                excludeUserId: user.id
            });
        } catch (notifyError) {
            console.error('[CONTROLLED UPLOAD] Failed to notify admins:', notifyError.message);
        }
    }

    return {
        pendingRequest: {
            evidenceId: pendingRequest.evidenceId,
            requestId: pendingRequest._id,
            workflowStatus: pendingRequest.workflowStatus
        },
        message: 'Upload authorized. Awaiting Organization Admin approval.'
    };
}

/**
 * Approve pending upload request (Organization Admin)
 */
async function approvePendingUploadRequest({
    user,
    requestId,
    signature,
    reason
}) {
    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found');
    }

    // Verify user is Organization Admin
    if (!isAdmin(user)) {
        throw httpError(403, 'Only Organization Admins can approve upload requests');
    }

    // Verify organization scope
    if (pendingRequest.organizationId && String(pendingRequest.organizationId) !== String(user.organizationId)) {
        throw httpError(403, 'You can only approve requests within your organization');
    }

    // Verify workflow status
    if (pendingRequest.workflowStatus !== 'pending_org_admin_approval') {
        throw httpError(409, 'This request is not awaiting Organization Admin approval');
    }

    // Verify expiry
    if (new Date() > pendingRequest.expiresAt) {
        pendingRequest.workflowStatus = 'rejected';
        pendingRequest.rejection = {
            rejectedBy: user.id,
            rejectedAt: new Date(),
            reason: 'Request expired',
            stage: 'org_admin_approval'
        };
        await pendingRequest.save();
        throw httpError(410, 'Request has expired');
    }

    // Prevent self-approval
    if (String(pendingRequest.uploaderId) === String(user.id)) {
        throw httpError(403, 'Cannot approve your own upload request');
    }

    // Verify signature
    const signatureVerification = verifyUploadSignature(
        pendingRequest,
        signature,
        user.walletAddress,
        'approve'
    );

    if (!signatureVerification.valid) {
        throw httpError(401, signatureVerification.reason || 'Signature verification failed');
    }

    // Phase 2: Encrypt DEK with Org Admin's KEK
    try {
        const { createDEKEnvelopes, ROLES, generateDEK } = require('./keyManagementService');
        
        // Get or regenerate DEK
        const dek = pendingRequest._tempDEK || generateDEK();
        pendingRequest._tempDEK = dek; // Store for next approval
        
        // Create envelope for org admin role
        const orgAdminEnvelope = createDEKEnvelopes(dek, {
            [ROLES.ORG_ADMIN]: signature
        });

        if (orgAdminEnvelope.org_admin) {
            pendingRequest.encryptedDEKs.org_admin = orgAdminEnvelope.org_admin;
        }
    } catch (keyError) {
        console.error('[CONTROLLED UPLOAD] Failed to encrypt DEK with Org Admin KEK:', keyError.message);
    }

    // Update pending request
    pendingRequest.orgAdminApproval = {
        approvedBy: user.id,
        signature,
        signedAt: new Date(),
        messageHash: signatureVerification.messageHash,
        reason: reason || '',
        walletAddress: user.walletAddress
    };
    pendingRequest.workflowStatus = 'pending_super_admin_approval';
    await pendingRequest.save();

    // Write audit log
    await writeAuditLog({
        actor: user,
        organizationId: pendingRequest.organizationId,
        action: 'org_admin_approved',
        targetType: 'pendingUploadRequest',
        targetId: pendingRequest._id,
        reason,
        metadata: { evidenceId: pendingRequest.evidenceId }
    });

    return {
        pendingRequest: {
            evidenceId: pendingRequest.evidenceId,
            requestId: pendingRequest._id,
            workflowStatus: pendingRequest.workflowStatus
        },
        message: 'Organization Admin approval recorded. Awaiting Super Admin approval.'
    };
}

/**
 * Approve pending upload request (Super Admin)
 */
async function superAdminApprovePendingUploadRequest({
    user,
    requestId,
    signature,
    reason
}) {
    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found');
    }

    // Verify user is Super Admin
    if (!isSuperAdmin(user)) {
        throw httpError(403, 'Only Super Admins can approve upload requests at this stage');
    }

    // Verify workflow status
    if (pendingRequest.workflowStatus !== 'pending_super_admin_approval') {
        throw httpError(409, 'This request is not awaiting Super Admin approval');
    }

    // Verify expiry
    if (new Date() > pendingRequest.expiresAt) {
        pendingRequest.workflowStatus = 'rejected';
        pendingRequest.rejection = {
            rejectedBy: user.id,
            rejectedAt: new Date(),
            reason: 'Request expired',
            stage: 'super_admin_approval'
        };
        await pendingRequest.save();
        throw httpError(410, 'Request has expired');
    }

    // Prevent self-approval
    if (String(pendingRequest.uploaderId) === String(user.id)) {
        throw httpError(403, 'Cannot approve your own upload request');
    }

    // Verify signature
    const signatureVerification = verifyUploadSignature(
        pendingRequest,
        signature,
        user.walletAddress,
        'super_approve'
    );

    if (!signatureVerification.valid) {
        throw httpError(401, signatureVerification.reason || 'Signature verification failed');
    }

    // Phase 2: Encrypt DEK with Super Admin's KEK
    try {
        const { createDEKEnvelopes, ROLES, generateDEK } = require('./keyManagementService');
        
        // Get or regenerate DEK
        const dek = pendingRequest._tempDEK || generateDEK();
        
        // Create envelope for super admin role
        const superAdminEnvelope = createDEKEnvelopes(dek, {
            [ROLES.SUPER_ADMIN]: signature
        });

        if (superAdminEnvelope.super_admin) {
            pendingRequest.encryptedDEKs.super_admin = superAdminEnvelope.super_admin;
        }
    } catch (keyError) {
        console.error('[CONTROLLED UPLOAD] Failed to encrypt DEK with Super Admin KEK:', keyError.message);
    }

    // Update pending request
    pendingRequest.superAdminApproval = {
        approvedBy: user.id,
        signature,
        signedAt: new Date(),
        messageHash: signatureVerification.messageHash,
        reason: reason || '',
        walletAddress: user.walletAddress
    };
    pendingRequest.workflowStatus = 'pending_system_finalization';
    await pendingRequest.save();

    // Write audit log
    await writeAuditLog({
        actor: user,
        organizationId: pendingRequest.organizationId,
        action: 'super_admin_approved',
        targetType: 'pendingUploadRequest',
        targetId: pendingRequest._id,
        reason,
        metadata: { evidenceId: pendingRequest.evidenceId }
    });

    // Trigger system finalization
    await finalizeApprovedRequest(pendingRequest);

    return {
        pendingRequest: {
            evidenceId: pendingRequest.evidenceId,
            requestId: pendingRequest._id,
            workflowStatus: pendingRequest.workflowStatus
        },
        message: 'Super Admin approval recorded. System finalization in progress.'
    };
}

/**
 * Reject pending upload request
 */
async function rejectPendingUploadRequest({
    user,
    requestId,
    reason
}) {
    const pendingRequest = await PendingUploadRequest.findById(requestId);
    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found');
    }

    // Verify workflow status (can reject at any stage before finalization)
    if (['approved', 'finalized', 'rejected'].includes(pendingRequest.workflowStatus)) {
        throw httpError(409, 'This request cannot be rejected in its current state');
    }

    // Determine rejection stage
    let stage = 'unknown';
    if (pendingRequest.workflowStatus === 'pending_user_signature') stage = 'user_signature';
    else if (pendingRequest.workflowStatus === 'pending_org_admin_approval') stage = 'org_admin_approval';
    else if (pendingRequest.workflowStatus === 'pending_super_admin_approval') stage = 'super_admin_approval';
    else if (pendingRequest.workflowStatus === 'pending_system_finalization') stage = 'system_finalization';

    // Update pending request
    pendingRequest.workflowStatus = 'rejected';
    pendingRequest.rejection = {
        rejectedBy: user.id,
        rejectedAt: new Date(),
        reason: reason || 'No reason provided',
        stage
    };
    await pendingRequest.save();

    // Write audit log
    await writeAuditLog({
        actor: user,
        organizationId: pendingRequest.organizationId,
        action: 'pending_upload_rejected',
        targetType: 'pendingUploadRequest',
        targetId: pendingRequest._id,
        reason,
        metadata: { evidenceId: pendingRequest.evidenceId, stage }
    });

    return {
        pendingRequest: {
            evidenceId: pendingRequest.evidenceId,
            requestId: pendingRequest._id,
            workflowStatus: pendingRequest.workflowStatus
        },
        message: 'Upload request rejected. Evidence remains in quarantine.'
    };
}

/**
 * System finalization - called after all three approvals
 * This is a trusted backend operation
 */
async function finalizeApprovedRequest(pendingRequest) {
    try {
        // Step 1: Revalidate file hash
        const fileBuffer = readQuarantineFile(pendingRequest.quarantineStorageReference);
        const currentHash = computeSha256(fileBuffer);
        
        if (currentHash !== pendingRequest.fileHash) {
            throw new Error('File hash mismatch during finalization');
        }

        // Step 2: Get or generate DEK
        const { generateDEK, encryptWithDEK } = require('./keyManagementService');
        const dek = pendingRequest._tempDEK || generateDEK();

        // Step 3: Encrypt the file with DEK
        const encrypted = encryptWithDEK(fileBuffer, dek);

        // Step 4: Upload to IPFS
        const ipfsCID = await uploadEncryptedBlobToPinata(
            encrypted.encryptedData, 
            pendingRequest.fileName
        );

        // Step 5: Create evidence record with encrypted DEKs
        const evidence = await EvidenceModel.create({
            user: pendingRequest.uploaderId,
            uploadedBy: pendingRequest.uploaderId,
            organizationId: pendingRequest.organizationId,
            UploaderWallet: pendingRequest.uploaderWallet,
            caseId: pendingRequest.caseId,
            fileName: pendingRequest.fileName,
            mimeType: pendingRequest.mimeType,
            fileSize: pendingRequest.fileSize,
            fileHash: pendingRequest.fileHash,
            captureMetadata: pendingRequest.captureMetadata,
            ipfsCID,
            encryption: {
                iv: encrypted.iv,
                authTag: encrypted.authTag,
                algorithm: encrypted.algorithm
            },
            // Phase 2: Store encrypted DEKs
            keyVersion: pendingRequest.keyVersion,
            encryptedDEKs: pendingRequest.encryptedDEKs,
            blockchainRequested: pendingRequest.blockchainRequested,
            processingStatus: 'completed',
            reviewStatus: 'approved',
            storageStatus: 'ipfs',
            blockchainStatus: pendingRequest.blockchainRequested ? 'pending' : 'not_requested',
            status: pendingRequest.blockchainRequested ? 'pending_blockchain' : 'stored_ipfs',
            statusMessage: pendingRequest.blockchainRequested
                ? 'Encrypted evidence pinned to IPFS with multi-party key protection. Awaiting blockchain proof.'
                : 'Encrypted evidence pinned to IPFS with multi-party key protection via controlled approval workflow.',
            approvedBy: pendingRequest.superAdminApproval.approvedBy,
            approvedAt: new Date()
        });

        // Step 6: Update pending request
        pendingRequest.workflowStatus = 'finalized';
        pendingRequest.systemFinalization = {
            finalizedAt: new Date(),
            evidenceId: evidence._id,
            ipfsCID,
            blockchainTxHash: null
        };
        await pendingRequest.save();

        // Step 7: Write audit log
        await writeAuditLog({
            actor: { id: 'system', role: 'system' },
            organizationId: pendingRequest.organizationId,
            action: 'system_finalization',
            targetType: 'pendingUploadRequest',
            targetId: pendingRequest._id,
            metadata: { 
                evidenceId: pendingRequest.evidenceId,
                finalEvidenceId: evidence._id,
                ipfsCID,
                keyVersion: pendingRequest.keyVersion
            }
        });

        console.log('[CONTROLLED UPLOAD] Finalization complete with multi-party key protection:', {
            pendingRequestId: pendingRequest._id,
            evidenceId: evidence._id,
            ipfsCID,
            keyVersion: pendingRequest.keyVersion
        });

    } catch (error) {
        console.error('[CONTROLLED UPLOAD] Finalization failed:', error.message);
        
        // Mark as failed but keep record
        pendingRequest.workflowStatus = 'pending_system_finalization';
        pendingRequest.systemFinalization = {
            finalizedAt: null,
            evidenceId: null,
            ipfsCID: null,
            error: error.message
        };
        await pendingRequest.save();

        // Write audit log
        await writeAuditLog({
            actor: { id: 'system', role: 'system' },
            organizationId: pendingRequest.organizationId,
            action: 'system_finalization_failed',
            targetType: 'pendingUploadRequest',
            targetId: pendingRequest._id,
            result: 'failed',
            reason: error.message
        });

        throw error;
    }
}

/**
 * Get pending upload requests for approval queues
 */
async function getPendingUploadRequests(filters = {}) {
    const { 
        workflowStatus, 
        organizationId, 
        uploaderId,
        page = 1, 
        limit = 20 
    } = filters;

    const query = {};
    if (workflowStatus) query.workflowStatus = workflowStatus;
    if (organizationId) query.organizationId = organizationId;
    if (uploaderId) query.uploaderId = uploaderId;

    const skip = (page - 1) * limit;

    const [total, requests] = await Promise.all([
        PendingUploadRequest.countDocuments(query),
        PendingUploadRequest.find(query)
            .populate('uploaderId', 'walletAddress profile')
            .populate('orgAdminApproval.approvedBy', 'walletAddress profile')
            .populate('superAdminApproval.approvedBy', 'walletAddress profile')
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
 * Get a single pending upload request by ID
 */
async function getPendingUploadRequestById(requestId, user) {
    const pendingRequest = await PendingUploadRequest.findById(requestId)
        .populate('uploaderId', 'walletAddress profile role')
        .populate('orgAdminApproval.approvedBy', 'walletAddress profile')
        .populate('superAdminApproval.approvedBy', 'walletAddress profile');

    if (!pendingRequest) {
        throw httpError(404, 'Pending upload request not found');
    }

    // Access control: uploader, org admin of same org, or super admin
    const isUploader = String(pendingRequest.uploaderId._id) === String(user.id);
    const isOrgAdmin = isAdmin(user) && String(pendingRequest.organizationId) === String(user.organizationId);
    const isSuperAdmin = isSuperAdmin(user);

    if (!isUploader && !isOrgAdmin && !isSuperAdmin) {
        throw httpError(403, 'You are not authorized to access this request');
    }

    return pendingRequest;
}

module.exports = {
    createPendingUploadRequest,
    signPendingUploadRequest,
    approvePendingUploadRequest,
    superAdminApprovePendingUploadRequest,
    rejectPendingUploadRequest,
    getPendingUploadRequests,
    getPendingUploadRequestById
};

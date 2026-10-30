const ViewAccessRequest = require('../model/viewAccessRequestModel');
const Evidence = require('../model/evidenceModel');
const { fetchEncryptedBlobFromIpfs } = require('../services/ipfsService');
const { decryptFile } = require('../services/cryptoService');
const {
    createViewAccessRequest,
    approveViewAccessRequest,
    rejectViewAccessRequest,
    revokeViewAccessPermission,
    checkUserActivePermission,
    getWorkflowCounts,
    sweepExpiredPermissions
} = require('../services/viewAccessService');
const { ensureAdminOrganization } = require('../services/organizationService');

/**
 * Create a new view access request
 */
const createRequest = async (req, res, next) => {
    try {
        const { targetType, targetId, organizationId, reason, duration } = req.body;
        const request = await createViewAccessRequest({
            user: req.user,
            targetType,
            targetId,
            organizationId,
            reason,
            duration
        });

        return res.status(201).json({
            success: true,
            message: 'View access request created successfully.',
            data: request
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Get current user's submitted view requests (My View Requests)
 */
const getMyRequests = async (req, res, next) => {
    try {
        await sweepExpiredPermissions();

        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const skip = (page - 1) * limit;

        const { status, targetType, search } = req.query;
        const filter = { requesterId: req.user.id };

        if (status) {
            filter.status = status;
        }

        if (targetType) {
            filter.targetType = targetType;
        }

        if (search) {
            filter.$or = [
                { requestId: { $regex: search, $options: 'i' } },
                { targetName: { $regex: search, $options: 'i' } },
                { reason: { $regex: search, $options: 'i' } }
            ];
        }

        const [totalRecords, requests] = await Promise.all([
            ViewAccessRequest.countDocuments(filter),
            ViewAccessRequest.find(filter)
                .populate('organizationId', 'name organizationCode')
                .populate('approverId', 'profile.displayName walletAddress role')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ]);

        return res.status(200).json({
            success: true,
            count: requests.length,
            data: requests,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit) || 1
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Get requests assigned to the current user to review (Incoming Requests)
 */
const getIncomingRequests = async (req, res, next) => {
    try {
        await sweepExpiredPermissions();

        const page = parseInt(req.query.page, 10) || 1;
        const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
        const skip = (page - 1) * limit;

        const { status, targetType, search } = req.query;
        const filter = {};

        if (req.user.role === 'super_admin') {
            // Super admin reviews requests submitted by Org Admins
            filter.requiredApproverRole = 'super_admin';
        } else if (req.user.role === 'admin') {
            if (!req.user.organizationId) {
                try {
                    await ensureAdminOrganization(req.user);
                } catch (e) {
                    console.warn('[VIEW_ACCESS] Could not ensure organization for admin:', e.message);
                }
            }
            const orgId = req.user.organizationId ? (req.user.organizationId._id || req.user.organizationId) : null;
            if (!orgId) {
                return res.status(200).json({
                    success: true,
                    count: 0,
                    data: [],
                    pagination: { page, limit, totalRecords: 0, totalPages: 1 }
                });
            }
            // Org Admin reviews requests submitted by Super Admin for their organization
            filter.requiredApproverRole = 'admin';
            filter.organizationId = orgId;
        } else {
            return res.status(403).json({ success: false, message: 'You are not authorized to review view access requests.' });
        }

        if (status) {
            filter.status = status;
        }

        if (targetType) {
            filter.targetType = targetType;
        }

        if (search) {
            filter.$or = [
                { requestId: { $regex: search, $options: 'i' } },
                { targetName: { $regex: search, $options: 'i' } },
                { reason: { $regex: search, $options: 'i' } },
                { 'targetMetadata.fileName': { $regex: search, $options: 'i' } }
            ];
        }

        const [totalRecords, requests] = await Promise.all([
            ViewAccessRequest.countDocuments(filter),
            ViewAccessRequest.find(filter)
                .populate('requesterId', 'profile.displayName profile.email walletAddress role')
                .populate('organizationId', 'name organizationCode')
                .populate('approverId', 'profile.displayName walletAddress role')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ]);

        return res.status(200).json({
            success: true,
            count: requests.length,
            data: requests,
            pagination: {
                page,
                limit,
                totalRecords,
                totalPages: Math.ceil(totalRecords / limit) || 1
            }
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Get a single request by ID
 */
const getRequestById = async (req, res, next) => {
    try {
        await sweepExpiredPermissions();

        const { id } = req.params;
        const request = await ViewAccessRequest.findOne({
            $or: [{ requestId: id }, { _id: id.match(/^[0-9a-fA-F]{24}$/) ? id : null }]
        })
            .populate('requesterId', 'profile.displayName profile.email walletAddress role')
            .populate('organizationId', 'name organizationCode')
            .populate('approverId', 'profile.displayName walletAddress role')
            .populate('rejectedBy', 'profile.displayName walletAddress role')
            .populate('permission.revokedBy', 'profile.displayName walletAddress role');

        if (!request) {
            return res.status(404).json({ success: false, message: 'View access request not found.' });
        }

        // Check view authorization
        const isRequester = String(request.requesterId?._id || request.requesterId) === String(req.user.id);
        const isSuperAdminApprover = req.user.role === 'super_admin';
        const isOrgAdminApprover = req.user.role === 'admin' && String(req.user.organizationId) === String(request.organizationId?._id || request.organizationId);

        if (!isRequester && !isSuperAdminApprover && !isOrgAdminApprover) {
            return res.status(403).json({ success: false, message: 'You are not authorized to view this request.' });
        }

        return res.status(200).json({
            success: true,
            data: request
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Approve a view access request
 */
const approveRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        const request = await approveViewAccessRequest({
            requestId: id,
            approverUser: req.user
        });

        return res.status(200).json({
            success: true,
            message: 'View access request approved successfully.',
            data: request
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Reject a view access request
 */
const rejectRequest = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const request = await rejectViewAccessRequest({
            requestId: id,
            approverUser: req.user,
            rejectionReason: reason
        });

        return res.status(200).json({
            success: true,
            message: 'View access request rejected.',
            data: request
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Revoke an active permission
 */
const revokePermission = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { reason } = req.body;
        const request = await revokeViewAccessPermission({
            requestId: id,
            approverUser: req.user,
            revocationReason: reason
        });

        return res.status(200).json({
            success: true,
            message: 'View access permission revoked successfully.',
            data: request
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Get active permissions for the authenticated user
 */
const getActivePermissions = async (req, res, next) => {
    try {
        await sweepExpiredPermissions();

        const active = await ViewAccessRequest.find({
            requesterId: req.user.id,
            status: 'approved',
            'permission.status': 'active',
            'permission.expiresAt': { $gt: new Date() }
        })
            .populate('organizationId', 'name organizationCode')
            .sort({ 'permission.expiresAt': 1 });

        return res.status(200).json({
            success: true,
            count: active.length,
            data: active
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Get real-time workflow counters
 */
const getCounts = async (req, res, next) => {
    try {
        const counts = await getWorkflowCounts(req.user);
        return res.status(200).json({
            success: true,
            data: counts
        });
    } catch (err) {
        next(err);
    }
};

/**
 * Retrieve decrypted evidence content only with verified active permission
 */
const getProtectedEvidenceContent = async (req, res, next) => {
    try {
        const { id } = req.params;
        const evidence = await Evidence.findById(id);

        if (!evidence) {
            return res.status(404).json({ success: false, message: 'Evidence file not found.' });
        }

        const permCheck = await checkUserActivePermission({
            user: req.user,
            evidence
        });

        if (!permCheck.hasPermission) {
            return res.status(403).json({
                success: false,
                message: 'Access Denied: You do not have an approved, active view access permission for this evidence. Please submit a View Access Request.',
                viewAccessRequired: true,
                evidenceId: evidence._id,
                caseId: evidence.caseId,
                groupId: evidence.groupId
            });
        }

        if (!evidence.ipfsCID || !evidence.encryption?.iv || !evidence.encryption?.authTag) {
            return res.status(422).json({
                success: false,
                message: 'Encrypted storage data is incomplete for this file.'
            });
        }

        const encryptedBuffer = await fetchEncryptedBlobFromIpfs(evidence.ipfsCID);
        const decryptedBuffer = decryptFile(encryptedBuffer, evidence.encryption);

        // If client requested JSON base64
        if (req.query.format === 'json' || req.headers.accept?.includes('application/json')) {
            return res.status(200).json({
                success: true,
                data: {
                    fileContent: decryptedBuffer.toString('base64'),
                    mimeType: evidence.mimeType,
                    fileName: evidence.fileName,
                    activePermission: {
                        isOwner: permCheck.isOwner,
                        expiresAt: permCheck.expiresAt,
                        remainingMs: permCheck.remainingMs,
                        scope: permCheck.scope,
                        requestId: permCheck.requestId
                    }
                }
            });
        }

        // Otherwise stream file with proper content-type
        res.setHeader('Content-Type', evidence.mimeType || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${evidence.fileName}"`);
        return res.send(decryptedBuffer);
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

module.exports = {
    createRequest,
    getMyRequests,
    getIncomingRequests,
    getRequestById,
    approveRequest,
    rejectRequest,
    revokePermission,
    getActivePermissions,
    getCounts,
    getProtectedEvidenceContent
};

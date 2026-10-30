const crypto = require('crypto');
const mongoose = require('mongoose');
const ViewAccessRequest = require('../model/viewAccessRequestModel');
const Evidence = require('../model/evidenceModel');
const Group = require('../model/groupModel');
const Organization = require('../model/organizationModel');
const User = require('../model/userModel');
const { createNotification } = require('./notificationService');
const { emitViewAccessEvent } = require('./socketService');
const { writeAuditLog } = require('./auditService');

const DURATION_MAP = {
    '1h': 1 * 60 * 60 * 1000,
    '6h': 6 * 60 * 60 * 1000,
    '12h': 12 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
    '2d': 48 * 60 * 60 * 1000
};

/**
 * Sweeps expired permissions to ensure database status reflects server time
 */
async function sweepExpiredPermissions() {
    const now = new Date();
    await ViewAccessRequest.updateMany(
        {
            status: 'approved',
            'permission.status': 'active',
            'permission.expiresAt': { $lte: now }
        },
        {
            $set: {
                status: 'expired',
                'permission.status': 'expired'
            }
        }
    );
}

/**
 * Create a new view access request
 */
async function createViewAccessRequest({ user, targetType, targetId, organizationId, reason, duration }) {
    if (!['admin', 'super_admin', 'officer', 'citizen'].includes(user.role)) {
        const err = new Error('You are not authorized to submit view access requests.');
        err.statusCode = 403;
        throw err;
    }

    if (user.role === 'admin' && !user.organizationId) {
        try {
            const { ensureAdminOrganization } = require('./organizationService');
            await ensureAdminOrganization(user);
        } catch (_) {}
    }

    if (!['evidence', 'case', 'group'].includes(targetType)) {
        const err = new Error('targetType must be "evidence", "case", or "group".');
        err.statusCode = 400;
        throw err;
    }

    if (!targetId || typeof targetId !== 'string' || !targetId.trim()) {
        const err = new Error('Valid targetId is required.');
        err.statusCode = 400;
        throw err;
    }

    const cleanReason = String(reason || '').trim();
    if (!cleanReason || cleanReason.length < 3) {
        const err = new Error('A valid reason of at least 3 characters is required.');
        err.statusCode = 400;
        throw err;
    }

    if (!DURATION_MAP[duration]) {
        const err = new Error('Duration must be one of: 1h, 6h, 12h, 1d, 2d.');
        err.statusCode = 400;
        throw err;
    }

    const durationMs = DURATION_MAP[duration];
    let resolvedOrgId = null;
    let targetName = '';
    const targetMetadata = {};
    let evidenceObjId = null;
    let groupObjId = null;
    let resolvedCaseId = null;

    // Resolve target details and validate boundaries
    if (targetType === 'evidence') {
        if (!mongoose.Types.ObjectId.isValid(targetId)) {
            const err = new Error(`Invalid Evidence ID format "${targetId}". Must be a 24-character hexadecimal identifier.`);
            err.statusCode = 400;
            throw err;
        }

        const evidence = await Evidence.findById(targetId).populate('organizationId', 'name organizationCode');
        if (!evidence) {
            const err = new Error('Target evidence record not found.');
            err.statusCode = 404;
            throw err;
        }

        resolvedOrgId = evidence.organizationId?._id || evidence.organizationId;
        if (!resolvedOrgId) {
            if (organizationId && mongoose.Types.ObjectId.isValid(organizationId)) {
                resolvedOrgId = organizationId;
            } else if (evidence.uploadedBy) {
                const uploaderUser = await User.findById(evidence.uploadedBy).select('organizationId');
                if (uploaderUser?.organizationId) {
                    resolvedOrgId = uploaderUser.organizationId;
                }
            }
        }
        if (!resolvedOrgId) {
            const err = new Error('The target evidence is not associated with an organization.');
            err.statusCode = 400;
            throw err;
        }

        // If Org Admin or Officer is requesting, ensure the evidence belongs to their organization
        if (user.role === 'admin' || user.role === 'officer') {
            const userOrgStr = String(user.organizationId || '');
            const evidenceOrgStr = String(resolvedOrgId);
            if (!userOrgStr || userOrgStr !== evidenceOrgStr) {
                const err = new Error(`${user.role === 'admin' ? 'Organization Admins' : 'Employees'} can only request access to evidence within their assigned organization.`);
                err.statusCode = 403;
                throw err;
            }
        }

        evidenceObjId = evidence._id;
        targetName = evidence.fileName || 'Evidence File';
        targetMetadata.fileName = evidence.fileName;
        targetMetadata.mimeType = evidence.mimeType;
        targetMetadata.fileSize = evidence.fileSize;
        targetMetadata.caseId = evidence.caseId || null;
        targetMetadata.orgName = evidence.organizationId?.name || null;
    } else if (targetType === 'case') {
        resolvedCaseId = targetId.trim();
        targetName = `Case ${resolvedCaseId}`;
        targetMetadata.caseId = resolvedCaseId;

        // If user is Org Admin, use their organizationId
        if (user.role === 'admin') {
            resolvedOrgId = user.organizationId;
        } else {
            // Super admin must specify organizationId for the case
            if (!organizationId) {
                const err = new Error('organizationId is required when requesting Case scope access.');
                err.statusCode = 400;
                throw err;
            }
            resolvedOrgId = organizationId;
        }

        // Verify case exists in this organization
        const caseCount = await Evidence.countDocuments({ organizationId: resolvedOrgId, caseId: resolvedCaseId });
        if (caseCount === 0) {
            const err = new Error(`No evidence files found for Case ID "${resolvedCaseId}" under the specified organization.`);
            err.statusCode = 404;
            throw err;
        }

        const orgDoc = await Organization.findById(resolvedOrgId).select('name');
        targetMetadata.orgName = orgDoc?.name || null;
    } else if (targetType === 'group') {
        if (!mongoose.Types.ObjectId.isValid(targetId)) {
            const err = new Error(`Invalid Group ID format "${targetId}". Must be a 24-character hexadecimal identifier.`);
            err.statusCode = 400;
            throw err;
        }

        const group = await Group.findById(targetId);
        if (!group) {
            const err = new Error('Target group not found.');
            err.statusCode = 404;
            throw err;
        }

        resolvedOrgId = group.organizationId;
        if (user.role === 'admin' || user.role === 'officer') {
            const userOrgStr = String(user.organizationId || '');
            const groupOrgStr = String(resolvedOrgId);
            if (!userOrgStr || userOrgStr !== groupOrgStr) {
                const err = new Error(`${user.role === 'admin' ? 'Organization Admins' : 'Employees'} can only request access to groups within their assigned organization.`);
                err.statusCode = 403;
                throw err;
            }
        }

        groupObjId = group._id;
        targetName = group.name || 'Evidence Group';
        targetMetadata.groupName = group.name;
        const orgDoc = await Organization.findById(resolvedOrgId).select('name');
        targetMetadata.orgName = orgDoc?.name || null;
    }

    // Determine required approver role
    const requiredApproverRole = user.role === 'admin' ? 'super_admin' : 'admin';

    // Sweep expired to get clean state
    await sweepExpiredPermissions();

    // Check for existing pending request or active permission for this target and requester
    const existingActive = await ViewAccessRequest.findOne({
        requesterId: user.id,
        targetType,
        targetId,
        $or: [
            { status: 'pending' },
            { status: 'approved', 'permission.status': 'active', 'permission.expiresAt': { $gt: new Date() } }
        ]
    });

    if (existingActive) {
        if (existingActive.status === 'pending') {
            const err = new Error('You already have a pending view access request for this item.');
            err.statusCode = 409;
            throw err;
        }
        if (existingActive.status === 'approved') {
            const err = new Error('You already have active view access for this item.');
            err.statusCode = 409;
            throw err;
        }
    }

    const requestId = `VAR-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

    const newRequest = await ViewAccessRequest.create({
        requestId,
        requesterId: user.id,
        requesterRole: user.role,
        requesterWallet: user.walletAddress || '',
        organizationId: resolvedOrgId,
        targetType,
        targetId,
        evidenceId: evidenceObjId,
        groupId: groupObjId,
        caseId: resolvedCaseId,
        targetName,
        targetMetadata,
        reason: cleanReason,
        requestedDuration: duration,
        durationMs,
        requiredApproverRole,
        status: 'pending'
    });

    await writeAuditLog({
        actor: user,
        organizationId: resolvedOrgId,
        action: 'view_access_request_created',
        targetType,
        targetId: String(targetId),
        metadata: {
            requestId,
            targetName,
            requestedDuration: duration
        }
    });

    // Notify approver
    if (requiredApproverRole === 'super_admin') {
        // Find super admins
        const superAdmins = await User.find({ role: 'super_admin', accountStatus: { $ne: 'suspended' } }).select('_id');
        for (const sa of superAdmins) {
            await createNotification({
                recipientId: sa._id,
                organizationId: resolvedOrgId,
                type: 'view_request_created',
                title: 'New View Access Request',
                message: `Organization Admin requested view access for ${targetType} "${targetName}" (${duration}).`,
                actionUrl: `/superadmin/view-requests`,
                metadata: {
                    requestId,
                    targetType,
                    targetId,
                    targetName,
                    requesterId: user.id,
                    requesterRole: user.role
                }
            });
        }
    } else {
        // Required approver is Org Admin of resolvedOrgId
        let orgAdmins = await User.find({
            organizationId: resolvedOrgId,
            role: 'admin',
            accountStatus: { $ne: 'suspended' }
        }).select('_id');

        if (!orgAdmins.length) {
            const orgDoc = await Organization.findById(resolvedOrgId).select('adminId createdBy');
            const candidateIds = [orgDoc?.adminId, orgDoc?.createdBy].filter(Boolean);
            if (candidateIds.length) {
                orgAdmins = await User.find({
                    _id: { $in: candidateIds },
                    accountStatus: { $ne: 'suspended' }
                }).select('_id');
            }
        }

        for (const oa of orgAdmins) {
            await createNotification({
                recipientId: oa._id,
                organizationId: resolvedOrgId,
                type: 'view_request_created',
                title: 'Super Admin Requested View Access',
                message: `Super Admin requested view access for ${targetType} "${targetName}" (${duration}).`,
                actionUrl: `/admin/view-requests`,
                metadata: {
                    requestId,
                    targetType,
                    targetId,
                    targetName,
                    requesterId: user.id,
                    requesterRole: user.role
                }
            });
        }
    }

    // Socket.IO real-time broadcast
    emitViewAccessEvent('view_access_request_created', {
        requestId,
        organizationId: resolvedOrgId,
        requesterId: user.id,
        targetType,
        targetId,
        targetName,
        status: 'pending',
        requestedDuration: duration,
        requiredApproverRole
    });

    return newRequest;
}

/**
 * Approve a view access request
 */
async function approveViewAccessRequest({ requestId, approverUser }) {
    await sweepExpiredPermissions();

    const request = await ViewAccessRequest.findOne({
        $or: [
            { requestId },
            ...(mongoose.Types.ObjectId.isValid(requestId) ? [{ _id: requestId }] : [])
        ]
    }).populate('requesterId', 'profile walletAddress role');
    if (!request) {
        const err = new Error('View access request not found.');
        err.statusCode = 404;
        throw err;
    }

    if (request.status !== 'pending') {
        const err = new Error(`Cannot approve request with status "${request.status}". Only pending requests can be approved.`);
        err.statusCode = 409;
        throw err;
    }

    // Prevent self-approval
    if (String(request.requesterId?._id || request.requesterId) === String(approverUser.id)) {
        const err = new Error('Self-approval is strictly forbidden.');
        err.statusCode = 403;
        throw err;
    }

    // Role-based approver verification
    if (request.requiredApproverRole === 'super_admin') {
        if (approverUser.role !== 'super_admin') {
            const err = new Error('Only Super Admin can approve this view access request.');
            err.statusCode = 403;
            throw err;
        }
    } else if (request.requiredApproverRole === 'admin') {
        if (approverUser.role !== 'admin') {
            const err = new Error('Only an Organization Admin can approve this view access request.');
            err.statusCode = 403;
            throw err;
        }
        // Strict organization boundary: approver must belong to the request's organization
        const approverOrgStr = String(approverUser.organizationId || '');
        const requestOrgStr = String(request.organizationId || '');
        if (!approverOrgStr || approverOrgStr !== requestOrgStr) {
            const err = new Error('You cannot approve a view access request for another organization.');
            err.statusCode = 403;
            throw err;
        }
    } else {
        const err = new Error('Invalid required approver role.');
        err.statusCode = 400;
        throw err;
    }

    // Compute server-calculated expiration
    const approvedAt = new Date();
    const expiresAt = new Date(approvedAt.getTime() + request.durationMs);

    request.status = 'approved';
    request.approverId = approverUser.id;
    request.approvedAt = approvedAt;
    request.permission = {
        approvedScope: request.targetType,
        targetType: request.targetType,
        targetId: request.targetId,
        approvedAt,
        expiresAt,
        status: 'active',
        revokedAt: null,
        revokedBy: null,
        revocationReason: null
    };

    await request.save();

    await writeAuditLog({
        actor: approverUser,
        organizationId: request.organizationId,
        action: 'view_access_request_approved',
        targetType: request.targetType,
        targetId: String(request.targetId),
        metadata: {
            requestId: request.requestId,
            targetName: request.targetName,
            expiresAt: expiresAt.toISOString()
        }
    });

    // Notify requester
    const requesterId = request.requesterId?._id || request.requesterId;
    const destUrl = request.requesterRole === 'super_admin'
        ? '/superadmin/view-requests'
        : request.requesterRole === 'admin'
        ? '/admin/view-requests'
        : `/citizen/evidence/${request.targetId}`;
    await createNotification({
        recipientId: requesterId,
        organizationId: request.organizationId,
        type: 'view_request_approved',
        title: 'View Access Approved',
        message: `Your view request for ${request.targetType} "${request.targetName}" was approved. Access expires at ${expiresAt.toLocaleTimeString()} (${request.requestedDuration}).`,
        actionUrl: destUrl,
        metadata: {
            requestId: request.requestId,
            targetType: request.targetType,
            targetId: request.targetId,
            expiresAt
        }
    });

    emitViewAccessEvent('view_access_approved', {
        requestId: request.requestId,
        organizationId: request.organizationId,
        requesterId,
        targetType: request.targetType,
        targetId: request.targetId,
        status: 'approved',
        expiresAt
    });

    return request;
}

/**
 * Reject a view access request
 */
async function rejectViewAccessRequest({ requestId, approverUser, rejectionReason }) {
    await sweepExpiredPermissions();

    const request = await ViewAccessRequest.findOne({
        $or: [
            { requestId },
            ...(mongoose.Types.ObjectId.isValid(requestId) ? [{ _id: requestId }] : [])
        ]
    }).populate('requesterId', 'profile walletAddress role');
    if (!request) {
        const err = new Error('View access request not found.');
        err.statusCode = 404;
        throw err;
    }

    if (request.status !== 'pending') {
        const err = new Error(`Cannot reject request with status "${request.status}". Only pending requests can be rejected.`);
        err.statusCode = 409;
        throw err;
    }

    // Prevent self-decision
    if (String(request.requesterId?._id || request.requesterId) === String(approverUser.id)) {
        const err = new Error('You cannot reject your own request.');
        err.statusCode = 403;
        throw err;
    }

    if (request.requiredApproverRole === 'super_admin') {
        if (approverUser.role !== 'super_admin') {
            const err = new Error('Only Super Admin can reject this request.');
            err.statusCode = 403;
            throw err;
        }
    } else if (request.requiredApproverRole === 'admin') {
        if (approverUser.role !== 'admin') {
            const err = new Error('Only an Organization Admin can reject this request.');
            err.statusCode = 403;
            throw err;
        }
        const approverOrgStr = String(approverUser.organizationId || '');
        const requestOrgStr = String(request.organizationId || '');
        if (!approverOrgStr || approverOrgStr !== requestOrgStr) {
            const err = new Error('You cannot reject a view access request for another organization.');
            err.statusCode = 403;
            throw err;
        }
    }

    const cleanReason = String(rejectionReason || 'Access request rejected by administrator.').trim();

    request.status = 'rejected';
    request.rejectedBy = approverUser.id;
    request.rejectedAt = new Date();
    request.rejectionReason = cleanReason;
    await request.save();

    await writeAuditLog({
        actor: approverUser,
        organizationId: request.organizationId,
        action: 'view_access_request_rejected',
        targetType: request.targetType,
        targetId: String(request.targetId),
        reason: cleanReason,
        metadata: {
            requestId: request.requestId,
            targetName: request.targetName
        }
    });

    const requesterId = request.requesterId?._id || request.requesterId;
    const destUrl = request.requesterRole === 'super_admin'
        ? '/superadmin/view-requests'
        : request.requesterRole === 'admin'
        ? '/admin/view-requests'
        : `/citizen/evidence/${request.targetId}`;
    await createNotification({
        recipientId: requesterId,
        organizationId: request.organizationId,
        type: 'view_request_rejected',
        title: 'View Access Request Rejected',
        message: `Your view request for ${request.targetType} "${request.targetName}" was rejected: ${cleanReason}`,
        actionUrl: destUrl,
        metadata: {
            requestId: request.requestId,
            targetType: request.targetType,
            targetId: request.targetId,
            rejectionReason: cleanReason
        }
    });

    emitViewAccessEvent('view_access_rejected', {
        requestId: request.requestId,
        organizationId: request.organizationId,
        requesterId,
        targetType: request.targetType,
        targetId: request.targetId,
        status: 'rejected',
        rejectionReason: cleanReason
    });

    return request;
}

/**
 * Revoke an active permission grant
 */
async function revokeViewAccessPermission({ requestId, approverUser, revocationReason }) {
    await sweepExpiredPermissions();

    const request = await ViewAccessRequest.findOne({
        $or: [
            { requestId },
            ...(mongoose.Types.ObjectId.isValid(requestId) ? [{ _id: requestId }] : [])
        ]
    }).populate('requesterId', 'profile walletAddress role');
    if (!request) {
        const err = new Error('View access request not found.');
        err.statusCode = 404;
        throw err;
    }

    if (request.status !== 'approved' || request.permission?.status !== 'active') {
        const err = new Error('Only approved, active permissions can be revoked.');
        err.statusCode = 409;
        throw err;
    }

    // Authorization check: Super Admin or Org Admin of that org
    if (approverUser.role === 'super_admin') {
        // Allowed
    } else if (approverUser.role === 'admin') {
        const approverOrgStr = String(approverUser.organizationId || '');
        const requestOrgStr = String(request.organizationId || '');
        if (!approverOrgStr || approverOrgStr !== requestOrgStr) {
            const err = new Error('You cannot revoke access permissions for another organization.');
            err.statusCode = 403;
            throw err;
        }
    } else {
        const err = new Error('Unauthorized to revoke view permissions.');
        err.statusCode = 403;
        throw err;
    }

    const cleanReason = String(revocationReason || 'Access revoked by administrator.').trim();

    request.status = 'revoked';
    request.permission.status = 'revoked';
    request.permission.revokedAt = new Date();
    request.permission.revokedBy = approverUser.id;
    request.permission.revocationReason = cleanReason;

    await request.save();

    await writeAuditLog({
        actor: approverUser,
        organizationId: request.organizationId,
        action: 'view_access_revoked',
        targetType: request.targetType,
        targetId: String(request.targetId),
        reason: cleanReason,
        metadata: {
            requestId: request.requestId,
            targetName: request.targetName
        }
    });

    const requesterId = request.requesterId?._id || request.requesterId;
    await createNotification({
        recipientId: requesterId,
        organizationId: request.organizationId,
        type: 'view_request_revoked',
        title: 'View Access Revoked',
        message: `Your view permission for ${request.targetType} "${request.targetName}" has been revoked: ${cleanReason}`,
        actionUrl: request.requesterRole === 'super_admin'
            ? '/superadmin/view-requests'
            : request.requesterRole === 'admin'
            ? '/admin/view-requests'
            : `/citizen/evidence/${request.targetId}`,
        metadata: {
            requestId: request.requestId,
            targetType: request.targetType,
            targetId: request.targetId,
            revocationReason: cleanReason
        }
    });

    emitViewAccessEvent('view_access_revoked', {
        requestId: request.requestId,
        organizationId: request.organizationId,
        requesterId,
        targetType: request.targetType,
        targetId: request.targetId,
        status: 'revoked',
        revocationReason: cleanReason
    });

    return request;
}

/**
 * Check if a user currently has an active, unexpired view permission for an evidence file
 */
async function checkUserActivePermission({ user, evidence }) {
    if (!user || !evidence) return { hasPermission: false };

    // Uploader/owner always retains access to their own files
    const ownerId = evidence.user?.toString?.() || String(evidence.user || '');
    const uploader = String(evidence.UploaderWallet || '').toLowerCase();
    const isOwner = ownerId === String(user.id) || uploader === String(user.walletAddress || '').toLowerCase();
    if (isOwner) {
        return {
            hasPermission: true,
            isOwner: true,
            scope: 'owner'
        };
    }

    // Sweep expired to guarantee accurate server time check
    await sweepExpiredPermissions();

    const now = new Date();
    const evidenceIdStr = evidence._id ? evidence._id.toString() : String(evidence);
    const caseIdStr = evidence.caseId ? String(evidence.caseId).trim() : null;
    const groupIdStr = evidence.groupId ? String(evidence.groupId._id || evidence.groupId).trim() : null;
    const evidenceOrgId = evidence.organizationId ? String(evidence.organizationId._id || evidence.organizationId).trim() : null;

    // Conditions covering evidence, case, or group
    const targetConditions = [
        { targetType: 'evidence', targetId: evidenceIdStr }
    ];

    if (caseIdStr && evidenceOrgId) {
        targetConditions.push({ targetType: 'case', targetId: caseIdStr, organizationId: evidenceOrgId });
    }

    if (groupIdStr && evidenceOrgId) {
        targetConditions.push({ targetType: 'group', targetId: groupIdStr, organizationId: evidenceOrgId });
    }

    const activeGrant = await ViewAccessRequest.findOne({
        requesterId: user.id,
        status: 'approved',
        'permission.status': 'active',
        'permission.expiresAt': { $gt: now },
        $or: targetConditions
    }).sort({ 'permission.expiresAt': -1 });

    if (activeGrant) {
        const expiresAt = activeGrant.permission.expiresAt;
        const remainingMs = Math.max(0, expiresAt.getTime() - now.getTime());
        return {
            hasPermission: true,
            isOwner: false,
            requestId: activeGrant.requestId,
            scope: activeGrant.targetType,
            expiresAt,
            remainingMs
        };
    }

    return { hasPermission: false, isOwner: false };
}

/**
 * Get unified real-time workflow counters
 */
async function getWorkflowCounts(user) {
    if (!user) {
        return { unreadNotifications: 0, pendingUploadApprovals: 0, pendingViewApprovals: 0 };
    }

    if (user.role === 'admin' && !user.organizationId) {
        try {
            const { ensureAdminOrganization } = require('./organizationService');
            await ensureAdminOrganization(user);
        } catch (_) {}
    }

    await sweepExpiredPermissions();

    const Notification = require('../model/notificationModel');
    const PendingUploadRequest = require('../model/pendingUploadRequestModel');

    const orgId = user.organizationId ? (user.organizationId._id || user.organizationId) : null;

    // 1. Unread notifications
    const unreadNotifications = await Notification.countDocuments({
        recipientId: user.id,
        read: false
    });

    // 2. Pending upload approvals
    let pendingUploadApprovals = 0;
    if (user.role === 'admin' && orgId) {
        pendingUploadApprovals = await PendingUploadRequest.countDocuments({
            organizationId: orgId,
            workflowStatus: 'PENDING_REVIEW'
        });
    } else if (user.role === 'super_admin') {
        pendingUploadApprovals = await PendingUploadRequest.countDocuments({
            workflowStatus: 'PENDING_REVIEW'
        });
    }

    // 3. Pending view access approvals assigned to this user to review
    let pendingViewApprovals = 0;
    if (user.role === 'super_admin') {
        // Super admin reviews Org Admin requests
        pendingViewApprovals = await ViewAccessRequest.countDocuments({
            requiredApproverRole: 'super_admin',
            status: 'pending'
        });
    } else if (user.role === 'admin' && orgId) {
        // Org Admin reviews Super Admin requests for their organization
        pendingViewApprovals = await ViewAccessRequest.countDocuments({
            organizationId: orgId,
            requiredApproverRole: 'admin',
            status: 'pending'
        });
    }

    // 4. Current user's own pending view requests
    const myPendingViewRequests = await ViewAccessRequest.countDocuments({
        requesterId: user.id,
        status: 'pending'
    });

    // 5. Current user's active view permissions
    const myActivePermissions = await ViewAccessRequest.countDocuments({
        requesterId: user.id,
        status: 'approved',
        'permission.status': 'active',
        'permission.expiresAt': { $gt: new Date() }
    });

    return {
        unreadNotifications,
        pendingUploadApprovals,
        pendingViewApprovals,
        myPendingViewRequests,
        myActivePermissions
    };
}

module.exports = {
    DURATION_MAP,
    createViewAccessRequest,
    approveViewAccessRequest,
    rejectViewAccessRequest,
    revokeViewAccessPermission,
    checkUserActivePermission,
    getWorkflowCounts,
    sweepExpiredPermissions
};

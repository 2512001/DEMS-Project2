function httpError(statusCode, message) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
}

function isAdmin(user) {
    return user?.role === 'admin' || user?.role === 'super_admin';
}

function isSuperAdmin(user) {
    return user?.role === 'super_admin';
}

function isOrgAdmin(user) {
    return user?.role === 'admin' && user?.organizationId;
}

function isEmployee(user) {
    return user?.role === 'officer';
}

function isNormalUser(user) {
    return user?.role === 'citizen';
}

function orgIdOf(value) {
    if (!value) return '';
    return String(value._id || value).trim();
}

function sameOrganization(user, organizationId) {
    return Boolean(user?.organizationId && organizationId && orgIdOf(user.organizationId) === orgIdOf(organizationId));
}

function isEvidenceOwner(user, evidence) {
    if (!user || !evidence) return false;
    const ownerId = evidence.user?.toString?.() || String(evidence.user || '');
    const uploader = String(evidence.UploaderWallet || '').toLowerCase();
    return ownerId === user.id || uploader === String(user.walletAddress || '').toLowerCase();
}

async function canAccessEvidence(user, evidence) {
    if (!user || !evidence) return false;
    
    // Super admin can access all evidence
    if (isSuperAdmin(user)) return true;
    
    if (isEvidenceOwner(user, evidence)) return true;
    if (isAdmin(user) && sameOrganization(user, evidence.organizationId)) return true;

    // Allow members of the same organization to view metadata
    if (sameOrganization(user, evidence.organizationId)) return true;

    // Check if user has an approved, active temporary permission
    const ViewAccessRequest = require('../model/viewAccessRequestModel');
    const hasActiveGrant = await ViewAccessRequest.exists({
        requesterId: user.id,
        status: 'approved',
        'permission.status': 'active',
        'permission.expiresAt': { $gt: new Date() },
        $or: [
            { targetType: 'evidence', targetId: evidence._id.toString() },
            ...(evidence.caseId ? [{ targetType: 'case', targetId: evidence.caseId }] : []),
            ...(evidence.groupId ? [{ targetType: 'group', targetId: evidence.groupId.toString() }] : [])
        ]
    });
    if (hasActiveGrant) return true;
    
    if (sameOrganization(user, evidence.organizationId) && evidence.groupId) {
        const Group = require('../model/groupModel');
        const group = await Group.findById(evidence.groupId);
        if (group && group.members.includes(user.id)) {
            return true;
        }
    }
    
    return false;
}

async function canVerifyEvidence(user, evidence) {
    return await canAccessEvidence(user, evidence);
}

function requireOrgAdmin(user) {
    if (!isAdmin(user)) {
        throw httpError(403, 'You are not authorized to access this resource.');
    }
    if (!user.organizationId && !isSuperAdmin(user)) {
        throw httpError(409, 'Create or join an organization before managing organization data.');
    }
}

module.exports = {
    httpError,
    isAdmin,
    isSuperAdmin,
    isOrgAdmin,
    isEmployee,
    isNormalUser,
    orgIdOf,
    sameOrganization,
    isEvidenceOwner,
    canAccessEvidence,
    canVerifyEvidence,
    requireOrgAdmin
};

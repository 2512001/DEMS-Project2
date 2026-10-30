const Organization = require('../model/organizationModel');
const User = require('../model/userModel');
const { httpError } = require('./accessControl');

function generateOrganizationCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

async function ensureAdminOrganization(user) {
    if (!user || user.role !== 'admin') {
        throw httpError(403, 'You are not authorized to access this resource.');
    }

    if (user.organizationId) {
        const organization = await Organization.findById(user.organizationId);
        if (organization) {
            return organization;
        }
    }

    const existing = await Organization.findOne({
        $or: [
            { adminId: user.id },
            { createdBy: user.id }
        ]
    }).sort({ createdAt: 1 });

    if (existing) {
        await User.findByIdAndUpdate(user.id, { $set: { organizationId: existing._id } });
        user.organizationId = existing._id.toString();
        return existing;
    }

    throw httpError(409, 'Create an organization from Organization Settings before managing organization data.');
}

async function createOrganizationForAdmin(user, name) {
    if (!user || user.role !== 'admin') {
        const error = new Error('You are not authorized to access this resource.');
        error.statusCode = 403;
        throw error;
    }

    if (user.organizationId) {
        return Organization.findById(user.organizationId);
    }

    const trimmed = String(name || '').trim().slice(0, 160);
    if (!trimmed) {
        const error = new Error('Create an organization from Organization Settings before managing organization data.');
        error.statusCode = 409;
        throw error;
    }

    const organization = await Organization.create({
        name: trimmed,
        organizationCode: generateOrganizationCode(),
        createdBy: user.id,
        adminId: user.id,
        status: 'active',
        policy: {
            requireAIForEmployees: true,
            requireBlockchainForEmployees: false
        }
    });

    await User.findByIdAndUpdate(user.id, { $set: { organizationId: organization._id } });
    user.organizationId = organization._id.toString();
    return organization;
}

async function getOrganizationPolicy(organizationId) {
    if (!organizationId) {
        return {
            requireAIForEmployees: true,
            requireBlockchainForEmployees: false
        };
    }

    const organization = await Organization.findById(organizationId).select('policy');
    return {
        requireAIForEmployees: organization?.policy?.requireAIForEmployees !== false,
        requireBlockchainForEmployees: Boolean(organization?.policy?.requireBlockchainForEmployees)
    };
}

module.exports = {
    ensureAdminOrganization,
    createOrganizationForAdmin,
    getOrganizationPolicy,
    generateOrganizationCode
};

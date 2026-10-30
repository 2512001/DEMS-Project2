const mongoose = require('mongoose');
const AuditLog = require('../model/auditLogModel');

async function writeAuditLog({
    actor,
    organizationId = null,
    action,
    targetType = '',
    targetId = '',
    result = 'success',
    reason = '',
    metadata = {}
}) {
    try {
        const actorId = (actor?.id && mongoose.Types.ObjectId.isValid(actor.id))
            ? new mongoose.Types.ObjectId(actor.id)
            : null;

        await AuditLog.create({
            actorId,
            actorWallet: actor?.walletAddress || '',
            organizationId: organizationId || actor?.organizationId || null,
            action,
            targetType,
            targetId: targetId ? String(targetId) : '',
            result,
            reason,
            metadata
        });
    } catch (err) {
        console.error('[AUDIT] Failed to write audit log:', err.message);
    }
}

module.exports = {
    writeAuditLog
};

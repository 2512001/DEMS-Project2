const QuarantineEvidence = require('../model/quarantineEvidenceModel');
const User = require('../model/userModel');
const { requireOrgAdmin, isEmployee } = require('../services/accessControl');
const { readQuarantineFile } = require('../services/quarantineStorage');
const { createTrustedEvidence, blockchainPayload, publicEvidence } = require('../services/evidencePipelineService');
const { writeAuditLog } = require('../services/auditService');
const { ensureAdminOrganization } = require('../services/organizationService');

function publicQuarantine(record) {
    const value = record.toObject ? record.toObject() : { ...record };
    delete value.temporaryStorageReference;
    return value;
}

const listQuarantine = async (req, res, next) => {
    try {
        if (isEmployee(req.user)) {
            const records = await QuarantineEvidence.find({ uploaderId: req.user.id })
                .sort({ createdAt: -1 });
            return res.status(200).json({
                success: true,
                count: records.length,
                data: records.map(publicQuarantine)
            });
        }

        await ensureAdminOrganization(req.user);
        requireOrgAdmin(req.user);

        const records = await QuarantineEvidence.find({ organizationId: req.user.organizationId })
            .populate('uploaderId', 'walletAddress profile role')
            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: records.length,
            data: records.map(publicQuarantine)
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

const getQuarantineById = async (req, res, next) => {
    try {
        const record = await QuarantineEvidence.findById(req.params.id).populate('uploaderId', 'walletAddress profile role');
        if (!record) {
            return res.status(404).json({ success: false, message: 'Quarantine record not found.' });
        }

        const isOwner = record.uploaderId?._id?.toString() === req.user.id || record.uploaderId?.toString() === req.user.id;
        const isOrgAdmin = req.user.role === 'admin' && String(record.organizationId) === String(req.user.organizationId);
        if (!isOwner && !isOrgAdmin) {
            return res.status(403).json({ success: false, message: 'You are not authorized to access this evidence.' });
        }

        const canReviewImage = isOrgAdmin;
        const buffer = canReviewImage ? readQuarantineFile(record.temporaryStorageReference) : null;
        await writeAuditLog({
            actor: req.user,
            organizationId: record.organizationId,
            action: 'admin_view',
            targetType: 'quarantineEvidence',
            targetId: record._id
        });

        return res.status(200).json({
            success: true,
            data: {
                ...publicQuarantine(record),
                ...(buffer ? { fileContent: buffer.toString('base64') } : {})
            }
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

const reviewQuarantine = async (req, res, next) => {
    try {
        await ensureAdminOrganization(req.user);
        requireOrgAdmin(req.user);

        const decision = String(req.body.decision || req.body.status || '').toLowerCase();
        const reason = String(req.body.reason || '').trim().slice(0, 500);

        if (!['approved', 'rejected'].includes(decision)) {
            return res.status(400).json({ success: false, message: 'Decision must be approved or rejected.' });
        }
        if (!reason) {
            return res.status(400).json({ success: false, message: 'A review reason is required.' });
        }

        const record = await QuarantineEvidence.findById(req.params.id);
        if (!record) {
            return res.status(404).json({ success: false, message: 'Quarantine record not found.' });
        }
        if (String(record.organizationId) !== String(req.user.organizationId)) {
            return res.status(403).json({ success: false, message: 'You are not authorized to access this evidence.' });
        }
        if (record.reviewStatus !== 'pending_review') {
            return res.status(409).json({ success: false, message: 'This quarantine record has already been reviewed.' });
        }

        record.reviewedBy = req.user.id;
        record.reviewedAt = new Date();
        record.adminDecisionReason = reason;

        if (decision === 'rejected') {
            record.reviewStatus = 'rejected';
            await record.save();
            await writeAuditLog({
                actor: req.user,
                organizationId: record.organizationId,
                action: 'admin_rejection',
                targetType: 'quarantineEvidence',
                targetId: record._id,
                reason
            });
            return res.status(200).json({
                success: true,
                message: 'Evidence remains isolated in quarantine.',
                data: publicQuarantine(record)
            });
        }

        const uploader = await User.findById(record.uploaderId).select('_id walletAddress role organizationId');
        if (!uploader) {
            return res.status(404).json({ success: false, message: 'Original uploader no longer exists.' });
        }

        const fileBuffer = readQuarantineFile(record.temporaryStorageReference);
        const evidence = await createTrustedEvidence({
            user: {
                id: uploader._id.toString(),
                walletAddress: uploader.walletAddress,
                organizationId: record.organizationId,
                role: uploader.role
            },
            fileBuffer,
            file: {
                originalname: record.fileName,
                mimetype: record.mimeType,
                size: record.fileSize
            },
            captureMetadata: record.captureMetadata,
            caseId: record.caseId,
            aiAnalysis: record.aiAnalysis,
            requestBlockchain: record.blockchainRequested,
            reviewStatus: 'approved',
            quarantineId: record._id,
            approvedBy: req.user.id
        });

        record.reviewStatus = 'approved';
        record.resultingEvidenceId = evidence._id;
        await record.save();

        await writeAuditLog({
            actor: req.user,
            organizationId: record.organizationId,
            action: 'admin_approval',
            targetType: 'quarantineEvidence',
            targetId: record._id,
            reason,
            metadata: { resultingEvidenceId: evidence._id }
        });

        return res.status(200).json({
            success: true,
            message: record.blockchainRequested
                ? 'Evidence moved to trusted storage. Blockchain proof can now be created.'
                : 'Evidence moved to trusted encrypted storage.',
            data: {
                quarantine: publicQuarantine(record),
                evidence: {
                    ...publicEvidence(evidence),
                    blockchainPayload: record.blockchainRequested ? blockchainPayload(evidence) : null
                }
            }
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

module.exports = {
    listQuarantine,
    getQuarantineById,
    reviewQuarantine
};

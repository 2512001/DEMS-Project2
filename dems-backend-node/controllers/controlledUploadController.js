const {
    createPendingUploadRequest,
    getPendingUploadPreview,
    approvePendingUploadRequest,
    rejectPendingUploadRequest,
    getPendingUploadRequests,
    getPendingUploadRequestById,
    retryFinalization
} = require('../services/controlledUploadService');
const { isSuperAdmin, isAdmin } = require('../services/accessControl');
const { ensureAdminOrganization } = require('../services/organizationService');
const { sanitizePendingUploadForClient } = require('../services/verificationStatusService');

/**
 * Create a new pending upload request
 */
const createPendingUpload = async (req, res, next) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No evidence file provided.' });
        }

        const result = await createPendingUploadRequest({
            user: req.user,
            file: req.file,
            fileBuffer: req.file.buffer,
            body: req.body
        });

        const sanitizedPending = sanitizePendingUploadForClient(result.pendingRequest);

        return res.status(201).json({
            success: true,
            ...result,
            pendingRequest: sanitizedPending
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Preview pending original image (strictly for authorized Organization Admin)
 */
const getPendingUploadPreviewController = async (req, res, next) => {
    try {
        const { requestId } = req.params;
        const { fileBuffer, mimeType, fileName } = await getPendingUploadPreview({
            user: req.user,
            requestId
        });

        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);

        return res.send(fileBuffer);
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Approve pending upload request (Organization Admin decision)
 */
const approvePendingUpload = async (req, res, next) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body;

        const result = await approvePendingUploadRequest({
            user: req.user,
            requestId,
            reason
        });

        const sanitizedPending = sanitizePendingUploadForClient(result.pendingRequest);

        return res.status(200).json({
            success: true,
            ...result,
            pendingRequest: sanitizedPending
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Reject pending upload request (Organization Admin decision)
 */
const rejectPendingUpload = async (req, res, next) => {
    try {
        const { requestId } = req.params;
        const { reason } = req.body;

        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
        }

        const result = await rejectPendingUploadRequest({
            user: req.user,
            requestId,
            reason: String(reason).trim()
        });

        const sanitizedPending = sanitizePendingUploadForClient(result.pendingRequest);

        return res.status(200).json({
            success: true,
            ...result,
            pendingRequest: sanitizedPending
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Retry finalization for a failed permanent processing job
 */
const retryPendingFinalization = async (req, res, next) => {
    try {
        const { requestId } = req.params;
        const result = await retryFinalization({
            user: req.user,
            requestId
        });

        return res.status(200).json(result);
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * List pending upload requests (filtered by role and permissions)
 */
const listPendingUploads = async (req, res, next) => {
    try {
        const filters = {
            workflowStatus: req.query.status,
            search: req.query.search,
            page: parseInt(req.query.page, 10) || 1,
            limit: Math.min(parseInt(req.query.limit, 10) || 20, 100)
        };

        if (isSuperAdmin(req.user)) {
            // Super Admin can monitor all organizations
            if (req.query.organizationId) {
                filters.organizationId = req.query.organizationId;
            }
        } else if (isAdmin(req.user)) {
            // Organization Admin only sees their own organization's uploads
            if (!req.user.organizationId && req.user.role === 'admin') {
                await ensureAdminOrganization(req.user);
            }
            filters.organizationId = req.user.organizationId;
        } else {
            // Regular citizens / officers only see their own submissions
            filters.uploaderId = req.user.id;
        }

        const result = await getPendingUploadRequests(filters);

        const sanitizedRequests = (result.requests || []).map(sanitizePendingUploadForClient);

        return res.status(200).json({
            success: true,
            requests: sanitizedRequests,
            pagination: result.pagination
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

/**
 * Get a single pending upload request by ID
 */
const getPendingUploadById = async (req, res, next) => {
    try {
        const { requestId } = req.params;
        const pendingRequest = await getPendingUploadRequestById(requestId, req.user);

        const sanitized = sanitizePendingUploadForClient(pendingRequest);

        return res.status(200).json({
            success: true,
            data: sanitized
        });
    } catch (err) {
        if (err.statusCode) {
            return res.status(err.statusCode).json({ success: false, message: err.message });
        }
        next(err);
    }
};

module.exports = {
    createPendingUpload,
    getPendingUploadPreviewController,
    approvePendingUpload,
    rejectPendingUpload,
    retryPendingFinalization,
    listPendingUploads,
    getPendingUploadById
};

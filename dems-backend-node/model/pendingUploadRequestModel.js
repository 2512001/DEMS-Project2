const mongoose = require('mongoose');
const { Schema } = mongoose;

const pendingUploadRequestSchema = new Schema({
    // Core identifiers
    evidenceId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    caseId: {
        type: String,
        default: null,
        index: true
    },
    groupId: {
        type: Schema.Types.ObjectId,
        ref: 'Group',
        default: null,
        index: true
    },
    description: {
        type: String,
        default: ''
    },
    reason: {
        type: String,
        default: ''
    },

    // Uploader information
    uploaderId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    uploaderWallet: {
        type: String,
        required: true,
        lowercase: true,
        index: true
    },
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization',
        default: null,
        index: true
    },

    // File information
    fileName: {
        type: String,
        required: true
    },
    mimeType: {
        type: String,
        required: true
    },
    fileSize: {
        type: Number,
        required: true
    },
    fileHash: {
        type: String,
        required: true,
        index: true
    },

    // Capture metadata
    captureMetadata: {
        deviceInfo: { type: String, required: true },
        gpsLocation: {
            latitude: { type: Number, required: true },
            longitude: { type: Number, required: true }
        },
        capturedAt: { type: Date, required: true }
    },

    // Storage reference (quarantine)
    quarantineStorageReference: {
        type: String,
        required: true
    },

    // Workflow status state machine
    workflowStatus: {
        type: String,
        enum: [
            'PENDING_REVIEW',
            'REJECTED',
            'APPROVED_PROCESSING',
            'IPFS_STORED',
            'BLOCKCHAIN_PENDING',
            'FINALIZED',
            'PROCESSING_FAILED',
            'CLEANUP_PENDING',
            'CLEANED',
            // Backward-compatible statuses
            'pending_user_signature',
            'pending_org_admin_approval',
            'pending_super_admin_approval',
            'pending_system_finalization',
            'approved',
            'rejected',
            'finalized'
        ],
        default: 'PENDING_REVIEW',
        index: true
    },

    // Per-file DEK envelope (encrypted at rest with server master key)
    dekEnvelope: {
        encryptedDEK: { type: String, default: null },
        keyIv: { type: String, default: null },
        keyAuthTag: { type: String, default: null }
    },

    // Organization Admin approval decision
    orgAdminApproval: {
        approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
        signedAt: { type: Date, default: null },
        reason: { type: String, default: null },
        note: { type: String, default: null },
        signature: { type: String, default: null }
    },

    // Super Admin monitoring or review (optional platform-level tracking)
    superAdminApproval: {
        approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
        reason: { type: String, default: null }
    },

    // Rejection information
    rejection: {
        rejectedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        rejectedAt: { type: Date, default: null },
        reason: { type: String, default: null },
        stage: { type: String, default: null }
    },

    // Finalization tracking
    systemFinalization: {
        finalizedAt: { type: Date, default: null },
        evidenceId: { type: Schema.Types.ObjectId, ref: 'Evidence', default: null },
        ipfsCID: { type: String, default: null },
        blockchainTxHash: { type: String, default: null },
        error: { type: String, default: null },
        retryCount: { type: Number, default: 0 }
    },

    // Temporary storage cleanup tracking
    cleanupStatus: {
        type: String,
        enum: ['NONE', 'CLEANUP_PENDING', 'CLEANED', 'FAILED'],
        default: 'NONE',
        index: true
    },
    cleanedAt: {
        type: Date,
        default: null
    },

    // Expiry
    expiresAt: {
        type: Date,
        required: true,
        default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    },

    // Optional AI analysis
    aiAnalysis: {
        type: Schema.Types.Mixed,
        default: null
    },

    // Blockchain requested flag
    blockchainRequested: {
        type: Boolean,
        default: false
    },

    // Key management version
    keyVersion: {
        type: String,
        default: 'v1'
    }
}, { 
    timestamps: true,
    indexes: [
        { workflowStatus: 1, createdAt: -1 },
        { organizationId: 1, workflowStatus: 1 },
        { uploaderId: 1, workflowStatus: 1 },
        { cleanupStatus: 1 }
    ]
});

module.exports = mongoose.model('PendingUploadRequest', pendingUploadRequestSchema);

const mongoose = require('mongoose');
const { Schema } = mongoose;

const evidenceSchema = new Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
        default: function () {
            return this.user;
        }
    },
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization',
        default: null,
        index: true
    },
    groupId: {
        type: Schema.Types.ObjectId,
        ref: 'Group',
        default: null,
        index: true
    },
    department: {
        type: String,
        default: null
    },
    UploaderWallet: {
        type: String,
        required: true,
        lowercase: true,
        index: true
    },
    caseId: {
        type: String,
        default: null
    },
    captureMetadata: {
        deviceInfo: { type: String, required: true },
        gpsLocation: {
            latitude: { type: Number, required: true },
            longitude: { type: Number, required: true }
        },
        capturedAt: { type: Date, required: true }
    },
    fileName: { type: String, required: true },
    mimeType: { type: String, required: true },
    fileSize: { type: Number, required: true },
    fileHash: {
        type: String,
        required: true,
        unique: true
    },
    encryptionMethod: {
        type: String,
        default: 'AES-256'
    },
    ipfsCID: {
        type: String,
        default: null
    },
    encryption: {
        iv: { type: String, default: null },
        authTag: { type: String, default: null },
        algorithm: { type: String, default: 'aes-256-gcm' },
        encryptedDEK: { type: String, default: null },
        keyIv: { type: String, default: null },
        keyAuthTag: { type: String, default: null }
    },
    // Multi-party key management (Phase 2)
    keyVersion: {
        type: String,
        default: null
    },
    encryptedDEKs: {
        user: {
            encryptedDEK: { type: Buffer, default: null },
            iv: { type: String, default: null },
            authTag: { type: String, default: null },
            algorithm: { type: String, default: 'aes-256-gcm' }
        },
        org_admin: {
            encryptedDEK: { type: Buffer, default: null },
            iv: { type: String, default: null },
            authTag: { type: String, default: null },
            algorithm: { type: String, default: 'aes-256-gcm' }
        },
        super_admin: {
            encryptedDEK: { type: Buffer, default: null },
            iv: { type: String, default: null },
            authTag: { type: String, default: null },
            algorithm: { type: String, default: 'aes-256-gcm' }
        }
    },
    blockchainRequested: {
        type: Boolean,
        default: false
    },
    blockchainTxHash: {
        type: String,
        default: null
    },
    aiAnalysis: {
        requested: { type: Boolean, default: false },
        authenticityScore: { type: Number, default: null },
        tamperingScore: { type: Number, default: null },
        deepfakeScore: { type: Number, default: null },
        deepfakeDetected: { type: Boolean, default: false },
        tamperingDetected: { type: Boolean, default: false },
        confidence: { type: Number, default: null },
        explanation: { type: String, default: '' },
        modelVersion: { type: String, default: '' },
        analyzedAt: { type: Date, default: null },
        score: { type: Number, default: 0 },
        isDeepfake: { type: Boolean, default: false },
        metadataMatch: { type: Boolean, default: true }
    },
    processingStatus: {
        type: String,
        enum: ['processing', 'completed', 'failed'],
        default: 'processing'
    },
    reviewStatus: {
        type: String,
        enum: ['not_required', 'pending', 'approved', 'rejected'],
        default: 'not_required'
    },
    storageStatus: {
        type: String,
        enum: ['not_stored', 'quarantine', 'ipfs', 'failed'],
        default: 'not_stored'
    },
    blockchainStatus: {
        type: String,
        enum: ['not_requested', 'pending', 'confirmed', 'failed'],
        default: 'not_requested'
    },
    versionNumber: {
        type: Number,
        default: 1
    },
    previousVersion: {
        type: Schema.Types.ObjectId,
        ref: 'Evidence',
        default: null
    },
    versionHistory: [{
        versionNumber: { type: Number, required: true },
        caseId: { type: String, default: null },
        changeReason: { type: String, default: '' },
        changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
        approvedAt: { type: Date, default: null },
        snapshotAt: { type: Date, default: Date.now }
    }],
    changedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    changeReason: { type: String, default: '' },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    approvedAt: { type: Date, default: null },
    quarantineId: {
        type: Schema.Types.ObjectId,
        ref: 'QuarantineEvidence',
        default: null
    },
    quarantineStatus: {
        type: String,
        enum: ['none', 'pending', 'quarantined', 'approved', 'rejected'],
        default: 'none'
    },
    integrityVerified: {
        type: Boolean,
        default: false
    },
    status: {
        type: String,
        enum: [
            'processing',
            'encrypted',
            'pending_blockchain',
            'stored_on_chain',
            'flagged_by_ai',
            'quarantine',
            'rejected',
            'stored_ipfs',
            'superseded',
            'error'
        ],
        default: 'processing'
    },
    statusMessage: {
        type: String,
        default: 'Initializing secure upload...'
    }
}, { timestamps: true });

module.exports = mongoose.model('Evidence', evidenceSchema);

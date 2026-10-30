const mongoose = require('mongoose');
const { Schema } = mongoose;

const viewAccessRequestSchema = new Schema({
    requestId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    requesterId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    requesterRole: {
        type: String,
        enum: ['admin', 'super_admin', 'officer', 'citizen'],
        required: true
    },
    requesterWallet: {
        type: String,
        required: true,
        lowercase: true
    },
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization',
        required: true,
        index: true
    },
    targetType: {
        type: String,
        enum: ['evidence', 'case', 'group'],
        required: true,
        index: true
    },
    targetId: {
        type: String,
        required: true,
        index: true
    },
    evidenceId: {
        type: Schema.Types.ObjectId,
        ref: 'Evidence',
        default: null
    },
    groupId: {
        type: Schema.Types.ObjectId,
        ref: 'Group',
        default: null
    },
    caseId: {
        type: String,
        default: null
    },
    targetName: {
        type: String,
        default: ''
    },
    targetMetadata: {
        fileName: { type: String, default: null },
        mimeType: { type: String, default: null },
        fileSize: { type: Number, default: null },
        caseId: { type: String, default: null },
        groupName: { type: String, default: null },
        orgName: { type: String, default: null }
    },
    reason: {
        type: String,
        required: true,
        trim: true,
        minlength: 3,
        maxlength: 1000
    },
    requestedDuration: {
        type: String,
        enum: ['1h', '6h', '12h', '1d', '2d'],
        required: true
    },
    durationMs: {
        type: Number,
        required: true
    },
    requiredApproverRole: {
        type: String,
        enum: ['super_admin', 'admin'],
        required: true,
        index: true
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'expired', 'revoked'],
        default: 'pending',
        index: true
    },
    approverId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    approvedAt: {
        type: Date,
        default: null
    },
    rejectionReason: {
        type: String,
        default: null,
        maxlength: 1000
    },
    rejectedAt: {
        type: Date,
        default: null
    },
    rejectedBy: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    permission: {
        approvedScope: {
            type: String,
            enum: ['evidence', 'case', 'group', null],
            default: null
        },
        targetType: {
            type: String,
            enum: ['evidence', 'case', 'group', null],
            default: null
        },
        targetId: {
            type: String,
            default: null
        },
        approvedAt: {
            type: Date,
            default: null
        },
        expiresAt: {
            type: Date,
            default: null,
            index: true
        },
        status: {
            type: String,
            enum: ['active', 'expired', 'revoked', null],
            default: null,
            index: true
        },
        revokedAt: {
            type: Date,
            default: null
        },
        revokedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },
        revocationReason: {
            type: String,
            default: null,
            maxlength: 1000
        }
    }
}, {
    timestamps: true,
    indexes: [
        { requesterId: 1, status: 1 },
        { organizationId: 1, status: 1 },
        { requiredApproverRole: 1, status: 1 },
        { "permission.expiresAt": 1, "permission.status": 1 }
    ]
});

module.exports = mongoose.model('ViewAccessRequest', viewAccessRequestSchema);

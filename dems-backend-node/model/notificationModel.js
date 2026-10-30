const mongoose = require('mongoose');
const { Schema } = mongoose;

const notificationSchema = new Schema({
  recipientId: {
    type: Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  organizationId: {
    type: Schema.Types.ObjectId,
    ref: 'Organization',
    default: null,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: [
      'upload_request_created',
      'upload_approved',
      'upload_rejected',
      'platform_upload_monitored',
      'evidence_finalized',
      'employee_application',
      'approval',
      'rejection',
      'evidence_upload',
      'quarantine',
      'group_assignment',
      'system',
      'view_request_created',
      'view_request_approved',
      'view_request_rejected',
      'view_request_revoked',
      'view_request_expired'
    ],
    index: true
  },
  title: {
    type: String,
    required: true,
    trim: true,
    maxLength: 200
  },
  message: {
    type: String,
    required: true,
    trim: true,
    maxLength: 500
  },
  actionUrl: {
    type: String,
    default: null
  },
  metadata: {
    type: Schema.Types.Mixed,
    default: {}
  },
  read: {
    type: Boolean,
    default: false,
    index: true
  },
  readAt: {
    type: Date,
    default: null
  }
}, { timestamps: true });

notificationSchema.index({ recipientId: 1, read: 1 });
notificationSchema.index({ organizationId: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);

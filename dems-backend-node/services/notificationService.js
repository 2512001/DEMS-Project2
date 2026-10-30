const Notification = require('../model/notificationModel');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');

async function createNotification({
  recipientId,
  organizationId,
  type,
  title,
  message,
  actionUrl = null,
  metadata = {}
}) {
  try {
    // Check if a similar notification already exists (prevent duplicates)
    const existing = await Notification.findOne({
      recipientId,
      organizationId,
      type,
      read: false,
      createdAt: { $gte: new Date(Date.now() - 5 * 60 * 1000) } // Last 5 minutes
    });

    if (existing) {
      console.log('[NOTIFICATION] Duplicate notification prevented:', type);
      return existing;
    }

    const notification = await Notification.create({
      recipientId,
      organizationId,
      type,
      title,
      message,
      actionUrl,
      metadata
    });

    console.log('[NOTIFICATION] Created notification:', notification._id, 'for recipient:', recipientId);

    // Real-time delivery to recipient socket room
    try {
      const { getIO } = require('./socketService');
      const io = getIO();
      if (io) {
        const recipientStr = String(recipientId?._id || recipientId);
        io.to(`user:${recipientStr}`).emit('notification_created', notification);
        io.to(`user:${recipientStr}`).emit('workflow_counts_update', { recipientId: recipientStr });
      }
    } catch (sockErr) {
      console.warn('[NOTIFICATION] Real-time socket emit skipped:', sockErr.message);
    }

    return notification;
  } catch (err) {
    console.error('[NOTIFICATION] Failed to create notification:', err);
    throw err;
  }
}

async function getNotificationsForUser(userId, organizationId) {
  try {
    const query = { recipientId: userId };
    if (organizationId) {
      query.$or = [{ organizationId }, { organizationId: null }];
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({
      ...query,
      read: false
    });

    return {
      notifications,
      unreadCount
    };
  } catch (err) {
    console.error('[NOTIFICATION] Failed to fetch notifications:', err);
    throw err;
  }
}

async function markNotificationAsRead(notificationId, userId) {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipientId: userId },
      { read: true, readAt: new Date() },
      { new: true }
    );

    if (!notification) {
      throw new Error('Notification not found or access denied');
    }

    return notification;
  } catch (err) {
    console.error('[NOTIFICATION] Failed to mark as read:', err);
    throw err;
  }
}

async function markAllAsRead(userId, organizationId) {
  try {
    const query = { recipientId: userId, read: false };
    if (organizationId) {
      query.$or = [{ organizationId }, { organizationId: null }];
    }

    const result = await Notification.updateMany(
      query,
      { read: true, readAt: new Date() }
    );

    console.log('[NOTIFICATION] Marked', result.modifiedCount, 'notifications as read');
    return result;
  } catch (err) {
    console.error('[NOTIFICATION] Failed to mark all as read:', err);
    throw err;
  }
}

async function notifyOrganizationAdmins({
  organizationId,
  type,
  title,
  message,
  actionUrl = null,
  metadata = {},
  excludeUserId = null
}) {
  try {
    const org = await Organization.findById(organizationId).select('adminId createdBy');
    
    // Find all admins for the organization (including createdBy or adminId if organizationId is not yet updated on User)
    const admins = await User.find({
      $or: [
        { organizationId, role: 'admin' },
        ...(org?.adminId ? [{ _id: org.adminId, role: 'admin' }] : []),
        ...(org?.createdBy ? [{ _id: org.createdBy, role: 'admin' }] : [])
      ],
      accountStatus: 'active'
    }).select('_id');

    console.log('[NOTIFICATION] Found', admins.length, 'admins to notify for org:', organizationId);

    const notifications = await Promise.all(
      admins.map((admin) => {
        if (excludeUserId && admin._id.toString() === excludeUserId.toString()) {
          return null;
        }
        return createNotification({
          recipientId: admin._id,
          organizationId,
          type,
          title,
          message,
          actionUrl,
          metadata
        });
      })
    );

    return notifications.filter(n => n !== null);
  } catch (err) {
    console.error('[NOTIFICATION] Failed to notify organization admins:', err);
    throw err;
  }
}

module.exports = {
  createNotification,
  getNotificationsForUser,
  markNotificationAsRead,
  markAllAsRead,
  notifyOrganizationAdmins
};

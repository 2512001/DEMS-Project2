const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');

let io = null;

function initSocket(server) {
    io = new Server(server, {
        cors: {
            origin: [
                'http://localhost:5173',
                'http://localhost:5174',
                'http://127.0.0.1:5173',
                'http://127.0.0.1:5174',
                process.env.FRONTEND_URL
            ].filter(Boolean),
            methods: ['GET', 'POST', 'PUT', 'DELETE'],
            credentials: true
        }
    });

    // Authenticate socket connections
    io.use(async (socket, next) => {
        try {
            const rawToken = socket.handshake.auth?.token ||
                socket.handshake.headers?.authorization?.replace(/^Bearer\s+/i, '') ||
                socket.handshake.query?.token;

            if (!rawToken) {
                return next(new Error('Authentication token required for WebSocket'));
            }

            const token = rawToken.replace(/^Bearer\s+/i, '');
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'dems-local-test-secret');
            
            const dbUser = await User.findById(decoded.id).select('_id walletAddress role organizationId accountStatus');
            if (!dbUser || dbUser.accountStatus === 'suspended') {
                return next(new Error('User unauthorized or suspended'));
            }

            let orgId = dbUser.organizationId ? dbUser.organizationId.toString() : null;
            if (dbUser.role === 'admin' && !orgId) {
                const org = await Organization.findOne({
                    $or: [{ adminId: dbUser._id }, { createdBy: dbUser._id }]
                }).select('_id');
                if (org) {
                    dbUser.organizationId = org._id;
                    await dbUser.save();
                    orgId = org._id.toString();
                }
            }

            socket.user = {
                id: dbUser._id.toString(),
                role: dbUser.role,
                walletAddress: dbUser.walletAddress,
                organizationId: orgId
            };
            next();
        } catch (err) {
            console.warn('[SOCKET] Authentication failed:', err.message);
            next(new Error('Invalid token'));
        }
    });

    io.on('connection', async (socket) => {
        const user = socket.user;
        if (!user) return;

        console.log(`[SOCKET] User connected: ${user.id} (${user.role}) [socket ${socket.id}]`);

        // Join individual user room
        socket.join(`user:${user.id}`);

        let orgId = user.organizationId ? String(user.organizationId) : null;

        // Auto-resolve organization for Organization Admins if not yet linked in JWT
        if (user.role === 'admin' && !orgId) {
            try {
                const dbUser = await User.findById(user.id).select('organizationId');
                if (dbUser?.organizationId) {
                    orgId = dbUser.organizationId.toString();
                } else {
                    const org = await Organization.findOne({
                        $or: [{ adminId: user.id }, { createdBy: user.id }]
                    }).select('_id');
                    if (org) {
                        orgId = org._id.toString();
                    }
                }
            } catch (err) {
                console.warn('[SOCKET] Error resolving admin organization:', err.message);
            }
        }

        // Join organization room if user has organization
        if (orgId) {
            socket.join(`org:${orgId}`);
            if (user.role === 'admin') {
                socket.join(`org_admin:${orgId}`);
                console.log(`[SOCKET] Admin joined room: org_admin:${orgId}`);
            }
        }

        // Super Admin room for platform-wide events
        if (user.role === 'super_admin') {
            socket.join('super_admin');
        }

        socket.on('disconnect', () => {
            console.log(`[SOCKET] User disconnected: ${user.id} [socket ${socket.id}]`);
        });
    });

    console.log('[SOCKET] Socket.IO server initialized successfully.');
    return io;
}

function getIO() {
    return io;
}

/**
 * Emit upload workflow events to relevant rooms
 */
function emitUploadWorkflowEvent(eventName, payload) {
    if (!io) {
        console.warn('[SOCKET] Socket.IO not initialized; skipping event:', eventName);
        return;
    }

    const {
        organizationId,
        uploaderId,
        requestId,
        evidenceId,
        status,
        timestamp = new Date(),
        ...rest
    } = payload;

    const orgIdStr = organizationId ? String(organizationId._id || organizationId) : null;
    const uploaderIdStr = uploaderId ? String(uploaderId._id || uploaderId) : null;

    const baseData = {
        eventName,
        requestId: requestId ? String(requestId) : undefined,
        evidenceId,
        status,
        organizationId: orgIdStr,
        timestamp,
        ...rest
    };

    console.log(`[SOCKET] Broadcasting event "${eventName}" for request ${requestId || evidenceId} (org: ${orgIdStr})`);

    // Notify uploader directly
    if (uploaderIdStr) {
        io.to(`user:${uploaderIdStr}`).emit(eventName, baseData);
        io.to(`user:${uploaderIdStr}`).emit('upload_status_update', baseData);
    }

    // Notify organization admins
    if (orgIdStr) {
        io.to(`org_admin:${orgIdStr}`).emit(eventName, baseData);
        io.to(`org_admin:${orgIdStr}`).emit('upload_status_update', baseData);
        io.to(`org:${orgIdStr}`).emit(eventName, baseData);
    }

    // Notify Super Admin (monitoring metadata only)
    io.to('super_admin').emit(eventName, baseData);
    io.to('super_admin').emit('upload_status_update', baseData);
}

/**
 * Emit view access workflow events to relevant rooms
 */
function emitViewAccessEvent(eventName, payload) {
    if (!io) {
        console.warn('[SOCKET] Socket.IO not initialized; skipping event:', eventName);
        return;
    }

    const {
        organizationId,
        requesterId,
        requestId,
        targetType,
        targetId,
        status,
        timestamp = new Date(),
        ...rest
    } = payload;

    const orgIdStr = organizationId ? String(organizationId._id || organizationId) : null;
    const requesterIdStr = requesterId ? String(requesterId._id || requesterId) : null;

    const baseData = {
        eventName,
        requestId: requestId ? String(requestId) : undefined,
        targetType,
        targetId,
        status,
        organizationId: orgIdStr,
        timestamp,
        ...rest
    };

    console.log(`[SOCKET] Broadcasting view access event "${eventName}" for request ${requestId} (org: ${orgIdStr})`);

    // Notify requester directly
    if (requesterIdStr) {
        io.to(`user:${requesterIdStr}`).emit(eventName, baseData);
        io.to(`user:${requesterIdStr}`).emit('view_access_status_update', baseData);
        io.to(`user:${requesterIdStr}`).emit('workflow_counts_update', { requesterId: requesterIdStr });
    }

    // Notify organization admins
    if (orgIdStr) {
        io.to(`org_admin:${orgIdStr}`).emit(eventName, baseData);
        io.to(`org_admin:${orgIdStr}`).emit('view_access_status_update', baseData);
        io.to(`org_admin:${orgIdStr}`).emit('workflow_counts_update', { organizationId: orgIdStr });
        io.to(`org:${orgIdStr}`).emit(eventName, baseData);
        io.to(`org:${orgIdStr}`).emit('view_access_status_update', baseData);
    }

    // Notify Super Admin
    io.to('super_admin').emit(eventName, baseData);
    io.to('super_admin').emit('view_access_status_update', baseData);
    io.to('super_admin').emit('workflow_counts_update', { role: 'super_admin' });
}

module.exports = {
    initSocket,
    getIO,
    emitUploadWorkflowEvent,
    emitViewAccessEvent
};

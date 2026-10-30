const jwt = require('jsonwebtoken');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');

const protect = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || '';
        const [scheme, token] = authHeader.split(' ');

        if (scheme !== 'Bearer' || !token) {
            return res.status(401).json({ success: false, message: 'Authentication token required.' });
        }

        if (!process.env.JWT_SECRET) {
            console.error('[AUTH] JWT_SECRET is not configured.');
            return res.status(500).json({ success: false, message: 'Authentication service is not configured.' });
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id walletAddress role organizationId accountStatus');

        if (!user) {
            return res.status(401).json({ success: false, message: 'Authenticated user no longer exists.' });
        }

        if (user.accountStatus === 'suspended') {
            return res.status(403).json({ success: false, message: 'This account is suspended.' });
        }

        console.log('[AUTH] Protected route - User role:', user.role, 'organizationId:', user.organizationId);

        let orgId = user.organizationId ? user.organizationId.toString() : null;

        // Auto-resolve organization for Organization Admins if not yet linked
        if (user.role === 'admin' && !orgId) {
            const org = await Organization.findOne({
                $or: [{ adminId: user._id }, { createdBy: user._id }]
            }).select('_id');
            if (org) {
                user.organizationId = org._id;
                await user.save();
                orgId = org._id.toString();
                console.log('[AUTH] Auto-resolved organizationId for admin:', orgId);
            }
        }

        req.user = {
            id: user._id.toString(),
            role: user.role,
            walletAddress: user.walletAddress,
            organizationId: orgId
        };

        next();
    } catch (err) {
        console.warn(`[AUTH] JWT verification failed: ${err.message}`);
        return res.status(401).json({ success: false, message: 'Invalid or expired authentication token.' });
    }
};

// Optional authentication: if a valid Bearer token is present, attach req.user;
// otherwise continue as an anonymous request. Never rejects. Used by public
// endpoints (e.g. email OTP during invitation acceptance) that still want to
// persist state against the signed-in user when a token happens to be sent.
const attachUserIfPresent = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization || '';
        const [scheme, token] = authHeader.split(' ');

        if (scheme !== 'Bearer' || !token || !process.env.JWT_SECRET) {
            return next();
        }

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('_id walletAddress role organizationId accountStatus');

        if (user && user.accountStatus !== 'suspended') {
            req.user = {
                id: user._id.toString(),
                role: user.role,
                walletAddress: user.walletAddress,
                organizationId: user.organizationId ? user.organizationId.toString() : null
            };
        }
    } catch (err) {
        // Ignore invalid/expired tokens — treat as anonymous.
    }
    return next();
};

module.exports = { protect, attachUserIfPresent };

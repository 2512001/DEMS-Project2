const express = require('express');
const {
    createRequest,
    getMyRequests,
    getIncomingRequests,
    getRequestById,
    approveRequest,
    rejectRequest,
    revokePermission,
    getActivePermissions,
    getCounts,
    getProtectedEvidenceContent
} = require('../controllers/viewAccessController');
const { protect } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

const router = express.Router();

// Real-time workflow counters
router.get('/counts', protect, getCounts);

// Active temporary permissions
router.get('/permissions/active', protect, authorizeRoles('admin', 'super_admin'), getActivePermissions);

// Create view access request (Org Admin, Super Admin, Officer, Citizen)
router.post('/requests', protect, createRequest);

// List current user's submitted requests (My View Requests)
router.get('/requests/my', protect, getMyRequests);

// List incoming requests assigned to the authenticated user for review (Admins only)
router.get('/requests/incoming', protect, authorizeRoles('admin', 'super_admin'), getIncomingRequests);

// Get single request details
router.get('/requests/:id', protect, getRequestById);

// Approve a view request
router.post('/requests/:id/approve', protect, authorizeRoles('admin', 'super_admin'), approveRequest);

// Reject a view request
router.post('/requests/:id/reject', protect, authorizeRoles('admin', 'super_admin'), rejectRequest);

// Revoke an active view permission
router.post('/requests/:id/revoke', protect, authorizeRoles('admin', 'super_admin'), revokePermission);

// Retrieve protected decrypted evidence content strictly with active permission
router.get('/evidence/:id/content', protect, getProtectedEvidenceContent);

module.exports = router;

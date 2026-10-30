const express = require('express');
const {
    listOrganizations,
    createOrganization,
    assignOrganizationAdmin,
    getMyOrganization,
    updateOrganizationSettings,
    getOrganizationOverview,
    getOrganizationDetails,
    getOrganizationAdmins,
    resolveOrganizationByCode,
    updateOrganizationStatus,
    getActiveOrganizations
} = require('../controllers/organizationController');
const { protect } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

const router = express.Router();

// IMPORTANT: Static routes MUST be registered before the dynamic `/:organizationId`
// routes below. Express matches in registration order, so declaring `/:organizationId`
// first would capture `/me`, `/overview`, etc. as organization IDs.

// Super Admin only endpoints
router.get('/directory', protect, authorizeRoles('super_admin'), listOrganizations);
router.post('/create', protect, authorizeRoles('super_admin'), createOrganization);
router.post('/assign-admin', protect, authorizeRoles('super_admin'), assignOrganizationAdmin);
router.put('/:organizationId/status', protect, authorizeRoles('super_admin'), updateOrganizationStatus);

// Active organizations lookup for authenticated users (citizens, officers, admins)
router.get('/active', protect, getActiveOrganizations);

// Organization Admin endpoints (static paths)
router.get('/me', protect, authorizeRoles('admin'), getMyOrganization);
router.get('/overview', protect, authorizeRoles('admin'), getOrganizationOverview);
router.put('/settings', protect, authorizeRoles('admin'), updateOrganizationSettings);

// Public endpoints for organization lookup (two-segment path)
router.get('/resolve/:code', protect, resolveOrganizationByCode);

// Dynamic organization routes — keep LAST so they do not shadow static routes above
router.get('/:organizationId', protect, authorizeRoles('admin', 'super_admin'), getOrganizationDetails);
router.get('/:organizationId/admins', protect, authorizeRoles('admin', 'super_admin'), getOrganizationAdmins);

module.exports = router;

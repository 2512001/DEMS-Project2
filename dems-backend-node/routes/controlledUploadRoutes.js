const express = require('express');
const {
    createPendingUpload,
    getPendingUploadPreviewController,
    approvePendingUpload,
    rejectPendingUpload,
    retryPendingFinalization,
    listPendingUploads,
    getPendingUploadById
} = require('../controllers/controlledUploadController');
const { uploadMemory } = require('../middleware/multer');
const { protect } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

const router = express.Router();

// Create pending upload request (authenticated users: citizen, officer, admin)
router.post('/pending', protect, uploadMemory.single('evidence'), createPendingUpload);

// List pending uploads (scoped by role in controller: super_admin monitors platform, admin views org, officer/citizen view self)
router.get('/pending', protect, authorizeRoles('super_admin', 'admin', 'officer', 'citizen'), listPendingUploads);

// Preview pending image (strictly Organization Admin of that organization)
router.get('/pending/:requestId/preview', protect, authorizeRoles('admin'), getPendingUploadPreviewController);

// Approve pending upload (Organization Admin only)
router.post('/pending/:requestId/approve', protect, authorizeRoles('admin'), approvePendingUpload);

// Reject pending upload (Organization Admin only)
router.post('/pending/:requestId/reject', protect, authorizeRoles('admin'), rejectPendingUpload);

// Retry failed finalization (Organization Admin only)
router.post('/pending/:requestId/retry-finalization', protect, authorizeRoles('admin'), retryPendingFinalization);

// Get single pending upload request by ID
router.get('/pending/:requestId', protect, getPendingUploadById);

module.exports = router;

const express = require('express');
const {
    uploadEvidence,
    getMyFiles,
    getEvidenceByCase,
    finalizeEvidence,
    getEvidenceById,
    getUploadPolicy,
    getOrganizationEvidence,
    getPlatformEvidence,
    markBlockchainFailed,
    retryBlockchainRegistration,
    checkWalletBalance
} = require('../controllers/evidenceController');
const { verifyEvidenceBlockchain } = require('../controllers/evidenceVerificationController');
const { uploadEvidenceMemory } = require('../middleware/multer');
const { protect } = require('../middleware/authMiddleware');
const { authorizeRoles } = require('../middleware/roleMiddleware');

const router = express.Router();

router.post('/upload', protect, authorizeRoles('citizen', 'officer', 'admin'), uploadEvidenceMemory.single('evidence'), uploadEvidence);
router.get('/upload-policy', protect, authorizeRoles('citizen', 'officer', 'admin'), getUploadPolicy);
router.post('/finalize/:evidenceId', protect, authorizeRoles('citizen', 'officer', 'admin'), finalizeEvidence);
router.post('/:evidenceId/blockchain-failed', protect, authorizeRoles('citizen', 'officer', 'admin'), markBlockchainFailed);
router.post('/:evidenceId/retry-blockchain', protect, authorizeRoles('citizen', 'officer', 'admin'), retryBlockchainRegistration);
router.get('/wallet/:address/balance', checkWalletBalance);
router.get('/my-files', protect, authorizeRoles('citizen', 'officer', 'admin'), getMyFiles);
router.get('/organization', protect, authorizeRoles('admin'), getOrganizationEvidence);
router.get('/platform', protect, authorizeRoles('super_admin'), getPlatformEvidence);
router.get('/download/:id', protect, authorizeRoles('citizen', 'officer', 'admin', 'super_admin'), getEvidenceById);
router.get('/case/:caseId', protect, authorizeRoles('officer', 'admin', 'citizen', 'super_admin'), getEvidenceByCase);
router.get('/:id', protect, authorizeRoles('citizen', 'officer', 'admin', 'super_admin'), getEvidenceById);
router.post('/:id/verify-blockchain', protect, authorizeRoles('citizen', 'officer', 'admin'), verifyEvidenceBlockchain);

module.exports = router;

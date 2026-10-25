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

router.post('/upload', protect, uploadEvidenceMemory.single('evidence'), uploadEvidence);
router.get('/upload-policy', protect, getUploadPolicy);
router.post('/finalize/:evidenceId', protect, finalizeEvidence);
router.post('/:evidenceId/blockchain-failed', protect, markBlockchainFailed);
router.post('/:evidenceId/retry-blockchain', protect, retryBlockchainRegistration);
router.get('/wallet/:address/balance', checkWalletBalance);
router.get('/my-files', protect, getMyFiles);
router.get('/organization', protect, authorizeRoles('admin'), getOrganizationEvidence);
router.get('/platform', protect, authorizeRoles('super_admin'), getPlatformEvidence);
router.get('/download/:id', protect, getEvidenceById);
router.get('/case/:caseId', protect, authorizeRoles('officer', 'admin', 'citizen'), getEvidenceByCase);
router.get('/:id', protect, getEvidenceById);
router.post('/:id/verify-blockchain', protect, verifyEvidenceBlockchain);

module.exports = router;

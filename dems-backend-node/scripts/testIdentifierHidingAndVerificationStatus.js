const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const mongoose = require('mongoose');
const crypto = require('crypto');

const PendingUploadRequest = require('../model/pendingUploadRequestModel');
const EvidenceModel = require('../model/evidenceModel');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');
const {
  createPendingUploadRequest,
  approvePendingUploadRequest,
  rejectPendingUploadRequest,
  processApprovedUpload
} = require('../services/controlledUploadService');
const {
  computeVerificationStatus,
  sanitizePendingUploadForClient,
  sanitizeEvidenceForClient
} = require('../services/verificationStatusService');
const { verifyEvidenceIntegrity } = require('../services/evidenceVerificationService');
const { getOnChainEvidence } = require('../services/blockchainService');

function generateValidJpegBuffer() {
  const header = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const randomPayload = crypto.randomBytes(512);
  const footer = Buffer.from([0xFF, 0xD9]);
  return Buffer.concat([header, randomPayload, footer]);
}

async function run() {
  console.log('=================================================================');
  console.log('🧪 TESTING IDENTIFIER HIDING & AUTHORITATIVE VERIFICATION STATUS');
  console.log('=================================================================');

  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');

  // Setup Test Organization and Users
  const creatorId = new mongoose.Types.ObjectId();
  const orgCode = 'ORGHIDE' + Date.now().toString().slice(-4);
  const org = await Organization.create({
    name: 'Hide Identifiers Test Org ' + Date.now(),
    organizationCode: orgCode,
    organizationType: 'law_enforcement',
    status: 'active',
    createdBy: creatorId
  });

  const admin = await User.create({
    walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
    role: 'admin',
    accountStatus: 'active',
    organizationId: org._id
  });
  org.adminId = admin._id;
  await org.save();

  const officer = await User.create({
    walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
    role: 'officer',
    accountStatus: 'active',
    organizationId: org._id
  });

  // 1. Submit Upload
  console.log('⚡ 1. Testing pending request status indicators & identifier hiding...');
  const jpegBuffer = generateValidJpegBuffer();
  const uploadResult = await createPendingUploadRequest({
    user: { id: officer._id, walletAddress: officer.walletAddress, role: 'officer', organizationId: org._id },
    file: { originalname: 'hide-test.jpg', buffer: jpegBuffer, size: jpegBuffer.length, mimetype: 'image/jpeg' },
    fileBuffer: jpegBuffer,
    body: {
      caseId: 'CASE-HIDE-001',
      reason: 'Testing identifier hiding in UI',
      requestBlockchain: 'true',
      captureMetadata: {
        deviceInfo: 'Camera Model Secure',
        gpsLocation: { latitude: 34.0522, longitude: -118.2437 },
        capturedAt: new Date().toISOString()
      }
    }
  });

  const requestId = uploadResult.pendingRequest.requestId;
  const rawPendingDoc = await PendingUploadRequest.findById(requestId);

  // Verify pending status indicators
  const pendingSanitized = sanitizePendingUploadForClient(rawPendingDoc);
  console.log('Pending Verification Status:', pendingSanitized.verification);

  // Assert pending operations never appear as verified
  assert.strictEqual(pendingSanitized.verification.ipfsStorage, 'Pending', 'Pending request IPFS must NOT be Verified');
  assert.strictEqual(pendingSanitized.verification.blockchainIntegrity, 'Pending', 'Pending request Blockchain must NOT be Verified');
  assert.strictEqual(pendingSanitized.verification.integrityCheck, 'Pending', 'Pending request Integrity must NOT be Passed');
  assert.strictEqual(pendingSanitized.verification.evidenceStatus, 'Processing', 'Status must be Processing');
  assert.strictEqual(pendingSanitized.verification.lastVerified, null, 'Last verified must be null for pending');

  // Assert raw identifiers are NOT present in sanitized client response
  assert.strictEqual(pendingSanitized.fileHash, undefined, 'Raw fileHash must be stripped');
  assert.strictEqual(pendingSanitized.dekEnvelope, undefined, 'dekEnvelope must be stripped');
  assert.strictEqual(pendingSanitized.quarantineStorageReference, undefined, 'quarantineStorageReference must be stripped');
  console.log('✓ Pending request never appears verified and raw identifiers are stripped from client object');

  // 2. Reject another request and verify rejection indicators
  console.log('\n⚡ 2. Testing rejection indicators & cleanup...');
  const jpegBuffer2 = generateValidJpegBuffer();
  const uploadResult2 = await createPendingUploadRequest({
    user: { id: officer._id, walletAddress: officer.walletAddress, role: 'officer', organizationId: org._id },
    file: { originalname: 'hide-reject.jpg', buffer: jpegBuffer2, size: jpegBuffer2.length, mimetype: 'image/jpeg' },
    fileBuffer: jpegBuffer2,
    body: {
      caseId: 'CASE-HIDE-002',
      reason: 'Testing rejection indicators',
      requestBlockchain: 'true',
      captureMetadata: {
        deviceInfo: 'Camera Model Secure',
        gpsLocation: { latitude: 34.0522, longitude: -118.2437 },
        capturedAt: new Date().toISOString()
      }
    }
  });

  await rejectPendingUploadRequest({
    user: { id: admin._id, walletAddress: admin.walletAddress, role: 'admin', organizationId: org._id },
    requestId: uploadResult2.pendingRequest.requestId,
    reason: 'Rejected due to blurry capture'
  });

  const rejectedDoc = await PendingUploadRequest.findById(uploadResult2.pendingRequest.requestId);
  const rejectedSanitized = sanitizePendingUploadForClient(rejectedDoc);
  console.log('Rejected Verification Status:', rejectedSanitized.verification);

  // Assert rejected operations never appear as verified
  assert.strictEqual(rejectedSanitized.verification.ipfsStorage, 'Failed', 'Rejected IPFS must be Failed');
  assert.strictEqual(rejectedSanitized.verification.blockchainIntegrity, 'Failed', 'Rejected Blockchain must be Failed');
  assert.strictEqual(rejectedSanitized.verification.integrityCheck, 'Failed', 'Rejected Integrity must be Failed');
  assert.strictEqual(rejectedSanitized.verification.evidenceStatus, 'Rejected', 'Status must be Rejected');
  console.log('✓ Rejected request displays Failed/Rejected, never Verified');

  // 3. Approve first request and finalize via real IPFS and Blockchain
  console.log('\n⚡ 3. Approving first request and testing finalized verification status...');
  await approvePendingUploadRequest({
    user: { id: admin._id, walletAddress: admin.walletAddress, role: 'admin', organizationId: org._id },
    requestId,
    reason: 'Approved for permanent registration'
  });

  let finalizedDoc;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    finalizedDoc = await PendingUploadRequest.findById(requestId);
    if (finalizedDoc.workflowStatus === 'FINALIZED' || finalizedDoc.workflowStatus === 'PROCESSING_FAILED') {
      break;
    }
  }

  assert.strictEqual(finalizedDoc.workflowStatus, 'FINALIZED', 'Must be FINALIZED');

  // Verify internal records preserved real identifiers
  assert.ok(finalizedDoc.fileHash, 'Internal fileHash must remain in database');
  assert.ok(finalizedDoc.systemFinalization?.ipfsCID, 'Internal IPFS CID must remain in database');
  assert.ok(finalizedDoc.systemFinalization?.blockchainTxHash, 'Internal Tx Hash must remain in database');
  console.log('✓ Internal DB document preserves real identifiers: CID =', finalizedDoc.systemFinalization.ipfsCID.slice(0, 10) + '...', 'Tx =', finalizedDoc.systemFinalization.blockchainTxHash.slice(0, 10) + '...');

  // Verify client-sanitized finalized request
  const finalizedSanitized = sanitizePendingUploadForClient(finalizedDoc);
  console.log('Finalized Client Verification Status:', finalizedSanitized.verification);
  console.log('Finalized Client systemFinalization:', finalizedSanitized.systemFinalization);

  assert.strictEqual(finalizedSanitized.verification.ipfsStorage, 'Verified');
  assert.strictEqual(finalizedSanitized.verification.blockchainIntegrity, 'Verified');
  assert.strictEqual(finalizedSanitized.verification.integrityCheck, 'Passed');
  assert.strictEqual(finalizedSanitized.verification.evidenceStatus, 'Finalized');
  assert.ok(finalizedSanitized.verification.lastVerified, 'lastVerified timestamp must be present');

  // Client view must NOT contain raw CID, txHash, or fileHash
  assert.strictEqual(finalizedSanitized.fileHash, undefined, 'Client must not receive raw fileHash');
  assert.strictEqual(finalizedSanitized.systemFinalization?.ipfsCID, undefined, 'Client must not receive raw ipfsCID');
  assert.strictEqual(finalizedSanitized.systemFinalization?.blockchainTxHash, undefined, 'Client must not receive raw blockchainTxHash');
  assert.strictEqual(finalizedSanitized.systemFinalization.ipfsStored, true, 'Client receives boolean ipfsStored');
  assert.strictEqual(finalizedSanitized.systemFinalization.blockchainConfirmed, true, 'Client receives boolean blockchainConfirmed');
  console.log('✓ Finalized client view displays Verified indicators without exposing raw hashes/CIDs');

  // 4. Test Evidence Model Sanitization
  console.log('\n⚡ 4. Testing Evidence model client sanitization...');
  const evidenceDoc = await EvidenceModel.findById(finalizedDoc.systemFinalization.evidenceId);
  assert.ok(evidenceDoc, 'Evidence model must exist');

  const evidenceSanitized = sanitizeEvidenceForClient(evidenceDoc);
  assert.strictEqual(evidenceSanitized.fileHash, undefined, 'Evidence client fileHash must be stripped');
  assert.strictEqual(evidenceSanitized.ipfsCID, undefined, 'Evidence client ipfsCID must be stripped');
  assert.strictEqual(evidenceSanitized.blockchainTxHash, undefined, 'Evidence client blockchainTxHash must be stripped');
  assert.strictEqual(evidenceSanitized.encryption, undefined, 'Encryption keys must be stripped');
  assert.strictEqual(evidenceSanitized.encryptedDEKs, undefined, 'Encrypted DEKs must be stripped');
  assert.strictEqual(evidenceSanitized.verification.ipfsStorage, 'Verified');
  assert.strictEqual(evidenceSanitized.verification.blockchainIntegrity, 'Verified');
  assert.strictEqual(evidenceSanitized.verification.integrityCheck, 'Passed');
  console.log('✓ Evidence model client sanitization successfully removes raw hashes & keys');

  // 5. Test Authoritative Verification Service (No raw hash leakage)
  console.log('\n⚡ 5. Testing authoritative verification service output sanitization...');
  const verifyResult = await verifyEvidenceIntegrity(evidenceDoc._id, admin);
  console.log('Verification Result:', {
    verificationStatus: verifyResult.verificationStatus,
    comparisons: verifyResult.comparisons,
    stages: verifyResult.stages,
    checks: verifyResult.checks,
    mismatches: verifyResult.mismatches
  });
  assert.strictEqual(verifyResult.verificationStatus, 'VERIFIED');
  assert.strictEqual(verifyResult.verification.ipfsStorage, 'Verified');
  assert.strictEqual(verifyResult.verification.blockchainIntegrity, 'Verified');
  assert.strictEqual(verifyResult.verification.integrityCheck, 'Passed');

  // Check that verification checks array does not leak raw SHA-256 strings
  for (const check of verifyResult.checks) {
    if (check.mongodb) {
      assert.ok(!check.mongodb.startsWith('0x') && check.mongodb.length < 32, `Check mongodb should be a clean status label, got: ${check.mongodb}`);
    }
    if (check.ipfs) {
      assert.ok(!check.ipfs.startsWith('0x') && check.ipfs.length < 32, `Check ipfs should be a clean status label, got: ${check.ipfs}`);
    }
    if (check.blockchain) {
      assert.ok(!check.blockchain.startsWith('0x') && check.blockchain.length < 32, `Check blockchain should be a clean status label, got: ${check.blockchain}`);
    }
  }
  console.log('✓ Verification checks return clean comparison labels without leaking raw hashes');

  console.log('\n=================================================================');
  console.log('🎉 ALL IDENTIFIER HIDING & VERIFICATION STATUS TESTS PASSED!');
  console.log('=================================================================');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

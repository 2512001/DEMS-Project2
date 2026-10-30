const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');

const PendingUploadRequest = require('../model/pendingUploadRequestModel');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');
const {
  createPendingUploadRequest,
  rejectPendingUploadRequest
} = require('../services/controlledUploadService');

function generateValidJpegBuffer() {
  const header = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const randomPayload = crypto.randomBytes(512);
  const footer = Buffer.from([0xFF, 0xD9]);
  return Buffer.concat([header, randomPayload, footer]);
}

async function run() {
  console.log('=================================================================');
  console.log('🧪 TESTING REJECTION & QUARANTINE CLEANUP WORKFLOW');
  console.log('=================================================================');

  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');

  const creatorId = new mongoose.Types.ObjectId();
  const orgCode = 'ORGREJ' + Date.now().toString().slice(-4);
  const org = await Organization.create({
    name: 'Rejection Test Org ' + Date.now(),
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
  const jpegBuffer = generateValidJpegBuffer();
  const uploadResult = await createPendingUploadRequest({
    user: { id: officer._id, walletAddress: officer.walletAddress, role: 'officer', organizationId: org._id },
    file: { originalname: 'evidence-reject-test.jpg', buffer: jpegBuffer, size: jpegBuffer.length, mimetype: 'image/jpeg' },
    fileBuffer: jpegBuffer,
    body: {
      caseId: 'CASE-REJ-001',
      reason: 'Testing rejection cleanup',
      captureMetadata: {
        deviceInfo: 'Nikon D850',
        gpsLocation: { latitude: 40.7128, longitude: -74.0060 },
        capturedAt: new Date().toISOString()
      }
    }
  });

  const requestId = uploadResult.pendingRequest.requestId;
  const initialDoc = await PendingUploadRequest.findById(requestId);
  const qPath = path.join(__dirname, '../quarantine-store', initialDoc.quarantineStorageReference);
  assert.ok(fs.existsSync(qPath), 'Quarantine file must exist before rejection');
  console.log('✓ Quarantine file verified at:', qPath);

  // 2. Reject as Org Admin without reason (should fail)
  let failedWithoutReason = false;
  try {
    await rejectPendingUploadRequest({
      user: { id: admin._id, walletAddress: admin.walletAddress, role: 'admin', organizationId: org._id },
      requestId,
      reason: ''
    });
  } catch (err) {
    failedWithoutReason = true;
    console.log('✓ Rejection rejected without reason as expected');
  }
  assert.ok(failedWithoutReason, 'Must require reason');

  // 3. Reject with valid reason
  console.log('⚡ Rejecting request with valid reason...');
  await rejectPendingUploadRequest({
    user: { id: admin._id, walletAddress: admin.walletAddress, role: 'admin', organizationId: org._id },
    requestId,
    reason: 'Evidence image appears blurry and lacks chain of custody verification.'
  });

  // 4. Verify DB state & file cleanup
  const rejected = await PendingUploadRequest.findById(requestId);
  console.log('Rejected Workflow Status:', rejected.workflowStatus);
  console.log('Rejection Reason:', rejected.rejection?.reason);
  console.log('Cleanup Status:', rejected.cleanupStatus);
  console.log('Quarantine File Exists:', fs.existsSync(qPath));

  assert.strictEqual(rejected.workflowStatus, 'REJECTED');
  assert.strictEqual(rejected.cleanupStatus, 'CLEANED');
  assert.strictEqual(fs.existsSync(qPath), false, 'Quarantine file must be deleted upon rejection');
  assert.strictEqual(rejected.systemFinalization?.ipfsCID, null);
  assert.strictEqual(rejected.systemFinalization?.blockchainTxHash, null);

  console.log('\n=================================================================');
  console.log('🎉 REJECTION & IMMEDIATE CLEANUP WORKFLOW VERIFIED SUCCESSFULLY!');
  console.log('=================================================================');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Rejection test failed:', err);
  process.exit(1);
});

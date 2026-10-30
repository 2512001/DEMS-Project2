const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const mongoose = require('mongoose');
const crypto = require('crypto');

const PendingUploadRequest = require('../model/pendingUploadRequestModel');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');
const {
  createPendingUploadRequest,
  getPendingUploadPreview,
  approvePendingUploadRequest,
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
  console.log('🧪 TESTING STRICT AUTHORIZATION BOUNDARIES');
  console.log('=================================================================');

  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');

  // Org A
  const orgCodeA = 'ORGA' + Date.now().toString().slice(-4);
  const orgA = await Organization.create({
    name: 'Org A ' + Date.now(),
    organizationCode: orgCodeA,
    organizationType: 'law_enforcement',
    status: 'active',
    createdBy: new mongoose.Types.ObjectId()
  });

  // Org B
  const orgCodeB = 'ORGB' + Date.now().toString().slice(-4);
  const orgB = await Organization.create({
    name: 'Org B ' + Date.now(),
    organizationCode: orgCodeB,
    organizationType: 'corporate',
    status: 'active',
    createdBy: new mongoose.Types.ObjectId()
  });

  const adminA = await User.create({
    walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
    role: 'admin',
    accountStatus: 'active',
    organizationId: orgA._id
  });

  const adminB = await User.create({
    walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
    role: 'admin',
    accountStatus: 'active',
    organizationId: orgB._id
  });

  const superAdmin = await User.create({
    walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
    role: 'super_admin',
    accountStatus: 'active'
  });

  const officerA = await User.create({
    walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
    role: 'officer',
    accountStatus: 'active',
    organizationId: orgA._id
  });

  // Create request for Org A
  const jpegBuffer = generateValidJpegBuffer();
  const uploadResult = await createPendingUploadRequest({
    user: { id: officerA._id, walletAddress: officerA.walletAddress, role: 'officer', organizationId: orgA._id },
    file: { originalname: 'auth-test.jpg', buffer: jpegBuffer, size: jpegBuffer.length, mimetype: 'image/jpeg' },
    fileBuffer: jpegBuffer,
    body: {
      caseId: 'CASE-AUTH-001',
      reason: 'Auth boundary test',
      captureMetadata: {
        deviceInfo: 'Camera Auth',
        gpsLocation: { latitude: 10, longitude: 20 },
        capturedAt: new Date().toISOString()
      }
    }
  });

  const requestId = uploadResult.pendingRequest.requestId;

  // 1. Super Admin cannot preview quarantine image
  console.log('⚡ Checking Super Admin preview rejection...');
  let saPreviewBlocked = false;
  try {
    await getPendingUploadPreview({
      user: { id: superAdmin._id, walletAddress: superAdmin.walletAddress, role: 'super_admin' },
      requestId
    });
  } catch (err) {
    saPreviewBlocked = err.statusCode === 403;
    console.log('✓ Super Admin preview blocked (403):', err.message);
  }
  assert.ok(saPreviewBlocked, 'Super Admin preview must be 403');

  // 2. Super Admin cannot approve request
  console.log('⚡ Checking Super Admin approval rejection...');
  let saApproveBlocked = false;
  try {
    await approvePendingUploadRequest({
      user: { id: superAdmin._id, walletAddress: superAdmin.walletAddress, role: 'super_admin' },
      requestId,
      reason: 'Illegal super admin approval'
    });
  } catch (err) {
    saApproveBlocked = err.statusCode === 403;
    console.log('✓ Super Admin approval blocked (403):', err.message);
  }
  assert.ok(saApproveBlocked, 'Super Admin approval must be 403');

  // 3. Admin B (different org) cannot preview or approve Org A request
  console.log('⚡ Checking Foreign Admin preview & approval rejection...');
  let foreignPreviewBlocked = false;
  try {
    await getPendingUploadPreview({
      user: { id: adminB._id, walletAddress: adminB.walletAddress, role: 'admin', organizationId: orgB._id },
      requestId
    });
  } catch (err) {
    foreignPreviewBlocked = err.statusCode === 403;
    console.log('✓ Foreign Admin preview blocked (403):', err.message);
  }
  assert.ok(foreignPreviewBlocked, 'Foreign Admin preview must be 403');

  let foreignApproveBlocked = false;
  try {
    await approvePendingUploadRequest({
      user: { id: adminB._id, walletAddress: adminB.walletAddress, role: 'admin', organizationId: orgB._id },
      requestId,
      reason: 'Cross-tenant illegal approval'
    });
  } catch (err) {
    foreignApproveBlocked = err.statusCode === 403;
    console.log('✓ Foreign Admin approval blocked (403):', err.message);
  }
  assert.ok(foreignApproveBlocked, 'Foreign Admin approval must be 403');

  // 4. Admin A (legitimate Org Admin) CAN preview
  console.log('⚡ Checking legitimate Admin A preview access...');
  const preview = await getPendingUploadPreview({
    user: { id: adminA._id, walletAddress: adminA.walletAddress, role: 'admin', organizationId: orgA._id },
    requestId
  });
  assert.ok(preview.fileBuffer, 'Admin A must receive fileBuffer');
  assert.strictEqual(preview.mimeType, 'image/jpeg');
  console.log('✓ Admin A preview successful (fileBuffer length:', preview.fileBuffer.length, ', mimeType:', preview.mimeType, ')');

  console.log('\n=================================================================');
  console.log('🎉 STRICT AUTHORIZATION BOUNDARIES VERIFIED SUCCESSFULLY!');
  console.log('=================================================================');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Authorization boundary test failed:', err);
  process.exit(1);
});

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const mongoose = require('mongoose');
const crypto = require('crypto');
const fs = require('fs');

const PendingUploadRequest = require('../model/pendingUploadRequestModel');
const EvidenceModel = require('../model/evidenceModel');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');
const {
  createPendingUploadRequest,
  approvePendingUploadRequest,
  processApprovedUpload
} = require('../services/controlledUploadService');
const { getOnChainEvidence } = require('../services/blockchainService');

function generateValidJpegBuffer() {
  const header = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const randomPayload = crypto.randomBytes(512);
  const footer = Buffer.from([0xFF, 0xD9]);
  return Buffer.concat([header, randomPayload, footer]);
}

async function run() {
  console.log('=================================================================');
  console.log('🧪 TESTING REAL IPFS & BLOCKCHAIN APPROVAL PIPELINE');
  console.log('=================================================================');

  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');

  // 1. Setup Org and Users
  const creatorId = new mongoose.Types.ObjectId();
  const orgCode = 'ORGTEST' + Date.now().toString().slice(-4);
  const org = await Organization.create({
    name: 'Real IPFS Test Org ' + Date.now(),
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

  console.log('✓ Created Test Org, Admin, and Officer');

  // 2. Submit Upload as Officer
  const jpegBuffer = generateValidJpegBuffer();
  const uploadResult = await createPendingUploadRequest({
    user: { id: officer._id, walletAddress: officer.walletAddress, role: 'officer', organizationId: org._id },
    file: { originalname: 'evidence-real-test.jpg', buffer: jpegBuffer, size: jpegBuffer.length, mimetype: 'image/jpeg' },
    fileBuffer: jpegBuffer,
    body: {
      caseId: 'CASE-REAL-001',
      reason: 'Live pipeline verification test',
      requestBlockchain: 'true',
      captureMetadata: {
        deviceInfo: 'Sony Alpha ILCE-7RM4',
        gpsLocation: { latitude: 37.7749, longitude: -122.4194 },
        capturedAt: new Date().toISOString()
      }
    }
  });

  const requestId = uploadResult.pendingRequest.requestId;
  console.log('✓ Created PendingUploadRequest:', requestId, 'EvidenceId:', uploadResult.pendingRequest.evidenceId);

  // 3. Approve as Org Admin
  console.log('⚡ Approving request as Organization Admin...');
  await approvePendingUploadRequest({
    user: { id: admin._id, walletAddress: admin.walletAddress, role: 'admin', organizationId: org._id },
    requestId,
    reason: 'Verified and approved for permanent IPFS storage and blockchain registration'
  });

  // 4. Await background worker processing (IPFS upload + Blockchain registration)
  console.log('⚡ Waiting for background worker to finalize IPFS upload and Blockchain registration...');
  let finalized;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    finalized = await PendingUploadRequest.findById(requestId);
    if (finalized.workflowStatus === 'FINALIZED' || finalized.workflowStatus === 'PROCESSING_FAILED') {
      break;
    }
  }

  // 5. Verify the Finalized Request in DB
  finalized = await PendingUploadRequest.findById(requestId);
  console.log('\n--- VERIFICATION RESULTS ---');
  console.log('Workflow Status:', finalized.workflowStatus);
  console.log('IPFS CID:', finalized.systemFinalization?.ipfsCID);
  console.log('Blockchain Tx Hash:', finalized.systemFinalization?.blockchainTxHash);
  console.log('Cleanup Status:', finalized.cleanupStatus);

  assert.strictEqual(finalized.workflowStatus, 'FINALIZED', 'Status must be FINALIZED');
  assert.ok(finalized.systemFinalization?.ipfsCID, 'IPFS CID must be present');
  assert.ok(finalized.systemFinalization?.blockchainTxHash, 'Blockchain Tx Hash must be present');
  assert.strictEqual(finalized.cleanupStatus, 'CLEANED', 'Quarantine file must be cleaned up');

  // 6. Verify On-Chain Proof
  console.log('\n⚡ Verifying on-chain contract state...');
  const onChainProof = await getOnChainEvidence(finalized.evidenceId);
  console.log('On-Chain Evidence ID:', onChainProof.evidenceId);
  console.log('On-Chain IPFS CID:', onChainProof.ipfsCID);
  console.log('On-Chain File Hash:', onChainProof.fileHash);
  assert.strictEqual(onChainProof.evidenceId, finalized.evidenceId);
  assert.strictEqual(onChainProof.ipfsCID, finalized.systemFinalization.ipfsCID);
  assert.strictEqual(onChainProof.fileHash, finalized.fileHash);

  // 7. Verify Evidence Model
  const evidenceDoc = await EvidenceModel.findById(finalized.systemFinalization.evidenceId);
  assert.ok(evidenceDoc, 'Evidence document must exist');
  console.log('Evidence Document Created:', evidenceDoc._id, 'Status:', evidenceDoc.status);

  console.log('\n=================================================================');
  console.log('🎉 FULL IPFS + BLOCKCHAIN APPROVAL WORKFLOW VERIFIED SUCCESSFULLY!');
  console.log('=================================================================');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('❌ Pipeline test failed:', err);
  process.exit(1);
});

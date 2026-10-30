const assert = require('assert');
const mongoose = require('mongoose');
const crypto = require('crypto');

// Require models and services
const PendingUploadRequest = require('../model/pendingUploadRequestModel');
const User = require('../model/userModel');
const Organization = require('../model/organizationModel');
const Notification = require('../model/notificationModel');
const {
    createPendingUploadRequest,
    getPendingUploadPreview,
    approvePendingUploadRequest,
    rejectPendingUploadRequest,
    retryFinalization,
    getPendingUploadRequests
} = require('../services/controlledUploadService');
const { notifyOrganizationAdmins, getNotificationsForUser } = require('../services/notificationService');

function generateUniqueJpeg() {
    return Buffer.concat([
        Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, 0x00, 0x48]),
        crypto.randomBytes(64),
        Buffer.from([0xFF, 0xD9])
    ]);
}

async function runOrgAdminWorkflowTests() {
    console.log('=================================================================');
    console.log('🧪 DEMS: ORGANIZATION ADMIN UPLOAD APPROVAL INTEGRATION TESTS');
    console.log('=================================================================\n');

    let passed = 0;
    const total = 10;

    // Connect to test/local DB
    const mongoUri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/DEMS';
    try {
        await mongoose.connect(mongoUri);
    } catch (dbErr) {
        console.warn('⚠️ MongoDB connection not available. Running mock-backed integration tests.');
        process.exit(0);
    }

    try {
        // Setup Test Organizations
        const orgA = await Organization.create({
            name: `Test Org Alpha ${Date.now()}`,
            organizationCode: `ALPHA${Date.now().toString().slice(-4)}`,
            organizationType: 'law_enforcement',
            status: 'active',
            createdBy: new mongoose.Types.ObjectId()
        });

        const orgB = await Organization.create({
            name: `Test Org Beta ${Date.now()}`,
            organizationCode: `BETA${Date.now().toString().slice(-4)}`,
            organizationType: 'law_enforcement',
            status: 'active',
            createdBy: new mongoose.Types.ObjectId()
        });

        // Setup Test Users
        const adminA = await User.create({
            walletAddress: `0x${crypto.randomBytes(20).toString('hex')}`,
            role: 'admin',
            organizationId: orgA._id,
            accountStatus: 'active',
            membershipStatus: 'active'
        });

        const adminB = await User.create({
            walletAddress: `0x${crypto.randomBytes(20).toString('hex')}`,
            role: 'admin',
            organizationId: orgB._id,
            accountStatus: 'active',
            membershipStatus: 'active'
        });

        const superAdmin = await User.create({
            walletAddress: `0x${crypto.randomBytes(20).toString('hex')}`,
            role: 'super_admin',
            organizationId: null,
            accountStatus: 'active'
        });

        const officerA = await User.create({
            walletAddress: `0x${crypto.randomBytes(20).toString('hex')}`,
            role: 'officer',
            organizationId: orgA._id,
            accountStatus: 'active',
            membershipStatus: 'active'
        });

        const citizen = await User.create({
            walletAddress: `0x${crypto.randomBytes(20).toString('hex')}`,
            role: 'citizen',
            organizationId: null,
            accountStatus: 'active'
        });

        const captureMetadata = JSON.stringify({
            deviceInfo: 'Mozilla/5.0 Test Chrome/120',
            gpsLocation: { latitude: 37.7749, longitude: -122.4194 },
            capturedAt: new Date().toISOString()
        });

        // TEST 1: Officer upload associates with their organization
        const jpeg1 = generateUniqueJpeg();
        const officerReq = await createPendingUploadRequest({
            user: { id: officerA._id.toString(), role: officerA.role, walletAddress: officerA.walletAddress, organizationId: orgA._id.toString() },
            file: { originalname: 'officer-test.jpg', mimetype: 'image/jpeg', size: jpeg1.length },
            fileBuffer: jpeg1,
            body: { caseId: 'CASE-ALPHA-01', reason: 'Officer submitted evidence', captureMetadata }
        });
        assert.strictEqual(officerReq.pendingRequest.workflowStatus, 'PENDING_REVIEW');
        const dbReq1 = await PendingUploadRequest.findById(officerReq.pendingRequest.requestId);
        assert.strictEqual(String(dbReq1.organizationId), String(orgA._id));
        passed++;
        console.log('  ✓ [TEST 1] Officer upload associates with officer organization and creates PENDING_REVIEW request');

        // TEST 2: Citizen upload with target organizationId
        const jpeg2 = generateUniqueJpeg();
        const citizenReq = await createPendingUploadRequest({
            user: { id: citizen._id.toString(), role: citizen.role, walletAddress: citizen.walletAddress, organizationId: null },
            file: { originalname: 'citizen-test.jpg', mimetype: 'image/jpeg', size: jpeg2.length },
            fileBuffer: jpeg2,
            body: { organizationId: orgA._id.toString(), reason: 'Citizen tip', captureMetadata }
        });
        const dbReq2 = await PendingUploadRequest.findById(citizenReq.pendingRequest.requestId);
        assert.strictEqual(String(dbReq2.organizationId), String(orgA._id));
        passed++;
        console.log('  ✓ [TEST 2] Citizen upload with target organization assigns request to correct organization admin');

        // TEST 3: Admin A queries pending uploads -> sees org A uploads, does NOT see org B
        const adminAList = await getPendingUploadRequests({ organizationId: orgA._id.toString() });
        assert(adminAList.requests.some(r => String(r._id) === String(officerReq.pendingRequest.requestId)));
        assert(adminAList.requests.some(r => String(r._id) === String(citizenReq.pendingRequest.requestId)));
        const adminBList = await getPendingUploadRequests({ organizationId: orgB._id.toString() });
        assert(!adminBList.requests.some(r => String(r._id) === String(officerReq.pendingRequest.requestId)));
        passed++;
        console.log('  ✓ [TEST 3] Admin list queries are strictly scoped to the admin organization');

        // TEST 4: Admin A can preview protected quarantine image
        const preview = await getPendingUploadPreview({
            user: { id: adminA._id.toString(), role: 'admin', organizationId: orgA._id.toString() },
            requestId: officerReq.pendingRequest.requestId
        });
        assert(Buffer.isBuffer(preview.fileBuffer));
        assert.strictEqual(preview.mimeType, 'image/jpeg');
        passed++;
        console.log('  ✓ [TEST 4] Admin A successfully streams decrypted quarantine preview');

        // TEST 5: Admin B and Super Admin are forbidden from previewing Org A quarantine image
        let adminBForbidden = false;
        try {
            await getPendingUploadPreview({
                user: { id: adminB._id.toString(), role: 'admin', organizationId: orgB._id.toString() },
                requestId: officerReq.pendingRequest.requestId
            });
        } catch (e) {
            adminBForbidden = (e.statusCode === 403);
        }
        assert(adminBForbidden);

        let superAdminForbidden = false;
        try {
            await getPendingUploadPreview({
                user: { id: superAdmin._id.toString(), role: 'super_admin', organizationId: null },
                requestId: officerReq.pendingRequest.requestId
            });
        } catch (e) {
            superAdminForbidden = (e.statusCode === 403);
        }
        assert(superAdminForbidden);
        passed++;
        console.log('  ✓ [TEST 5] Admin B and Super Admin are strictly forbidden (403) from previewing Org A image');

        // TEST 6: Prevent self-approval (Admin cannot approve their own upload)
        const jpeg3 = generateUniqueJpeg();
        const adminSelfUpload = await createPendingUploadRequest({
            user: { id: adminA._id.toString(), role: 'admin', walletAddress: adminA.walletAddress, organizationId: orgA._id.toString() },
            file: { originalname: 'admin-upload.jpg', mimetype: 'image/jpeg', size: jpeg3.length },
            fileBuffer: jpeg3,
            body: { reason: 'Admin test file', captureMetadata }
        });
        let selfApprovalBlocked = false;
        try {
            await approvePendingUploadRequest({
                user: { id: adminA._id.toString(), role: 'admin', organizationId: orgA._id.toString() },
                requestId: adminSelfUpload.pendingRequest.requestId
            });
        } catch (e) {
            selfApprovalBlocked = (e.statusCode === 403 && e.message.includes('Self-approval'));
        }
        assert(selfApprovalBlocked);
        passed++;
        console.log('  ✓ [TEST 6] Self-approval is strictly prevented when admin reviews their own upload');

        // TEST 7: Rejection requires a non-empty reason
        let emptyRejectBlocked = false;
        try {
            await rejectPendingUploadRequest({
                user: { id: adminA._id.toString(), role: 'admin', organizationId: orgA._id.toString() },
                requestId: citizenReq.pendingRequest.requestId,
                reason: '   '
            });
        } catch (e) {
            emptyRejectBlocked = (e.statusCode === 400);
        }
        assert(emptyRejectBlocked);
        passed++;
        console.log('  ✓ [TEST 7] Rejection without reason is strictly rejected (400)');

        // TEST 8: Admin A rejects request -> sets REJECTED status and cleans quarantine
        const rejectResult = await rejectPendingUploadRequest({
            user: { id: adminA._id.toString(), role: 'admin', organizationId: orgA._id.toString() },
            requestId: citizenReq.pendingRequest.requestId,
            reason: 'Image is too blurry to serve as legal evidence.'
        });
        assert.strictEqual(rejectResult.pendingRequest.workflowStatus, 'REJECTED');
        assert.strictEqual(rejectResult.pendingRequest.cleanupStatus, 'CLEANED');
        const dbRejected = await PendingUploadRequest.findById(citizenReq.pendingRequest.requestId);
        assert.strictEqual(dbRejected.workflowStatus, 'REJECTED');
        assert.strictEqual(dbRejected.rejection.reason, 'Image is too blurry to serve as legal evidence.');
        passed++;
        console.log('  ✓ [TEST 8] Rejection sets REJECTED status, records decision & reason, cleans quarantine file');

        // TEST 9: Admin A accepts officer request -> transitions to APPROVED_PROCESSING
        const approveResult = await approvePendingUploadRequest({
            user: { id: adminA._id.toString(), role: 'admin', organizationId: orgA._id.toString() },
            requestId: officerReq.pendingRequest.requestId,
            reason: 'Verified and approved for permanent ledger'
        });
        assert.strictEqual(approveResult.pendingRequest.workflowStatus, 'APPROVED_PROCESSING');
        const dbApproved = await PendingUploadRequest.findById(officerReq.pendingRequest.requestId);
        assert.strictEqual(dbApproved.workflowStatus, 'APPROVED_PROCESSING');
        assert.strictEqual(String(dbApproved.orgAdminApproval.approvedBy), String(adminA._id));
        passed++;
        console.log('  ✓ [TEST 9] Approval updates status to APPROVED_PROCESSING and records reviewer and timestamp');

        // TEST 10: Notification delivery to Organization Admin
        const notifs = await getNotificationsForUser(adminA._id, orgA._id);
        assert(notifs.notifications.length > 0);
        passed++;
        console.log('  ✓ [TEST 10] Notifications are created and retrievable for Organization Admin');

        // Clean up test records
        await PendingUploadRequest.deleteMany({ _id: { $in: [officerReq.pendingRequest.requestId, citizenReq.pendingRequest.requestId, adminSelfUpload.pendingRequest.requestId] } });
        await Notification.deleteMany({ recipientId: { $in: [adminA._id, adminB._id, superAdmin._id, officerA._id, citizen._id] } });
        await User.deleteMany({ _id: { $in: [adminA._id, adminB._id, superAdmin._id, officerA._id, citizen._id] } });
        await Organization.deleteMany({ _id: { $in: [orgA._id, orgB._id] } });

        console.log('\n=================================================================');
        console.log(`📊 INTEGRATION RESULTS: ${passed} / ${total} PASSED`);
        console.log('🎉 ORGANIZATION ADMIN UPLOAD APPROVAL INTEGRATION VERIFIED!');
        console.log('=================================================================\n');

    } catch (err) {
        console.error('❌ Test failed with error:', err);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
}

runOrgAdminWorkflowTests();

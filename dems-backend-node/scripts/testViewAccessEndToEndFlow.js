const mongoose = require('mongoose');
const assert = require('assert');
const crypto = require('crypto');

const User = require('../model/userModel');
const Organization = require('../model/organizationModel');
const Evidence = require('../model/evidenceModel');
const Group = require('../model/groupModel');
const ViewAccessRequest = require('../model/viewAccessRequestModel');
const Notification = require('../model/notificationModel');

const {
    createViewAccessRequest,
    approveViewAccessRequest,
    rejectViewAccessRequest,
    revokeViewAccessPermission,
    checkUserActivePermission,
    getWorkflowCounts
} = require('../services/viewAccessService');

async function runEndToEnd() {
    await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
    console.log('Connected to MongoDB. Running View Access End-To-End Suite...\n');

    const testRunId = Date.now().toString(36);

    // 1. Setup Super Admin
    const superAdmin = await User.create({
        walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
        role: 'super_admin',
        accountStatus: 'active'
    });

    // 2. Setup Test Organizations
    const orgA = await Organization.create({
        name: `Alpha Dept ${testRunId}`,
        organizationCode: 'A' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        createdBy: superAdmin._id,
        status: 'active'
    });

    const orgB = await Organization.create({
        name: `Beta Dept ${testRunId}`,
        organizationCode: 'B' + crypto.randomBytes(4).toString('hex').toUpperCase(),
        createdBy: superAdmin._id,
        status: 'active'
    });

    const orgAdminA = await User.create({
        walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
        role: 'admin',
        organizationId: orgA._id,
        accountStatus: 'active'
    });

    const orgAdminB = await User.create({
        walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
        role: 'admin',
        organizationId: orgB._id,
        accountStatus: 'active'
    });

    const officerA = await User.create({
        walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
        role: 'officer',
        organizationId: orgA._id,
        accountStatus: 'active'
    });

    const citizen = await User.create({
        walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
        role: 'citizen',
        accountStatus: 'active'
    });

    // 3. Setup Protected Evidence
    const evidenceA = await Evidence.create({
        user: officerA._id,
        uploadedBy: officerA._id,
        organizationId: orgA._id,
        caseId: `CASE-${testRunId}`,
        UploaderWallet: officerA.walletAddress,
        fileName: 'confidential-surveillance.jpg',
        mimeType: 'image/jpeg',
        fileSize: 2048,
        fileHash: crypto.randomBytes(32).toString('hex'),
        ipfsCID: 'QmAlpha' + testRunId,
        encryption: {
            iv: crypto.randomBytes(12).toString('hex'),
            authTag: crypto.randomBytes(16).toString('hex'),
            algorithm: 'aes-256-gcm'
        },
        captureMetadata: {
            deviceInfo: 'Alpha Cam',
            gpsLocation: { latitude: 10, longitude: 20 },
            capturedAt: new Date()
        },
        status: 'stored_ipfs'
    });

    console.log('--- TEST A: Organization Admin Requests View Access ---');
    // Org Admin requests view access for evidenceA
    const reqA = await createViewAccessRequest({
        user: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
        targetType: 'evidence',
        targetId: evidenceA._id.toString(),
        duration: '1h',
        reason: 'Investigative review by Org Admin'
    });
    assert.strictEqual(reqA.status, 'pending');
    assert.strictEqual(reqA.requiredApproverRole, 'super_admin');
    console.log('✓ Request created with pending status and routed to Super Admin');

    // Super Admin approves
    const approvedA = await approveViewAccessRequest({
        requestId: reqA.requestId,
        approverUser: { id: superAdmin._id.toString(), role: 'super_admin' }
    });
    assert.strictEqual(approvedA.status, 'approved');
    assert.strictEqual(approvedA.permission.status, 'active');
    console.log('✓ Super Admin successfully approved Org Admin request');

    // Verify Org Admin has permission now
    const permA = await checkUserActivePermission({
        user: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
        evidence: evidenceA
    });
    assert.strictEqual(permA.hasPermission, true);
    console.log('✓ Org Admin now has active view permission with valid expiry\n');

    console.log('--- TEST B: Super Admin Requests View Access ---');
    // Super Admin requests Case Scope access on Org A
    const reqB = await createViewAccessRequest({
        user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
        targetType: 'case',
        targetId: `CASE-${testRunId}`,
        organizationId: orgA._id.toString(),
        duration: '6h',
        reason: 'Platform level audit of case'
    });
    assert.strictEqual(reqB.status, 'pending');
    assert.strictEqual(reqB.requiredApproverRole, 'admin');
    console.log('✓ Super Admin request created and routed to Org Admin');

    // Org Admin A approves
    const approvedB = await approveViewAccessRequest({
        requestId: reqB.requestId,
        approverUser: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id }
    });
    assert.strictEqual(approvedB.status, 'approved');
    assert.strictEqual(approvedB.permission.status, 'active');
    console.log('✓ Org Admin A approved Super Admin Case request');

    // Verify Super Admin has permission to evidenceA via Case scope
    const permB = await checkUserActivePermission({
        user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
        evidence: evidenceA
    });
    assert.strictEqual(permB.hasPermission, true);
    console.log('✓ Super Admin has active permission to evidence under Case scope\n');

    console.log('--- TEST C: Security & Boundary Enforcement ---');
    // Cross-organization boundary: Org Admin B attempts to approve a request for Org A
    const reqCross = await createViewAccessRequest({
        user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
        targetType: 'evidence',
        targetId: evidenceA._id.toString(),
        duration: '12h',
        reason: 'Audit request'
    });
    let crossBlocked = false;
    try {
        await approveViewAccessRequest({
            requestId: reqCross.requestId,
            approverUser: { id: orgAdminB._id.toString(), role: 'admin', organizationId: orgB._id }
        });
    } catch (err) {
        crossBlocked = true;
        assert.match(err.message, /another organization/i);
    }
    assert.strictEqual(crossBlocked, true);
    console.log('✓ Org Admin B is blocked from approving request for Org A');

    // Self-approval blocked
    let selfApprovalBlocked = false;
    try {
        await approveViewAccessRequest({
            requestId: reqCross.requestId,
            approverUser: { id: superAdmin._id.toString(), role: 'super_admin' }
        });
    } catch (err) {
        selfApprovalBlocked = true;
        assert.match(err.message, /self-approval/i);
    }
    assert.strictEqual(selfApprovalBlocked, true);
    console.log('✓ Requester is blocked from self-approving their own request');

    // Rejection workflow
    const rejectedReq = await rejectViewAccessRequest({
        requestId: reqCross.requestId,
        approverUser: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id },
        rejectionReason: 'Security audit insufficient credentials'
    });
    assert.strictEqual(rejectedReq.status, 'rejected');
    assert.strictEqual(rejectedReq.rejectionReason, 'Security audit insufficient credentials');
    console.log('✓ Request successfully rejected with recorded reason');

    // Revocation workflow
    const revokedReq = await revokeViewAccessPermission({
        requestId: reqA.requestId,
        approverUser: { id: superAdmin._id.toString(), role: 'super_admin' },
        revocationReason: 'Investigation concluded early'
    });
    assert.strictEqual(revokedReq.status, 'revoked');
    assert.strictEqual(revokedReq.permission.status, 'revoked');
    console.log('✓ Active permission successfully revoked');

    // Verify revoked permission denies access
    const permRevoked = await checkUserActivePermission({
        user: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
        evidence: evidenceA
    });
    assert.strictEqual(permRevoked.hasPermission, false);
    console.log('✓ Revoked permission immediately denies evidence access');

    console.log('\n=================================================================');
    console.log('🎉 ALL END-TO-END WORKFLOW & SECURITY TESTS PASSED SUCCESSFULLY!');
    console.log('=================================================================');

    process.exit(0);
}

runEndToEnd().catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
});

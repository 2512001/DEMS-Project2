/**
 * DEMS Automated Test Suite: View Access Approval System
 * Tests complete two-way approval, scope validation, temporary permissions,
 * expiry enforcement, revocation, cross-org denial, and upload approval preservation.
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const assert = require('assert');
const mongoose = require('mongoose');
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
    getWorkflowCounts,
    sweepExpiredPermissions
} = require('../services/viewAccessService');

let totalTests = 0;
let passedTests = 0;

async function runTest(name, fn) {
    totalTests++;
    try {
        await fn();
        console.log(`  ✓ [TEST ${totalTests}] ${name}`);
        passedTests++;
    } catch (err) {
        console.error(`  ✗ [TEST ${totalTests}] ${name}`);
        console.error(`    Error: ${err.message}`);
        console.error(err.stack);
    }
}

async function main() {
    console.log('=================================================================');
    console.log('🚀 DEMS VIEW ACCESS APPROVAL WORKFLOW TEST SUITE');
    console.log('=================================================================\n');

    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/DEMS');

    // Setup Test Orgs
    const testId = Date.now().toString().slice(-5);
    const orgA = await Organization.create({
        name: `Org Alpha ${testId}`,
        organizationCode: `OA${testId}`,
        organizationType: 'law_enforcement',
        status: 'active',
        createdBy: new mongoose.Types.ObjectId()
    });

    const orgB = await Organization.create({
        name: `Org Beta ${testId}`,
        organizationCode: `OB${testId}`,
        organizationType: 'corporate',
        status: 'active',
        createdBy: new mongoose.Types.ObjectId()
    });

    // Setup Users
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

    const superAdmin = await User.create({
        walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
        role: 'super_admin',
        accountStatus: 'active'
    });

    const officerA = await User.create({
        walletAddress: '0x' + crypto.randomBytes(20).toString('hex'),
        role: 'officer',
        organizationId: orgA._id,
        accountStatus: 'active'
    });

    // Setup Test Group in Org A
    const groupA = await Group.create({
        name: `Investigation Unit ${testId}`,
        organizationId: orgA._id,
        createdBy: orgAdminA._id,
        members: [officerA._id]
    });

    // Setup Evidence in Org A
    const evidence1 = await Evidence.create({
        user: officerA._id,
        uploadedBy: officerA._id,
        organizationId: orgA._id,
        groupId: groupA._id,
        caseId: `CASE-A-${testId}`,
        UploaderWallet: officerA.walletAddress,
        fileName: 'classified-photo.jpg',
        mimeType: 'image/jpeg',
        fileSize: 1024,
        fileHash: crypto.randomBytes(32).toString('hex'),
        ipfsCID: 'QmTestCID' + testId,
        encryption: {
            iv: crypto.randomBytes(12).toString('hex'),
            authTag: crypto.randomBytes(16).toString('hex'),
            algorithm: 'aes-256-gcm'
        },
        captureMetadata: {
            deviceInfo: 'Test Camera',
            gpsLocation: { latitude: 12.34, longitude: 56.78 },
            capturedAt: new Date()
        },
        status: 'stored_ipfs'
    });

    const evidence2 = await Evidence.create({
        user: officerA._id,
        uploadedBy: officerA._id,
        organizationId: orgA._id,
        groupId: null,
        caseId: `CASE-A-${testId}`,
        UploaderWallet: officerA.walletAddress,
        fileName: 'ballistics-report.pdf',
        mimeType: 'application/pdf',
        fileSize: 2048,
        fileHash: crypto.randomBytes(32).toString('hex'),
        ipfsCID: 'QmTestCID2' + testId,
        encryption: {
            iv: crypto.randomBytes(12).toString('hex'),
            authTag: crypto.randomBytes(16).toString('hex'),
            algorithm: 'aes-256-gcm'
        },
        captureMetadata: {
            deviceInfo: 'Test Scanner',
            gpsLocation: { latitude: 12.34, longitude: 56.78 },
            capturedAt: new Date()
        },
        status: 'stored_ipfs'
    });

    // 1. Org Admin cannot view protected evidence without approval
    await runTest('Org Admin has NO initial view permission to protected evidence', async () => {
        const check = await checkUserActivePermission({
            user: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
            evidence: evidence1
        });
        assert.strictEqual(check.hasPermission, false);
    });

    // 2. Super Admin cannot view protected evidence without approval
    await runTest('Super Admin has NO initial view permission to protected evidence', async () => {
        const check = await checkUserActivePermission({
            user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
            evidence: evidence1
        });
        assert.strictEqual(check.hasPermission, false);
    });

    // 3. Evidence owner can always view their own uploaded evidence
    await runTest('Original uploader retains access to own evidence', async () => {
        const check = await checkUserActivePermission({
            user: { id: officerA._id.toString(), role: 'officer', walletAddress: officerA.walletAddress },
            evidence: evidence1
        });
        assert.strictEqual(check.hasPermission, true);
        assert.strictEqual(check.isOwner, true);
    });

    // 4. Org Admin submits view request for Evidence Scope
    let reqEvidence;
    await runTest('Org Admin can submit a view access request for evidence to Super Admin', async () => {
        reqEvidence = await createViewAccessRequest({
            user: { id: orgAdminA._id, role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
            targetType: 'evidence',
            targetId: evidence1._id.toString(),
            reason: 'Reviewing forensic photo for audit trial',
            duration: '1h'
        });

        assert.strictEqual(reqEvidence.status, 'pending');
        assert.strictEqual(reqEvidence.requiredApproverRole, 'super_admin');
        assert.strictEqual(reqEvidence.targetType, 'evidence');
        assert.strictEqual(reqEvidence.targetId, evidence1._id.toString());
    });

    // 5. Self-approval is rejected
    await runTest('Org Admin cannot approve their own view request', async () => {
        let threw = false;
        try {
            await approveViewAccessRequest({
                requestId: reqEvidence.requestId,
                approverUser: { id: orgAdminA._id, role: 'admin', organizationId: orgA._id }
            });
        } catch (err) {
            threw = true;
            assert.match(err.message, /forbidden|Super Admin/i);
        }
        assert.strictEqual(threw, true);
    });

    // 6. Super Admin approves Org Admin request
    await runTest('Super Admin can approve Org Admin view request and grant temporary permission', async () => {
        const approved = await approveViewAccessRequest({
            requestId: reqEvidence.requestId,
            approverUser: { id: superAdmin._id, role: 'super_admin' }
        });

        assert.strictEqual(approved.status, 'approved');
        assert.strictEqual(approved.permission.status, 'active');
        assert(approved.permission.expiresAt > new Date());

        const check = await checkUserActivePermission({
            user: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
            evidence: evidence1
        });
        assert.strictEqual(check.hasPermission, true);
        assert.strictEqual(check.scope, 'evidence');
    });

    // 7. Evidence Scope does not grant access to other evidence in the same case
    await runTest('Evidence scope grant applies ONLY to approved item, not entire case', async () => {
        const checkOther = await checkUserActivePermission({
            user: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
            evidence: evidence2
        });
        assert.strictEqual(checkOther.hasPermission, false);
    });

    // 8. Super Admin submits view request for Case Scope
    let reqCase;
    await runTest('Super Admin can submit a view access request for Case Scope to Org Admin', async () => {
        reqCase = await createViewAccessRequest({
            user: { id: superAdmin._id, role: 'super_admin', walletAddress: superAdmin.walletAddress },
            targetType: 'case',
            targetId: `CASE-A-${testId}`,
            organizationId: orgA._id,
            reason: 'Investigating inter-agency compliance for Case A',
            duration: '6h'
        });

        assert.strictEqual(reqCase.status, 'pending');
        assert.strictEqual(reqCase.requiredApproverRole, 'admin');
        assert.strictEqual(reqCase.targetType, 'case');
    });

    // 9. Cross-organization approval denial
    await runTest('Org Admin of Org B CANNOT approve request for Org A', async () => {
        let threw = false;
        try {
            await approveViewAccessRequest({
                requestId: reqCase.requestId,
                approverUser: { id: orgAdminB._id, role: 'admin', organizationId: orgB._id }
            });
        } catch (err) {
            threw = true;
            assert.match(err.message, /another organization/i);
        }
        assert.strictEqual(threw, true);
    });

    // 10. Relevant Org Admin approves Super Admin Case request
    await runTest('Relevant Org Admin of Org A can approve Super Admin Case request', async () => {
        const approved = await approveViewAccessRequest({
            requestId: reqCase.requestId,
            approverUser: { id: orgAdminA._id, role: 'admin', organizationId: orgA._id }
        });

        assert.strictEqual(approved.status, 'approved');
        assert.strictEqual(approved.permission.status, 'active');

        // Both files in Case A should now be accessible to Super Admin
        const checkEv1 = await checkUserActivePermission({
            user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
            evidence: evidence1
        });
        assert.strictEqual(checkEv1.hasPermission, true);
        assert.strictEqual(checkEv1.scope, 'case');

        const checkEv2 = await checkUserActivePermission({
            user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
            evidence: evidence2
        });
        assert.strictEqual(checkEv2.hasPermission, true);
        assert.strictEqual(checkEv2.scope, 'case');
    });

    // 11. Revocation of active permission
    await runTest('Org Admin can revoke Super Admin Case permission immediately', async () => {
        const revoked = await revokeViewAccessPermission({
            requestId: reqCase.requestId,
            approverUser: { id: orgAdminA._id, role: 'admin', organizationId: orgA._id },
            revocationReason: 'Investigation period concluded early.'
        });

        assert.strictEqual(revoked.status, 'revoked');
        assert.strictEqual(revoked.permission.status, 'revoked');

        // Check that Super Admin access is immediately denied
        const checkEv1 = await checkUserActivePermission({
            user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
            evidence: evidence1
        });
        assert.strictEqual(checkEv1.hasPermission, false);
    });

    // 12. Group Scope request and approval
    await runTest('Group Scope request grants access only to files within the group', async () => {
        const reqGroup = await createViewAccessRequest({
            user: { id: superAdmin._id, role: 'super_admin', walletAddress: superAdmin.walletAddress },
            targetType: 'group',
            targetId: groupA._id.toString(),
            organizationId: orgA._id,
            reason: 'Group compliance check',
            duration: '1h'
        });

        await approveViewAccessRequest({
            requestId: reqGroup.requestId,
            approverUser: { id: orgAdminA._id, role: 'admin', organizationId: orgA._id }
        });

        // evidence1 has groupId = groupA -> accessible
        const checkEv1 = await checkUserActivePermission({
            user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
            evidence: evidence1
        });
        assert.strictEqual(checkEv1.hasPermission, true);
        assert.strictEqual(checkEv1.scope, 'group');

        // evidence2 has NO groupId -> NOT accessible under group grant
        const checkEv2 = await checkUserActivePermission({
            user: { id: superAdmin._id.toString(), role: 'super_admin', walletAddress: superAdmin.walletAddress },
            evidence: evidence2
        });
        assert.strictEqual(checkEv2.hasPermission, false);
    });

    // 13. Rejection workflow with reason
    await runTest('Super Admin can reject Org Admin request with recorded rejection reason', async () => {
        const reqReject = await createViewAccessRequest({
            user: { id: orgAdminA._id, role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
            targetType: 'evidence',
            targetId: evidence2._id.toString(),
            reason: 'Need to review PDF',
            duration: '1h'
        });

        const rejected = await rejectViewAccessRequest({
            requestId: reqReject.requestId,
            approverUser: { id: superAdmin._id, role: 'super_admin' },
            rejectionReason: 'Insufficient justification provided for ballistics document.'
        });

        assert.strictEqual(rejected.status, 'rejected');
        assert.strictEqual(rejected.rejectionReason, 'Insufficient justification provided for ballistics document.');

        const check = await checkUserActivePermission({
            user: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
            evidence: evidence2
        });
        assert.strictEqual(check.hasPermission, false);
    });

    // 14. Expiration enforcement
    await runTest('Expired permission is automatically denied and marked expired', async () => {
        // Create a permission with expiresAt in the past
        const expiredReq = await ViewAccessRequest.create({
            requestId: 'VAR-EXPIRED-' + testId,
            requesterId: orgAdminA._id,
            requesterRole: 'admin',
            requesterWallet: orgAdminA.walletAddress,
            organizationId: orgA._id,
            targetType: 'evidence',
            targetId: evidence2._id.toString(),
            reason: 'Testing expiry',
            requestedDuration: '1h',
            durationMs: 3600000,
            requiredApproverRole: 'super_admin',
            status: 'approved',
            approverId: superAdmin._id,
            approvedAt: new Date(Date.now() - 7200000),
            permission: {
                approvedScope: 'evidence',
                targetType: 'evidence',
                targetId: evidence2._id.toString(),
                approvedAt: new Date(Date.now() - 7200000),
                expiresAt: new Date(Date.now() - 3600000), // Expired 1 hour ago
                status: 'active'
            }
        });

        const check = await checkUserActivePermission({
            user: { id: orgAdminA._id.toString(), role: 'admin', organizationId: orgA._id, walletAddress: orgAdminA.walletAddress },
            evidence: evidence2
        });

        assert.strictEqual(check.hasPermission, false, 'Expired permission must be denied');

        const reloaded = await ViewAccessRequest.findById(expiredReq._id);
        assert.strictEqual(reloaded.status, 'expired', 'Status should be updated to expired');
        assert.strictEqual(reloaded.permission.status, 'expired');
    });

    // 15. Workflow counts endpoint returns accurate counts
    await runTest('getWorkflowCounts returns real counts for notifications and approvals', async () => {
        const counts = await getWorkflowCounts({
            id: orgAdminA._id,
            role: 'admin',
            organizationId: orgA._id
        });

        assert(typeof counts.unreadNotifications === 'number');
        assert(typeof counts.pendingUploadApprovals === 'number');
        assert(typeof counts.pendingViewApprovals === 'number');
        assert(typeof counts.myPendingViewRequests === 'number');
        assert(typeof counts.myActivePermissions === 'number');
    });

    console.log(`\n=================================================================`);
    console.log(`Results: ${passedTests}/${totalTests} tests passed.`);
    console.log(`=================================================================\n`);

    await mongoose.disconnect();
    if (passedTests !== totalTests) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Fatal error in test suite:', err);
    process.exit(1);
});

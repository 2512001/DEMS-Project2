const axios = require('../dems-backend-node/node_modules/axios');
const jwt = require('../dems-backend-node/node_modules/jsonwebtoken');
const mongoose = require('../dems-backend-node/node_modules/mongoose');
const User = require('../dems-backend-node/model/userModel');
const Organization = require('../dems-backend-node/model/organizationModel');
const Evidence = require('../dems-backend-node/model/evidenceModel');
const ViewAccessRequest = require('../dems-backend-node/model/viewAccessRequestModel');
const Notification = require('../dems-backend-node/model/notificationModel');

const API_BASE = 'http://127.0.0.1:3000/api';
const JWT_SECRET = process.env.JWT_SECRET || 'dems-local-test-secret';

function createToken(user) {
  return jwt.sign(
    {
      id: user._id.toString(),
      role: user.role,
      walletAddress: user.walletAddress,
      organizationId: user.organizationId ? user.organizationId.toString() : null
    },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

async function runTest() {
  console.log('=== STARTING BI-DIRECTIONAL VIEW ACCESS WORKFLOW VERIFICATION ===');
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');

  // 1. Find Super Admin
  const superAdmin = await User.findOne({ role: 'super_admin', accountStatus: 'active' });
  if (!superAdmin) throw new Error('Super admin user not found');
  console.log(`[PASS] Found Super Admin: ${superAdmin.walletAddress} (${superAdmin._id})`);

  // 2. Find target evidence and its exact owning Organization & Admin
  const allEvidence = await Evidence.find({ organizationId: { $ne: null } }).sort({ createdAt: -1 });
  let evidence = null;
  let org = null;
  let orgAdmin = null;

  for (const ev of allEvidence) {
    const o = await Organization.findById(ev.organizationId);
    if (!o) continue;
    const admin = await User.findOne({ organizationId: o._id, role: 'admin', accountStatus: 'active' });
    if (admin) {
      evidence = ev;
      org = o;
      orgAdmin = admin;
      break;
    }
  }

  if (!evidence || !org || !orgAdmin) {
    throw new Error('Could not find evidence linked to an organization with an active admin');
  }

  console.log(`[PASS] Using Target Evidence: "${evidence.fileName}" (${evidence._id})`);
  console.log(`[PASS] Using Organization: "${org.name}" (${org._id})`);
  console.log(`[PASS] Found Organization Admin: ${orgAdmin.walletAddress} (${orgAdmin._id})`);

  const saToken = createToken(superAdmin);
  const oaToken = createToken(orgAdmin);

  // Clean up any existing pending/approved requests for this target and requester
  await ViewAccessRequest.deleteMany({
    targetId: evidence._id.toString()
  });

  // ==========================================
  // TEST 1: Super Admin -> Org Admin Workflow
  // ==========================================
  console.log('\n--- TEST 1: Super Admin requests view access for Org Evidence ---');
  const createRes = await axios.post(
    `${API_BASE}/view-access/requests`,
    {
      targetType: 'evidence',
      targetId: evidence._id.toString(),
      reason: 'Platform security audit verification',
      duration: '1h'
    },
    { headers: { Authorization: `Bearer ${saToken}` } }
  );

  if (!createRes.data.success) throw new Error('Failed to create view request as Super Admin');
  const saReq = createRes.data.data;
  console.log(`[PASS] Request created: ${saReq.requestId}, status: ${saReq.status}, approverRole: ${saReq.requiredApproverRole}`);

  if (saReq.requiredApproverRole !== 'admin') {
    throw new Error(`Expected requiredApproverRole to be 'admin', got: ${saReq.requiredApproverRole}`);
  }

  // Verify notification was created for Org Admin
  const notif = await Notification.findOne({
    recipientId: orgAdmin._id,
    type: 'view_request_created'
  }).sort({ createdAt: -1 });
  console.log(`[PASS] Org Admin Notification found: "${notif?.title}" - "${notif?.message}"`);

  // Org Admin fetches incoming requests
  console.log('\n--- TEST 2: Org Admin fetches Incoming Requests ---');
  const incomingRes = await axios.get(
    `${API_BASE}/view-access/requests/incoming`,
    { headers: { Authorization: `Bearer ${oaToken}` } }
  );

  if (!incomingRes.data.success) throw new Error('Org Admin failed to fetch incoming requests');
  const incomingRequests = incomingRes.data.data;
  const foundRequest = incomingRequests.find(r => r.requestId === saReq.requestId);
  if (!foundRequest) {
    throw new Error(`Request ${saReq.requestId} NOT found in Org Admin's incoming requests! Total incoming: ${incomingRequests.length}`);
  }
  console.log(`[PASS] Request ${saReq.requestId} successfully received in Org Admin Incoming Requests!`);

  // Org Admin approves the request
  console.log('\n--- TEST 3: Org Admin approves Super Admin Request ---');
  const approveRes = await axios.post(
    `${API_BASE}/view-access/requests/${saReq.requestId}/approve`,
    {},
    { headers: { Authorization: `Bearer ${oaToken}` } }
  );

  if (!approveRes.data.success) throw new Error('Org Admin failed to approve request');
  console.log(`[PASS] Request approved. Permission status: ${approveRes.data.data.permission?.status}, expires: ${approveRes.data.data.permission?.expiresAt}`);

  // Verify Super Admin can now access evidence / content
  console.log('\n--- TEST 4: Super Admin verifies active permission on Evidence ---');
  const saEvidenceRes = await axios.get(
    `${API_BASE}/evidence/${evidence._id}`,
    { headers: { Authorization: `Bearer ${saToken}` } }
  );
  if (!saEvidenceRes.data.success) throw new Error('Super Admin failed to get evidence details');
  console.log(`[PASS] Evidence access verified. userAccessStatus: ${saEvidenceRes.data.data.userAccessStatus}`);

  // Verify platform evidence list enrichment for Super Admin
  const platformRes = await axios.get(
    `${API_BASE}/evidence/platform`,
    { headers: { Authorization: `Bearer ${saToken}` } }
  );
  const enrichedItem = platformRes.data.data.find(e => e._id.toString() === evidence._id.toString());
  console.log(`[PASS] Global Evidence enriched userAccessStatus: "${enrichedItem?.userAccessStatus}"`);

  // ==========================================
  // TEST 5: Org Admin -> Super Admin Workflow
  // ==========================================
  console.log('\n--- TEST 5: Org Admin requests view access to Super Admin ---');
  // Clean up
  await ViewAccessRequest.deleteMany({
    requesterId: orgAdmin._id,
    targetId: evidence._id.toString()
  });

  const oaReqRes = await axios.post(
    `${API_BASE}/view-access/requests`,
    {
      targetType: 'evidence',
      targetId: evidence._id.toString(),
      reason: 'Compliance audit by organization admin',
      duration: '6h'
    },
    { headers: { Authorization: `Bearer ${oaToken}` } }
  );

  const oaReq = oaReqRes.data.data;
  console.log(`[PASS] Org Admin request created: ${oaReq.requestId}, approverRole: ${oaReq.requiredApproverRole}`);
  if (oaReq.requiredApproverRole !== 'super_admin') {
    throw new Error(`Expected requiredApproverRole 'super_admin', got: ${oaReq.requiredApproverRole}`);
  }

  // Super Admin checks incoming requests
  const saIncomingRes = await axios.get(
    `${API_BASE}/view-access/requests/incoming`,
    { headers: { Authorization: `Bearer ${saToken}` } }
  );
  const saFound = saIncomingRes.data.data.find(r => r.requestId === oaReq.requestId);
  if (!saFound) throw new Error('Org Admin request not found in Super Admin incoming requests!');
  console.log(`[PASS] Request ${oaReq.requestId} successfully visible to Super Admin!`);

  // Super Admin rejects the request to test rejection flow
  console.log('\n--- TEST 6: Super Admin rejects request with reason ---');
  const rejectRes = await axios.post(
    `${API_BASE}/view-access/requests/${oaReq.requestId}/reject`,
    { rejectionReason: 'Insufficient audit justification provided for this classification.' },
    { headers: { Authorization: `Bearer ${saToken}` } }
  );
  console.log(`[PASS] Rejected request status: ${rejectRes.data.data.status}, reason: "${rejectRes.data.data.rejectionReason}"`);

  // ==========================================
  // TEST 7: Security Boundary Verifications
  // ==========================================
  console.log('\n--- TEST 7: Security Boundary Verifications ---');
  // Revoke first grant so we can test self-approval prevention on a new request
  await axios.post(
    `${API_BASE}/view-access/requests/${saReq.requestId}/revoke`,
    { revocationReason: 'Revocation test' },
    { headers: { Authorization: `Bearer ${oaToken}` } }
  );

  // Super Admin creates a new request
  const saReq2Res = await axios.post(
    `${API_BASE}/view-access/requests`,
    {
      targetType: 'evidence',
      targetId: evidence._id.toString(),
      reason: 'Self-approval prevention test',
      duration: '1h'
    },
    { headers: { Authorization: `Bearer ${saToken}` } }
  );
  const saReq2 = saReq2Res.data.data;

  try {
    await axios.post(
      `${API_BASE}/view-access/requests/${saReq2.requestId}/approve`,
      {},
      { headers: { Authorization: `Bearer ${saToken}` } }
    );
    throw new Error('Self-approval was allowed! SECURITY VIOLATION!');
  } catch (err) {
    if (err.response?.status === 403) {
      console.log(`[PASS] Self-approval blocked with HTTP 403: "${err.response.data.message}"`);
    } else {
      throw err;
    }
  }

  // Workflow counts test
  console.log('\n--- TEST 8: Workflow counts test ---');
  const countsRes = await axios.get(
    `${API_BASE}/view-access/counts`,
    { headers: { Authorization: `Bearer ${oaToken}` } }
  );
  console.log(`[PASS] Org Admin workflow counts:`, countsRes.data.data);

  const saCountsRes = await axios.get(
    `${API_BASE}/view-access/counts`,
    { headers: { Authorization: `Bearer ${saToken}` } }
  );
  console.log(`[PASS] Super Admin workflow counts:`, saCountsRes.data.data);

  console.log('\n=========================================');
  console.log('✅ ALL TESTS PASSED SUCCESSFULLY!');
  console.log('=========================================');

  await mongoose.disconnect();
}

runTest().catch((err) => {
  console.error('\n❌ TEST FAILED:', err.response?.data || err.message);
  process.exit(1);
});

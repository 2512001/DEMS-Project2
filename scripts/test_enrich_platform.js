const mongoose = require('../dems-backend-node/node_modules/mongoose');
const Evidence = require('../dems-backend-node/model/evidenceModel');
const ViewAccessRequest = require('../dems-backend-node/model/viewAccessRequestModel');
const User = require('../dems-backend-node/model/userModel');
const { checkUserActivePermission, sweepExpiredPermissions } = require('../dems-backend-node/services/viewAccessService');

async function testEnrich() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const superAdmin = await User.findOne({ role: 'super_admin' }).lean();
  console.log('Super Admin user:', superAdmin._id, superAdmin.walletAddress);

  const user = {
    id: superAdmin._id.toString(),
    role: superAdmin.role,
    walletAddress: superAdmin.walletAddress
  };

  const pendingRequests = await ViewAccessRequest.find({ requesterId: superAdmin._id, status: 'pending' }).lean();
  console.log('Pending requests for this Super Admin:', pendingRequests.length);
  for (const pr of pendingRequests) {
    console.log('  Req:', pr.requestId, 'targetType:', pr.targetType, 'targetId:', pr.targetId, 'evidenceId:', pr.evidenceId);
  }

  const allEvidence = await Evidence.find().limit(20).lean();
  for (const ev of allEvidence) {
    const permCheck = await checkUserActivePermission({ user, evidence: ev });
    const latestRequest = await ViewAccessRequest.findOne({
      requesterId: user.id,
      $or: [
        { targetType: 'evidence', targetId: ev._id.toString() },
        ...(ev.caseId ? [{ targetType: 'case', targetId: ev.caseId }] : []),
        ...(ev.groupId ? [{ targetType: 'group', targetId: (ev.groupId._id || ev.groupId).toString() }] : [])
      ]
    }).sort({ createdAt: -1 });

    if (latestRequest || permCheck.hasPermission) {
      console.log(`Evidence: ${ev.fileName} (${ev._id}) -> permCheck: ${permCheck.hasPermission}, latestReq: ${latestRequest?.requestId}, status: ${latestRequest?.status}`);
    }
  }

  await mongoose.disconnect();
}

testEnrich().catch(console.error);

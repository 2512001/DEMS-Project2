const mongoose = require('../dems-backend-node/node_modules/mongoose');
const Evidence = require('../dems-backend-node/model/evidenceModel');
const ViewAccessRequest = require('../dems-backend-node/model/viewAccessRequestModel');
const User = require('../dems-backend-node/model/userModel');
const { checkUserActivePermission } = require('../dems-backend-node/services/viewAccessService');

async function testThese4() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const superAdmin = await User.findOne({ role: 'super_admin' }).lean();
  const user = { id: superAdmin._id.toString(), role: superAdmin.role, walletAddress: superAdmin.walletAddress };

  const ids = ['6adede2ed47cd2db47b684be', '6ae01bf1eca069d93520a1c1', '6ae015cc6596bed9b1fc22f2', '6ade7918c7a1c807ebab4f25'];
  for (const id of ids) {
    const ev = await Evidence.findById(id).lean();
    if (!ev) {
      console.log('Not found:', id);
      continue;
    }
    const permCheck = await checkUserActivePermission({ user, evidence: ev });
    const latestRequest = await ViewAccessRequest.findOne({
      requesterId: user.id,
      $or: [
        { targetType: 'evidence', targetId: ev._id.toString() },
        ...(ev.caseId ? [{ targetType: 'case', targetId: ev.caseId }] : []),
        ...(ev.groupId ? [{ targetType: 'group', targetId: (ev.groupId._id || ev.groupId).toString() }] : [])
      ]
    }).sort({ createdAt: -1 });

    const userAccessStatus = permCheck.hasPermission ? 'approved' : (latestRequest?.status || 'access_required');
    console.log(`File: ${ev.fileName} (${ev._id}) -> userAccessStatus: ${userAccessStatus}, reqId: ${latestRequest?.requestId}, reqStatus: ${latestRequest?.status}`);
  }

  await mongoose.disconnect();
}

testThese4().catch(console.error);

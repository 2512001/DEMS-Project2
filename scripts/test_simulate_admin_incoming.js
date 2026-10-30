const mongoose = require('../dems-backend-node/node_modules/mongoose');
const ViewAccessRequest = require('../dems-backend-node/model/viewAccessRequestModel');
const User = require('../dems-backend-node/model/userModel');

async function testIncoming() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const adminUser = await User.findOne({ walletAddress: '0x734ffbd1f528e5cbfdc9851edb324f2efabe4995' });
  console.log('Admin user found:', adminUser._id, 'role:', adminUser.role, 'orgId:', adminUser.organizationId);

  // Replicate req.user from authMiddleware
  const reqUser = {
    id: adminUser._id.toString(),
    role: adminUser.role,
    walletAddress: adminUser.walletAddress,
    organizationId: adminUser.organizationId ? adminUser.organizationId.toString() : null
  };

  const filter = {};
  if (reqUser.role === 'super_admin') {
    filter.requiredApproverRole = 'super_admin';
  } else if (reqUser.role === 'admin' && reqUser.organizationId) {
    filter.requiredApproverRole = 'admin';
    filter.organizationId = reqUser.organizationId;
  }

  console.log('Query filter:', filter);
  const count = await ViewAccessRequest.countDocuments(filter);
  const requests = await ViewAccessRequest.find(filter).lean();
  console.log('Result count:', count);
  console.log('Requests:', requests.map(r => ({ id: r.requestId, target: r.targetName, status: r.status, reqRole: r.requesterRole })));

  await mongoose.disconnect();
}

testIncoming().catch(console.error);

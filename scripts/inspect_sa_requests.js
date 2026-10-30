const mongoose = require('../dems-backend-node/node_modules/mongoose');
const ViewAccessRequest = require('../dems-backend-node/model/viewAccessRequestModel');
const User = require('../dems-backend-node/model/userModel');
const Org = require('../dems-backend-node/model/organizationModel');

async function inspectSARequests() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const saRequests = await ViewAccessRequest.find({ requesterRole: 'super_admin' }).lean();
  console.log('Total Super Admin requests:', saRequests.length);
  for (const r of saRequests) {
    console.log('\n--- Request:', r.requestId);
    console.log('Target:', r.targetName, 'Scope:', r.targetType, 'TargetId:', r.targetId);
    console.log('Status:', r.status);
    console.log('RequesterId:', r.requesterId, 'RequesterRole:', r.requesterRole);
    console.log('RequiredApproverRole:', r.requiredApproverRole);
    console.log('OrganizationId:', r.organizationId, typeof r.organizationId);
    console.log('ApproverId:', r.approverId);

    // Let's find what Org Admins exist for this organizationId
    const orgAdmins = await User.find({ organizationId: r.organizationId, role: 'admin' }).lean();
    console.log('Org Admins found for this orgId:', orgAdmins.length, orgAdmins.map(a => ({ id: a._id, wallet: a.walletAddress, status: a.accountStatus, role: a.role, orgId: a.organizationId })));
    
    // Check if any Org Admin has org where adminId or createdBy matches them
    const org = await Org.findById(r.organizationId).lean();
    console.log('Org doc:', org ? { id: org._id, name: org.name, adminId: org.adminId, createdBy: org.createdBy } : 'NOT FOUND');
  }
  await mongoose.disconnect();
}

inspectSARequests().catch(console.error);

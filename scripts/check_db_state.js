const mongoose = require('../dems-backend-node/node_modules/mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Org = mongoose.model('Organization', new mongoose.Schema({}, { strict: false }));
  const Evidence = mongoose.model('Evidence', new mongoose.Schema({}, { strict: false }));
  const VAR = mongoose.model('ViewAccessRequest', new mongoose.Schema({}, { strict: false }));

  const users = await User.find({ role: { $in: ['admin', 'super_admin'] } }).lean();
  console.log('=== ADMIN USERS ===');
  users.forEach(u => console.log('User:', u.walletAddress, 'role:', u.role, 'orgId:', u.organizationId, 'status:', u.accountStatus, 'id:', u._id));

  const orgs = await Org.find().lean();
  console.log('=== ORGANIZATIONS ===');
  orgs.forEach(o => console.log('Org:', o.name, 'id:', o._id, 'adminId:', o.adminId, 'createdBy:', o.createdBy));

  const requests = await VAR.find().lean();
  console.log('=== VIEW ACCESS REQUESTS === (' + requests.length + ')');
  requests.forEach(r => console.log('Req:', r.requestId, 'requester:', r.requesterRole, 'approverRole:', r.requiredApproverRole, 'status:', r.status, 'orgId:', r.organizationId));

  await mongoose.disconnect();
}

run().catch(console.error);

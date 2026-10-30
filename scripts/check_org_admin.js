const mongoose = require('../dems-backend-node/node_modules/mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  const Org = mongoose.model('Organization', new mongoose.Schema({}, { strict: false }));
  const VAR = mongoose.model('ViewAccessRequest', new mongoose.Schema({}, { strict: false }));

  const pendingSA = await VAR.find({ requesterRole: 'super_admin', status: 'pending' }).lean();
  console.log('Pending Super Admin Requests:', pendingSA.length);
  for (const r of pendingSA) {
    console.log('\n--- Request:', r.requestId, 'target:', r.targetName, 'orgId:', r.organizationId);
    const org = await Org.findById(r.organizationId).lean();
    console.log('Org:', org ? org.name : 'NOT FOUND', 'adminId:', org?.adminId, 'createdBy:', org?.createdBy);
    const usersWithOrg = await User.find({ organizationId: r.organizationId }).lean();
    console.log('Users with organizationId in User doc:', usersWithOrg.map(u => ({ id: u._id, role: u.role, status: u.accountStatus, wallet: u.walletAddress })));
    const adminUser = org?.adminId ? await User.findById(org.adminId).lean() : null;
    console.log('User referenced by org.adminId:', adminUser ? { id: adminUser._id, role: adminUser.role, orgId: adminUser.organizationId } : 'none');
  }

  await mongoose.disconnect();
}

run().catch(console.error);

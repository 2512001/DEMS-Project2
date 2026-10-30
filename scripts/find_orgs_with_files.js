const mongoose = require('../dems-backend-node/node_modules/mongoose');
const Evidence = require('../dems-backend-node/model/evidenceModel');
const Org = require('../dems-backend-node/model/organizationModel');
const User = require('../dems-backend-node/model/userModel');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const orgsWithFiles = await Evidence.aggregate([
    { $match: { organizationId: { $ne: null } } },
    { $group: { _id: '$organizationId', count: { $sum: 1 } } }
  ]);
  for (const o of orgsWithFiles) {
    const orgDoc = await Org.findById(o._id).lean();
    const admin = await User.findOne({ organizationId: o._id, role: 'admin' }).lean();
    console.log('Org:', orgDoc?.name, 'id:', o._id, 'files count:', o.count, 'adminWallet:', admin?.walletAddress, 'adminId:', admin?._id);
  }
  await mongoose.disconnect();
}
run().catch(console.error);

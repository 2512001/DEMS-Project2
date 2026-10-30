const mongoose = require('../dems-backend-node/node_modules/mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const Evidence = mongoose.model('Evidence', new mongoose.Schema({}, { strict: false }));
  const total = await Evidence.countDocuments();
  const withOrg = await Evidence.countDocuments({ organizationId: { $ne: null } });
  const withoutOrg = await Evidence.countDocuments({ $or: [{ organizationId: null }, { organizationId: { $exists: false } }] });
  console.log('Total:', total, 'With Org:', withOrg, 'Without Org:', withoutOrg);
  const sampleWithOrg = await Evidence.find({ organizationId: { $ne: null } }).limit(5).lean();
  console.log('Sample with org:');
  sampleWithOrg.forEach(s => console.log('ID:', s._id, 'name:', s.fileName, 'orgId:', s.organizationId, 'uploader:', s.uploadedBy));
  await mongoose.disconnect();
}

run().catch(console.error);

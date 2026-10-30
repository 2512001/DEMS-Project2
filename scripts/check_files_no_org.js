const mongoose = require('../dems-backend-node/node_modules/mongoose');

async function run() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const Evidence = mongoose.model('Evidence', new mongoose.Schema({}, { strict: false }));
  const User = mongoose.model('User', new mongoose.Schema({}, { strict: false }));
  
  const filesWithoutOrg = await Evidence.find({ $or: [{ organizationId: null }, { organizationId: { $exists: false } }] }).lean();
  console.log('Files without org:', filesWithoutOrg.length);
  for (const f of filesWithoutOrg) {
    let uploaderUser = null;
    if (f.uploadedBy) {
      uploaderUser = await User.findById(f.uploadedBy).lean();
    } else if (f.UploaderWallet) {
      uploaderUser = await User.findOne({ walletAddress: f.UploaderWallet.toLowerCase() }).lean();
    }
    console.log(`File: ${f.fileName} (id: ${f._id}) -> Uploader: ${uploaderUser?.walletAddress} (role: ${uploaderUser?.role}, orgId: ${uploaderUser?.organizationId})`);
  }
  await mongoose.disconnect();
}

run().catch(console.error);

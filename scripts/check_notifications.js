const mongoose = require('../dems-backend-node/node_modules/mongoose');
const Notification = require('../dems-backend-node/model/notificationModel');

async function checkNotifications() {
  await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
  const notifs = await Notification.find({ type: /view_request/ }).sort({ createdAt: -1 }).limit(10).lean();
  console.log('Total view_request notifications found in last 10:', notifs.length);
  for (const n of notifs) {
    console.log('Notif:', n._id, 'type:', n.type, 'title:', n.title, 'recipient:', n.recipientId, 'org:', n.organizationId, 'read:', n.read, 'time:', n.createdAt);
  }
  await mongoose.disconnect();
}

checkNotifications().catch(console.error);

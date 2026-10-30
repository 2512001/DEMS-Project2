const mongoose = require('mongoose');

async function listUsers() {
    await mongoose.connect('mongodb://127.0.0.1:27017/DEMS');
    const users = await mongoose.connection.collection('users').find({}, {
        projection: { email: 1, role: 1, organizationId: 1, isApproved: 1, status: 1 }
    }).toArray();
    console.log('--- ALL USERS IN DB ---');
    users.forEach(u => console.log(`Email: ${u.email} | Role: ${u.role} | OrgId: ${u.organizationId} | Status: ${u.status}`));
    const orgs = await mongoose.connection.collection('organizations').find({}, { projection: { name: 1, organizationCode: 1 } }).toArray();
    console.log('--- ALL ORGS IN DB ---');
    orgs.forEach(o => console.log(`Name: ${o.name} | Code: ${o.organizationCode} | ID: ${o._id}`));
    process.exit(0);
}

listUsers().catch(err => {
    console.error(err);
    process.exit(1);
});

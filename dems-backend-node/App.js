require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { connect } = require("./connectionDb/connectDb");
const evidenceRoutes = require('./routes/evidenceRoutes');
const authRoutes = require('./routes/authRoutes');
const adminRoutes = require('./routes/adminRoutes');
const quarantineRoutes = require('./routes/quarantineRoutes');
const modificationRoutes = require('./routes/modificationRoutes');
const organizationRoutes = require('./routes/organizationRoutes');
const invitationRoutes = require('./routes/invitationRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const otpRoutes = require('./routes/otpRoutes');
const groupRoutes = require('./routes/groupRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const monitoringRoutes = require('./routes/monitoringRoutes');
const controlledUploadRoutes = require('./routes/controlledUploadRoutes');
const { initializeTransporter, verifySMTPConnection, isSMTPConfigured } = require('./services/emailService');
const mongoose = require("mongoose");


//connect database 
connect();

try {
  initializeTransporter();
  if (isSMTPConfigured()) {
    verifySMTPConnection().then((result) => {
      if (!result.success) {
        console.error('[EMAIL] SMTP verify failed:', result.error);
      }
    });
  }
} catch (error) {
  console.error('[EMAIL] Failed to initialize email service:', error.message);
}





const app = express();
const PORT = process.env.PORT || 3000;

// 1. Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));



//router middleware
app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/evidence', evidenceRoutes);
app.use('/api/quarantine', quarantineRoutes);
app.use('/api/modifications', modificationRoutes);
app.use('/api/organization', organizationRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/monitoring', monitoringRoutes);
app.use('/api/controlled-upload', controlledUploadRoutes);



// Catch-all for 404 Not Found routes
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        message: 'API Route Not Found'
    });
});

// Global Error Handler
app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    if (process.env.NODE_ENV !== 'production' && err.stack) {
        console.error(err.stack);
    }

    if (err.name === 'ValidationError') {
        const message = Object.values(err.errors || {}).map((item) => item.message).join(' ') || err.message;
        return res.status(400).json({ success: false, message });
    }

    const status = err.statusCode || 500;
    const isUploadError = err.message === 'Unsupported file type.' || err.code === 'LIMIT_FILE_SIZE' || err.code === 'UNSUPPORTED_IMAGE_TYPE';
    res.status(isUploadError ? 400 : status).json({
        success: false,
        message: isUploadError
            ? (err.code === 'LIMIT_FILE_SIZE' ? 'File exceeds the 50MB upload limit.' : err.message)
            : (status === 500 ? (process.env.NODE_ENV === 'production' ? 'Internal Server Error' : err.message) : err.message)
    });
});


app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 DEMS API Gateway running on port ${PORT}`);
    console.log(`=========================================`);
});

const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const allowedMimeTypes = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'application/pdf'
]);

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => {
        cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
        const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`;
        const safeName = String(file.originalname || 'evidence').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
        cb(null, `${uniqueSuffix}-${safeName}`);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (allowedMimeTypes.has(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(new Error('Unsupported file type.'));
    }
});

// Memory storage for controlled upload workflow (direct buffer access)
const memoryStorage = multer.memoryStorage();

const uploadMemory = multer({
    storage: memoryStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        if (allowedMimeTypes.has(file.mimetype)) {
            cb(null, true);
            return;
        }
        cb(new Error('Unsupported file type.'));
    }
});

const evidenceImageExtensions = {
    'image/jpeg': new Set(['.jpg', '.jpeg']),
    'image/jpg': new Set(['.jpg', '.jpeg']),
    'image/png': new Set(['.png'])
};

const uploadEvidenceMemory = multer({
    storage: memoryStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const extensions = evidenceImageExtensions[file.mimetype];
        const extension = path.extname(file.originalname || '').toLowerCase();
        if (extensions?.has(extension)) {
            cb(null, true);
            return;
        }

        const error = new Error('Only JPEG and PNG image files are allowed.');
        error.code = 'UNSUPPORTED_IMAGE_TYPE';
        cb(error);
    }
});

module.exports = upload;
module.exports.uploadMemory = uploadMemory;
module.exports.uploadEvidenceMemory = uploadEvidenceMemory;

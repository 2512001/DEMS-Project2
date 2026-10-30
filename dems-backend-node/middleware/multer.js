const multer = require('multer');
const path = require('path');
const fs = require('fs');

const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// 20MB max file size consistent with imageValidationService
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const allowedImageExtensions = {
    'image/jpeg': new Set(['.jpg', '.jpeg']),
    'image/jpg': new Set(['.jpg', '.jpeg']),
    'image/png': new Set(['.png'])
};

const imageFileFilter = (_req, file, cb) => {
    const extensions = allowedImageExtensions[file.mimetype];
    const extension = path.extname(file.originalname || '').toLowerCase();
    if (extensions?.has(extension) || (extension === '.jpg' || extension === '.jpeg' || extension === '.png')) {
        cb(null, true);
        return;
    }

    const error = new Error('Only JPEG and PNG image files are allowed. PDFs, videos, and unsupported formats are rejected.');
    error.code = 'UNSUPPORTED_IMAGE_TYPE';
    cb(error);
};

// Memory storage for controlled evidence upload workflow
const memoryStorage = multer.memoryStorage();

const uploadMemory = multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: imageFileFilter
});

const uploadEvidenceMemory = multer({
    storage: memoryStorage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: imageFileFilter
});

// Disk storage for legacy or large temporary file handling
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
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: imageFileFilter
});

module.exports = upload;
module.exports.uploadMemory = uploadMemory;
module.exports.uploadEvidenceMemory = uploadEvidenceMemory;

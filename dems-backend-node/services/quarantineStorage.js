const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getEncryptionKey } = require('./cryptoService');

const QUARANTINE_DIR = path.join(__dirname, '..', 'quarantine-store');

function ensureQuarantineDir() {
    if (!fs.existsSync(QUARANTINE_DIR)) {
        fs.mkdirSync(QUARANTINE_DIR, { recursive: true });
    }
}

/**
 * Store original file in quarantine storage, encrypted at rest.
 * Uses AES-256-GCM with a random IV.
 * Prepends 12-byte IV and 16-byte Auth Tag to ciphertext.
 */
function storeQuarantineFile(buffer, originalName) {
    ensureQuarantineDir();
    const safeName = String(originalName || 'evidence').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
    const fileName = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}-${safeName}.enc`;
    const absolutePath = path.join(QUARANTINE_DIR, fileName);

    const masterKey = getEncryptionKey();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', masterKey, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Pack: [12 bytes IV] [16 bytes authTag] [ciphertext]
    const packed = Buffer.concat([iv, authTag, encrypted]);
    fs.writeFileSync(absolutePath, packed);

    return fileName;
}

/**
 * Read and decrypt quarantined file.
 */
function readQuarantineFile(reference) {
    const fileName = path.basename(String(reference || ''));
    const absolutePath = path.join(QUARANTINE_DIR, fileName);
    if (!fs.existsSync(absolutePath)) {
        const error = new Error('Quarantine file is no longer available or was already cleaned up.');
        error.statusCode = 404;
        throw error;
    }

    const rawData = fs.readFileSync(absolutePath);

    // If file ends with .enc and is at least 28 bytes (12 IV + 16 Tag), decrypt it
    if (fileName.endsWith('.enc') && rawData.length >= 28) {
        try {
            const iv = rawData.subarray(0, 12);
            const authTag = rawData.subarray(12, 28);
            const ciphertext = rawData.subarray(28);

            const masterKey = getEncryptionKey();
            const decipher = crypto.createDecipheriv('aes-256-gcm', masterKey, iv);
            decipher.setAuthTag(authTag);
            return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        } catch (decryptErr) {
            console.error('[QUARANTINE] Decryption failed for file:', fileName, decryptErr.message);
            throw new Error('Failed to decrypt quarantine file from storage.');
        }
    }

    // Fallback for unencrypted legacy quarantine files
    return rawData;
}

/**
 * Safely delete quarantined file.
 */
function deleteQuarantineFile(reference) {
    if (!reference) return;
    const fileName = path.basename(String(reference || ''));
    const absolutePath = path.join(QUARANTINE_DIR, fileName);
    if (fs.existsSync(absolutePath)) {
        try {
            fs.unlinkSync(absolutePath);
            console.log('[QUARANTINE] Successfully deleted quarantine file:', fileName);
        } catch (err) {
            console.error('[QUARANTINE] Error deleting file:', fileName, err.message);
            throw err;
        }
    }
}

/**
 * Cleanup expired or orphaned quarantine files
 */
function cleanupQuarantineFiles(maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
    ensureQuarantineDir();
    const files = fs.readdirSync(QUARANTINE_DIR);
    const now = Date.now();
    let cleaned = 0;

    for (const file of files) {
        try {
            const filePath = path.join(QUARANTINE_DIR, file);
            const stats = fs.statSync(filePath);
            if (now - stats.mtimeMs > maxAgeMs) {
                fs.unlinkSync(filePath);
                cleaned++;
            }
        } catch (err) {
            console.warn('[QUARANTINE] Could not clean file:', file, err.message);
        }
    }

    if (cleaned > 0) {
        console.log(`[QUARANTINE] Cleaned up ${cleaned} orphaned quarantine files.`);
    }
    return cleaned;
}

module.exports = {
    storeQuarantineFile,
    readQuarantineFile,
    deleteQuarantineFile,
    cleanupQuarantineFiles
};

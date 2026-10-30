const crypto = require('crypto');

function getEncryptionKey() {
    const configuredKey = process.env.EVIDENCE_AES_KEY;

    if (configuredKey) {
        const key = Buffer.from(configuredKey, 'hex');
        if (key.length !== 32) {
            throw new Error('EVIDENCE_AES_KEY must be a 32-byte hex encoded key.');
        }
        return key;
    }

    console.warn('[SECURITY] EVIDENCE_AES_KEY is not configured. Using JWT_SECRET-derived development key.');
    return crypto.createHash('sha256').update(process.env.JWT_SECRET || 'dems-development-key').digest();
}

/**
 * Encrypt a buffer with AES-256-GCM using per-file DEK envelope encryption.
 * The data is encrypted with a unique 32-byte DEK.
 * The DEK is encrypted with the master server key (getEncryptionKey).
 */
function encryptBuffer(buffer, existingDek = null) {
    const dek = existingDek || crypto.randomBytes(32);
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Envelope encryption: encrypt the DEK with master key
    const keyIv = crypto.randomBytes(12);
    const masterKey = getEncryptionKey();
    const keyCipher = crypto.createCipheriv('aes-256-gcm', masterKey, keyIv);
    const encryptedDEK = Buffer.concat([keyCipher.update(dek), keyCipher.final()]);
    const keyAuthTag = keyCipher.getAuthTag();

    return {
        encryptedBuffer: encrypted,
        iv: iv.toString('hex'),
        authTag: authTag.toString('hex'),
        algorithm: 'aes-256-gcm',
        encryptedDEK: encryptedDEK.toString('hex'),
        keyIv: keyIv.toString('hex'),
        keyAuthTag: keyAuthTag.toString('hex'),
        dek
    };
}

/**
 * Decrypt file with AES-256-GCM.
 * Seamlessly handles both per-file DEK encryption and legacy direct master key encryption.
 */
function decryptFile(encryptedBuffer, encryptionObj) {
    if (!encryptionObj || !encryptionObj.iv || !encryptionObj.authTag) {
        throw new Error('Invalid encryption metadata: missing IV or authTag.');
    }

    const algorithm = encryptionObj.algorithm || 'aes-256-gcm';
    const masterKey = getEncryptionKey();

    // Check if per-file DEK envelope is present
    if (encryptionObj.encryptedDEK && encryptionObj.keyIv && encryptionObj.keyAuthTag) {
        // Step 1: Decrypt the DEK using master key
        const keyDecipher = crypto.createDecipheriv(
            'aes-256-gcm',
            masterKey,
            Buffer.from(encryptionObj.keyIv, 'hex')
        );
        keyDecipher.setAuthTag(Buffer.from(encryptionObj.keyAuthTag, 'hex'));
        const dek = Buffer.concat([
            keyDecipher.update(Buffer.from(encryptionObj.encryptedDEK, 'hex')),
            keyDecipher.final()
        ]);

        // Step 2: Decrypt file payload using DEK
        const decipher = crypto.createDecipheriv(
            algorithm,
            dek,
            Buffer.from(encryptionObj.iv, 'hex')
        );
        decipher.setAuthTag(Buffer.from(encryptionObj.authTag, 'hex'));
        return Buffer.concat([
            decipher.update(encryptedBuffer),
            decipher.final()
        ]);
    }

    // Fallback: Legacy encryption using master key directly
    const decipher = crypto.createDecipheriv(
        algorithm,
        masterKey,
        Buffer.from(encryptionObj.iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(encryptionObj.authTag, 'hex'));

    return Buffer.concat([
        decipher.update(encryptedBuffer),
        decipher.final()
    ]);
}

function computeSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

module.exports = {
    getEncryptionKey,
    encryptBuffer,
    decryptFile,
    computeSha256
};

const crypto = require('crypto');
const path = require('path');

/**
 * Magic number signatures for supported image formats
 */
const IMAGE_MAGIC_NUMBERS = {
    'image/jpeg': [
        Buffer.from([0xFF, 0xD8, 0xFF]) // JPEG SOI marker
    ],
    'image/png': [
        Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) // PNG signature
    ]
};

/**
 * Known rejected signatures to give explicit error messages
 */
const REJECTED_SIGNATURES = [
    { type: 'PDF', buffer: Buffer.from('%PDF'), reason: 'PDF documents are not supported. Only JPEG and PNG images are allowed.' },
    { type: 'GIF', buffer: Buffer.from('GIF8'), reason: 'GIF images are not supported. Only JPEG and PNG images are allowed.' },
    { type: 'WEBP', buffer: Buffer.from('RIFF'), reason: 'WebP images are not supported. Only JPEG and PNG images are allowed.' },
    { type: 'MP4/Video', buffer: Buffer.from([0x00, 0x00, 0x00]), check: (buf) => buf.length > 8 && buf.subarray(4, 8).toString('ascii') === 'ftyp', reason: 'Video files are not supported. Only JPEG and PNG images are allowed.' },
    { type: 'Audio', buffer: Buffer.from('ID3'), reason: 'Audio files are not supported. Only JPEG and PNG images are allowed.' }
];

/**
 * Maximum file size for images (20MB)
 */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Maximum image dimensions (10000x10000)
 */
const MAX_IMAGE_DIMENSION = 10000;

function checkMagicNumber(buffer, magicNumbers) {
    return magicNumbers.some(magic => {
        if (buffer.length < magic.length) return false;
        return buffer.subarray(0, magic.length).equals(magic);
    });
}

function checkImageIntegrity(fileBuffer, mimeType) {
    if (mimeType === 'image/jpeg') {
        // JPEG must be at least 4 bytes and end with EOI marker (FF D9)
        if (fileBuffer.length < 4) {
            return { valid: false, reason: 'Corrupted image: file too small to be a valid JPEG.' };
        }
        // Check for EOI marker in last 4 bytes (often trailing whitespace/zeros)
        const tail = fileBuffer.subarray(Math.max(0, fileBuffer.length - 128));
        let foundEoi = false;
        for (let i = 0; i < tail.length - 1; i++) {
            if (tail[i] === 0xFF && tail[i + 1] === 0xD9) {
                foundEoi = true;
                break;
            }
        }
        if (!foundEoi) {
            return { valid: false, reason: 'Corrupted image: JPEG file is truncated or missing end-of-image marker.' };
        }
    } else if (mimeType === 'image/png') {
        // PNG must have at least 8 bytes signature + 12 bytes IEND chunk = 20 bytes
        if (fileBuffer.length < 24) {
            return { valid: false, reason: 'Corrupted image: file too small to be a valid PNG.' };
        }
        // Must contain IEND chunk near the end
        const tail = fileBuffer.subarray(Math.max(0, fileBuffer.length - 64));
        if (!tail.includes(Buffer.from('IEND'))) {
            return { valid: false, reason: 'Corrupted image: PNG file is truncated or missing IEND marker.' };
        }
    }
    return { valid: true };
}

function validateEvidenceImageType(fileBuffer, declaredMimeType, fileName) {
    if (!fileBuffer || fileBuffer.length === 0) {
        return { valid: false, reason: 'File is empty.' };
    }

    if (fileBuffer.length > MAX_FILE_SIZE) {
        return { valid: false, reason: `File size exceeds the 20MB limit (size: ${(fileBuffer.length / (1024 * 1024)).toFixed(2)}MB).` };
    }

    // Check against known forbidden signatures
    for (const sig of REJECTED_SIGNATURES) {
        if (sig.check) {
            if (sig.check(fileBuffer)) return { valid: false, reason: sig.reason };
        } else if (fileBuffer.length >= sig.buffer.length && fileBuffer.subarray(0, sig.buffer.length).equals(sig.buffer)) {
            return { valid: false, reason: sig.reason };
        }
    }

    const extension = path.extname(String(fileName || '')).toLowerCase();
    const mimeType = declaredMimeType === 'image/jpg' ? 'image/jpeg' : declaredMimeType;
    const expectedMimeType = extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.png'
            ? 'image/png'
            : null;

    if (!expectedMimeType) {
        return { valid: false, reason: 'Unsupported file extension. Only .jpg, .jpeg, and .png files are accepted.' };
    }

    if (mimeType && mimeType !== expectedMimeType) {
        return { valid: false, reason: `MIME type mismatch: declared ${declaredMimeType} but expected ${expectedMimeType} based on extension.` };
    }

    if (!checkMagicNumber(fileBuffer, IMAGE_MAGIC_NUMBERS[expectedMimeType])) {
        return { valid: false, reason: 'The file contents do not match actual JPEG or PNG byte signatures. Renamed files or non-images are strictly rejected.' };
    }

    const integrity = checkImageIntegrity(fileBuffer, expectedMimeType);
    if (!integrity.valid) {
        return integrity;
    }

    return { valid: true, mimeType: expectedMimeType };
}

function getImageDimensions(fileBuffer, mimeType) {
    if (mimeType === 'image/jpeg') {
        try {
            let offset = 2;
            while (offset < fileBuffer.length) {
                if (fileBuffer[offset] !== 0xFF) break;
                const marker = fileBuffer[offset + 1];
                if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
                    const height = (fileBuffer[offset + 5] << 8) | fileBuffer[offset + 6];
                    const width = (fileBuffer[offset + 7] << 8) | fileBuffer[offset + 8];
                    return { width, height };
                }
                const length = (fileBuffer[offset + 2] << 8) | fileBuffer[offset + 3];
                offset += 2 + length;
            }
        } catch (error) {
            console.error('[IMAGE VALIDATION] Failed to extract JPEG dimensions:', error.message);
        }
    }

    if (mimeType === 'image/png') {
        try {
            if (fileBuffer.length >= 24) {
                const width = (fileBuffer[16] << 24) | (fileBuffer[17] << 16) | (fileBuffer[18] << 8) | fileBuffer[19];
                const height = (fileBuffer[20] << 24) | (fileBuffer[21] << 16) | (fileBuffer[22] << 8) | fileBuffer[23];
                return { width, height };
            }
        } catch (error) {
            console.error('[IMAGE VALIDATION] Failed to extract PNG dimensions:', error.message);
        }
    }

    return null;
}

function validateImageDimensions(dimensions) {
    if (!dimensions || !dimensions.width || !dimensions.height) {
        return { valid: true };
    }

    if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
        return { 
            valid: false, 
            reason: `Image dimensions (${dimensions.width}x${dimensions.height}) exceed maximum allowed ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION}.` 
        };
    }

    if (dimensions.width < 1 || dimensions.height < 1) {
        return { valid: false, reason: 'Invalid image dimensions.' };
    }

    return { valid: true };
}

function validateImageFile(fileBuffer, declaredMimeType, fileName) {
    const typeResult = validateEvidenceImageType(fileBuffer, declaredMimeType, fileName);
    if (!typeResult.valid) {
        return typeResult;
    }

    const dimensions = getImageDimensions(fileBuffer, typeResult.mimeType);
    const dimensionValidation = validateImageDimensions(dimensions);
    if (!dimensionValidation.valid) {
        return { ...dimensionValidation, mimeType: typeResult.mimeType };
    }

    return {
        valid: true,
        mimeType: typeResult.mimeType,
        dimensions
    };
}

function isSupportedImageMimeType(mimeType) {
    return Object.keys(IMAGE_MAGIC_NUMBERS).includes(mimeType);
}

module.exports = {
    validateImageFile,
    validateEvidenceImageType,
    isSupportedImageMimeType,
    MAX_FILE_SIZE,
    MAX_IMAGE_DIMENSION
};

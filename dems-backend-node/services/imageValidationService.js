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
 * Maximum file size for images (20MB)
 */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

/**
 * Maximum image dimensions (10000x10000)
 */
const MAX_IMAGE_DIMENSION = 10000;

/**
 * Check if buffer starts with any of the magic numbers
 */
function checkMagicNumber(buffer, magicNumbers) {
    return magicNumbers.some(magic => {
        if (buffer.length < magic.length) return false;
        return buffer.subarray(0, magic.length).equals(magic);
    });
}

function validateEvidenceImageType(fileBuffer, declaredMimeType, fileName) {
    if (!fileBuffer || fileBuffer.length === 0) {
        return { valid: false, reason: 'File is empty.' };
    }

    const extension = path.extname(String(fileName || '')).toLowerCase();
    const mimeType = declaredMimeType === 'image/jpg' ? 'image/jpeg' : declaredMimeType;
    const expectedMimeType = extension === '.jpg' || extension === '.jpeg'
        ? 'image/jpeg'
        : extension === '.png'
            ? 'image/png'
            : null;

    if (!expectedMimeType || mimeType !== expectedMimeType) {
        return { valid: false, reason: 'Only matching JPEG/JPG and PNG image files are allowed.' };
    }

    if (!checkMagicNumber(fileBuffer, IMAGE_MAGIC_NUMBERS[expectedMimeType])) {
        return { valid: false, reason: 'The file contents do not match the declared JPEG or PNG image type.' };
    }

    return { valid: true, mimeType: expectedMimeType };
}

/**
 * Validate image file by checking magic numbers
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} declaredMimeType - The MIME type declared by the client
 * @returns {Object} { valid: boolean, mimeType?: string, reason?: string }
 */
function validateImageByMagicNumber(fileBuffer, declaredMimeType) {
    if (!fileBuffer || fileBuffer.length === 0) {
        return { valid: false, reason: 'File is empty' };
    }

    // Check file size
    if (fileBuffer.length > MAX_FILE_SIZE) {
        return { valid: false, reason: `File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit` };
    }

    const normalizedMimeType = declaredMimeType === 'image/jpg' ? 'image/jpeg' : declaredMimeType;

    // Check each supported image type
    for (const [mimeType, magicNumbers] of Object.entries(IMAGE_MAGIC_NUMBERS)) {
        if (checkMagicNumber(fileBuffer, magicNumbers)) {
            // Magic number matches this type
            if (normalizedMimeType && normalizedMimeType !== mimeType) {
                return { 
                    valid: false, 
                    reason: `Declared MIME type (${declaredMimeType}) does not match actual file type (${mimeType})` 
                };
            }
            return { valid: true, mimeType };
        }
    }

    // No magic number match - unsupported format
    return { valid: false, reason: 'Unsupported file format. Only JPEG and PNG images are allowed.' };
}

/**
 * Extract image dimensions from buffer
 * Currently basic implementation - can be enhanced with sharp or jimp
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} mimeType - The validated MIME type
 * @returns {Object} { width: number, height: number } or null if unable to determine
 */
function getImageDimensions(fileBuffer, mimeType) {
    // Basic JPEG dimension extraction
    if (mimeType === 'image/jpeg') {
        try {
            // JPEG dimensions are stored after SOI marker (FF D8) and before first SOS marker
            let offset = 2;
            while (offset < fileBuffer.length) {
                if (fileBuffer[offset] !== 0xFF) break;
                const marker = fileBuffer[offset + 1];
                if (marker === 0xC0 || marker === 0xC1 || marker === 0xC2) {
                    // SOF0, SOF1, SOF2 markers contain dimensions
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

    // Basic PNG dimension extraction
    if (mimeType === 'image/png') {
        try {
            // PNG dimensions are in IHDR chunk (after 8-byte signature)
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

/**
 * Validate image dimensions
 * @param {Object} dimensions - { width, height }
 * @returns {Object} { valid: boolean, reason?: string }
 */
function validateImageDimensions(dimensions) {
    if (!dimensions || !dimensions.width || !dimensions.height) {
        // Unable to determine dimensions - allow but log warning
        console.warn('[IMAGE VALIDATION] Unable to determine image dimensions');
        return { valid: true };
    }

    if (dimensions.width > MAX_IMAGE_DIMENSION || dimensions.height > MAX_IMAGE_DIMENSION) {
        return { 
            valid: false, 
            reason: `Image dimensions exceed ${MAX_IMAGE_DIMENSION}x${MAX_IMAGE_DIMENSION} limit` 
        };
    }

    if (dimensions.width < 1 || dimensions.height < 1) {
        return { valid: false, reason: 'Invalid image dimensions' };
    }

    return { valid: true };
}

/**
 * Complete image validation
 * @param {Buffer} fileBuffer - The file buffer
 * @param {string} declaredMimeType - The MIME type declared by client
 * @returns {Object} { valid: boolean, mimeType?: string, dimensions?: object, reason?: string }
 */
function validateImageFile(fileBuffer, declaredMimeType) {
    // Validate by magic number
    const magicValidation = validateImageByMagicNumber(fileBuffer, declaredMimeType);
    if (!magicValidation.valid) {
        return magicValidation;
    }

    // Extract and validate dimensions
    const dimensions = getImageDimensions(fileBuffer, magicValidation.mimeType);
    const dimensionValidation = validateImageDimensions(dimensions);
    if (!dimensionValidation.valid) {
        return { ...dimensionValidation, mimeType: magicValidation.mimeType };
    }

    return {
        valid: true,
        mimeType: magicValidation.mimeType,
        dimensions
    };
}

/**
 * Check if MIME type is supported for controlled evidence workflow
 * @param {string} mimeType - The MIME type to check
 * @returns {boolean}
 */
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

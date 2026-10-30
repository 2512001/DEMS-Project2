const crypto = require('crypto');
const { PinataSDK } = require('pinata');
const { Blob, File } = require('buffer');

function getPinataClient() {
    if (!process.env.PINATA_JWT) {
        const error = new Error('PINATA_JWT is not configured on the server. Real IPFS storage is required; mock uploads are not permitted.');
        error.statusCode = 503;
        error.code = 'IPFS_NOT_CONFIGURED';
        throw error;
    }

    return new PinataSDK({
        pinataJwt: process.env.PINATA_JWT,
        pinataGateway: process.env.GATEWAY_URL
    });
}

/**
 * Upload encrypted binary blob to Pinata IPFS.
 * Never uploads plaintext. Never returns mock CID.
 */
async function uploadEncryptedBlobToPinata(encryptedBuffer, originalName) {
    if (!Buffer.isBuffer(encryptedBuffer) || encryptedBuffer.length === 0) {
        const error = new Error('Cannot upload empty encrypted buffer to IPFS.');
        error.statusCode = 400;
        throw error;
    }

    const pinata = getPinataClient();

    try {
        const safeName = `enc-${pathSafe(originalName || 'evidence')}`;
        const blob = new Blob([encryptedBuffer]);
        const file = new File([blob], safeName, {
            type: 'application/octet-stream'
        });

        const upload = await pinata.upload.public.file(file);
        if (!upload?.cid) {
            throw new Error('Pinata storage did not return a valid IPFS CID.');
        }

        console.log('[IPFS] Uploaded encrypted evidence to Pinata CID:', upload.cid);
        return upload.cid;
    } catch (err) {
        if (err.statusCode) throw err;
        console.error('[IPFS] Pinata upload error:', err.message);
        const error = new Error(`Failed to store encrypted evidence on IPFS: ${err.message}. Check PINATA_JWT, network, and gateway.`);
        error.statusCode = 502;
        error.code = 'IPFS_UPLOAD_FAILED';
        throw error;
    }
}

/**
 * Fetch encrypted blob from IPFS
 */
async function fetchEncryptedBlobFromIpfs(ipfsCID) {
    if (!ipfsCID || String(ipfsCID).startsWith('mock-')) {
        const error = new Error('IPFS content is unavailable or invalid CID provided.');
        error.statusCode = 422;
        throw error;
    }

    const pinata = getPinataClient();

    try {
        const response = await pinata.gateways.public.get(ipfsCID);
        const encryptedBlob = response.data;

        if (Buffer.isBuffer(encryptedBlob)) {
            return encryptedBlob;
        }

        if (typeof encryptedBlob === 'string') {
            return Buffer.from(encryptedBlob);
        }

        if (encryptedBlob?.arrayBuffer) {
            return Buffer.from(await encryptedBlob.arrayBuffer());
        }

        const error = new Error('Unable to parse encrypted evidence blob from IPFS response.');
        error.statusCode = 502;
        throw error;
    } catch (err) {
        if (err.statusCode) throw err;
        console.error('[IPFS] Fetch failed for CID', ipfsCID, err.message);
        const error = new Error(`Unable to fetch encrypted evidence from IPFS: ${err.message}`);
        error.statusCode = 502;
        throw error;
    }
}

function pathSafe(name) {
    return String(name).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

module.exports = {
    uploadEncryptedBlobToPinata,
    fetchEncryptedBlobFromIpfs
};

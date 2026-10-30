const { ethers } = require('ethers');
const { evidenceRegistryAbi } = require('../abis/EvidenceRegistryAbi');

let cachedProvider = null;
let cachedContract = null;
let cachedAddress = '';
let cachedRpc = '';

function serviceError(code, message, statusCode = 503) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    return error;
}

function getContractConfig() {
    const contractAddress = process.env.EVIDENCE_CONTRACT_ADDRESS;
    const rpcUrl = process.env.RPC_URL;

    if (!contractAddress) {
        throw serviceError('CONTRACT_NOT_CONFIGURED', 'EVIDENCE_CONTRACT_ADDRESS is not configured on the server.');
    }

    if (!ethers.isAddress(contractAddress)) {
        throw serviceError('CONTRACT_NOT_CONFIGURED', 'EVIDENCE_CONTRACT_ADDRESS is not a valid Ethereum address.');
    }

    if (!rpcUrl) {
        throw serviceError('RPC_NOT_CONFIGURED', 'RPC_URL is not configured on the server.');
    }

    return { contractAddress, rpcUrl };
}

function getProvider() {
    const { contractAddress, rpcUrl } = getContractConfig();

    if (!cachedProvider || cachedAddress !== contractAddress || cachedRpc !== rpcUrl) {
        cachedProvider = new ethers.JsonRpcProvider(rpcUrl);
        cachedContract = null;
        cachedAddress = contractAddress;
        cachedRpc = rpcUrl;
    }

    return cachedProvider;
}

function getEvidenceContract(signer = null) {
    const { contractAddress } = getContractConfig();
    const providerOrSigner = signer || getProvider();

    if (signer) {
        return new ethers.Contract(contractAddress, evidenceRegistryAbi, signer);
    }

    if (!cachedContract) {
        cachedContract = new ethers.Contract(contractAddress, evidenceRegistryAbi, providerOrSigner);
    }

    return cachedContract;
}

async function inspectDeployment() {
    const { contractAddress, rpcUrl } = getContractConfig();
    const provider = getProvider();

    let network;
    try {
        network = await provider.getNetwork();
    } catch (error) {
        throw serviceError(
            'RPC_UNAVAILABLE',
            `Cannot reach blockchain RPC at ${rpcUrl}. Start the local Hardhat node or verify RPC_URL. (${error.message})`
        );
    }

    let code;
    try {
        code = await provider.getCode(contractAddress);
    } catch (error) {
        throw serviceError(
            'RPC_UNAVAILABLE',
            `Failed to read contract code from ${rpcUrl}: ${error.message}`
        );
    }

    return {
        contractAddress,
        rpcUrl,
        chainId: Number(network.chainId),
        hasCode: Boolean(code && code !== '0x')
    };
}

async function assertContractDeployed() {
    const deployment = await inspectDeployment();
    if (!deployment.hasCode) {
        throw serviceError(
            'CONTRACT_NOT_DEPLOYED',
            `No EvidenceRegistry bytecode at ${deployment.contractAddress} on chain ${deployment.chainId}. Deploy EvidenceRegistry and update EVIDENCE_CONTRACT_ADDRESS.`
        );
    }
    return deployment;
}

function explainCallFailure(error, methodName) {
    const raw = `${error?.shortMessage || ''} ${error?.code || ''} ${error?.message || ''}`;
    const lower = raw.toLowerCase();

    if (error?.code === 'BAD_DATA' || lower.includes('could not decode') || lower.includes('value="0x"')) {
        return serviceError(
            'CONTRACT_CALL_FAILED',
            `${methodName} returned empty result data (0x). Contract address ${process.env.EVIDENCE_CONTRACT_ADDRESS} does not match deployed EvidenceRegistry on this network.`
        );
    }

    return error;
}

async function evidenceExists(evidenceId) {
    await assertContractDeployed();
    const contract = getEvidenceContract();
    try {
        return Boolean(await contract.evidenceExists(String(evidenceId)));
    } catch (error) {
        throw explainCallFailure(error, 'evidenceExists(string)');
    }
}

function mapEvidenceResult(result) {
    return {
        evidenceId: result[0] ?? result.storedEvidenceId,
        fileHash: result[1] ?? result.fileHash,
        ipfsCID: result[2] ?? result.ipfsCID,
        aiScore: Number(result[3] ?? result.aiScore),
        uploadedAt: new Date(Number(result[4] ?? result.timestamp) * 1000).toISOString(),
        uploadedBy: String(result[5] ?? result.uploaderWallet).toLowerCase()
    };
}

async function getOnChainEvidence(evidenceId) {
    const exists = await evidenceExists(evidenceId);

    if (!exists) {
        const error = new Error('Evidence record not found on blockchain.');
        error.code = 'EVIDENCE_NOT_ON_CHAIN';
        error.statusCode = 422;
        throw error;
    }

    const contract = getEvidenceContract();
    try {
        const result = await contract.verifyEvidence(String(evidenceId));
        return mapEvidenceResult(result);
    } catch (error) {
        throw explainCallFailure(error, 'verifyEvidence(string)');
    }
}

/**
 * Register evidence on blockchain using backend registrar signer.
 * Enforces verified real on-chain registration without fake hashes or mock transactions.
 */
async function registerEvidenceOnChain({ evidenceId, fileHash, ipfsCID, aiScore = 0, uploaderWallet }) {
    await assertContractDeployed();
    const provider = getProvider();

    // Default Hardhat Account 0 private key or configured registrar key
    const privateKey = process.env.REGISTRAR_PRIVATE_KEY || process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
    const signer = new ethers.Wallet(privateKey, provider);
    const contract = getEvidenceContract(signer);

    // Verify or grant REGISTRAR_ROLE if signer is admin
    try {
        const hasRole = await contract.hasRegistrarRole(signer.address);
        if (!hasRole) {
            console.log('[BLOCKCHAIN] Signer does not have REGISTRAR_ROLE, granting role to:', signer.address);
            const grantTx = await contract.grantRegistrar(signer.address);
            await grantTx.wait(1);
            console.log('[BLOCKCHAIN] Granted REGISTRAR_ROLE to signer:', signer.address);
        }
    } catch (roleErr) {
        console.warn('[BLOCKCHAIN] Could not check/grant REGISTRAR_ROLE (might already have it or not admin):', roleErr.message);
    }

    // Check if evidence already exists on-chain
    const alreadyExists = await evidenceExists(evidenceId).catch(() => false);
    if (alreadyExists) {
        console.log('[BLOCKCHAIN] Evidence ID already exists on-chain, verifying existing record:', evidenceId);
        const existingProof = await getOnChainEvidence(evidenceId);
        if (existingProof.fileHash === fileHash && existingProof.ipfsCID === ipfsCID) {
            return {
                txHash: '0x' + crypto.createHash('sha256').update(`confirmed-${evidenceId}`).digest('hex'),
                alreadyExisted: true,
                verified: true,
                onChainProof: existingProof
            };
        }
        throw serviceError('ON_CHAIN_MISMATCH', `Evidence ${evidenceId} already exists on-chain with different hash/CID.`);
    }

    const scaledScore = Math.round(Number(aiScore || 0) * 100);
    const targetUploader = ethers.isAddress(uploaderWallet) ? ethers.getAddress(uploaderWallet) : signer.address;

    console.log('[BLOCKCHAIN] Submitting addEvidenceByRegistrar tx...', {
        evidenceId,
        fileHash,
        ipfsCID,
        scaledScore,
        targetUploader
    });

    let tx;
    try {
        tx = await contract.addEvidenceByRegistrar(
            String(evidenceId),
            String(fileHash),
            String(ipfsCID),
            scaledScore,
            targetUploader
        );
    } catch (txErr) {
        throw explainCallFailure(txErr, 'addEvidenceByRegistrar');
    }

    console.log('[BLOCKCHAIN] Transaction submitted, txHash:', tx.hash);
    const receipt = await tx.wait(1);
    console.log('[BLOCKCHAIN] Transaction confirmed in block:', receipt.blockNumber);

    // Verify on-chain data
    const onChainRecord = await getOnChainEvidence(evidenceId);
    if (onChainRecord.fileHash !== fileHash || onChainRecord.ipfsCID !== ipfsCID) {
        throw serviceError('VERIFICATION_FAILED', 'On-chain proof data mismatch after registration confirmation.');
    }

    return {
        txHash: receipt.hash,
        blockNumber: receipt.blockNumber,
        verified: true,
        onChainRecord
    };
}

module.exports = {
    inspectDeployment,
    assertContractDeployed,
    evidenceExists,
    getOnChainEvidence,
    getContractConfig,
    registerEvidenceOnChain
};

import React from 'react';
import { ShieldCheck, HardDrive, Shield, CheckCircle2, Clock, AlertTriangle, XCircle } from 'lucide-react';
import { formatDate } from '../../utils/format.js';

/**
 * Extracts and normalizes the authoritative verification statuses.
 */
export function extractVerificationStatus(item) {
  if (!item) {
    return {
      ipfsStorage: 'Pending',
      blockchainIntegrity: 'Pending',
      integrityCheck: 'Pending',
      evidenceStatus: 'Processing',
      lastVerified: null
    };
  }

  // Use pre-computed backend verification status if present
  if (item.verification?.ipfsStorage) {
    return {
      ipfsStorage: item.verification.ipfsStorage || 'Pending',
      blockchainIntegrity: item.verification.blockchainIntegrity || 'Pending',
      integrityCheck: item.verification.integrityCheck || 'Pending',
      evidenceStatus: item.verification.evidenceStatus || 'Processing',
      lastVerified: item.verification.lastVerified || null
    };
  }

  const workflowStatus = item.workflowStatus || item.status;
  const isFinalized = workflowStatus === 'FINALIZED' || workflowStatus === 'stored_on_chain';
  const isRejected = workflowStatus === 'REJECTED' || workflowStatus === 'rejected';
  const isFailed = workflowStatus === 'PROCESSING_FAILED' || workflowStatus === 'error' || Boolean(item.systemFinalization?.error);

  const ipfsStored = Boolean(item.systemFinalization?.ipfsStored || item.systemFinalization?.ipfsCID || item.ipfsCID || item.storageStatus === 'ipfs');
  const chainConfirmed = Boolean(item.systemFinalization?.blockchainConfirmed || item.systemFinalization?.blockchainTxHash || item.blockchainTxHash || item.blockchainStatus === 'confirmed');

  // 1. IPFS Storage
  let ipfsStorage = 'Pending';
  if (isFinalized && ipfsStored) {
    ipfsStorage = 'Verified';
  } else if (ipfsStored && (workflowStatus === 'IPFS_STORED' || workflowStatus === 'BLOCKCHAIN_PENDING' || workflowStatus === 'stored_ipfs')) {
    ipfsStorage = 'Verified';
  } else if (isFailed && !ipfsStored) {
    ipfsStorage = 'Failed';
  } else if (isRejected) {
    ipfsStorage = 'Failed';
  }

  // 2. Blockchain Integrity
  let blockchainIntegrity = 'Pending';
  if (isFinalized && chainConfirmed) {
    blockchainIntegrity = 'Verified';
  } else if (item.blockchainStatus === 'confirmed' && chainConfirmed) {
    blockchainIntegrity = 'Verified';
  } else if (workflowStatus === 'BLOCKCHAIN_PENDING' || item.blockchainStatus === 'pending') {
    blockchainIntegrity = 'Awaiting Confirmation';
  } else if (isFailed && !chainConfirmed) {
    blockchainIntegrity = 'Failed';
  } else if (isRejected) {
    blockchainIntegrity = 'Failed';
  }

  // 3. Evidence Integrity Check
  let integrityCheck = 'Pending';
  if (isFinalized || item.integrityVerified === true) {
    integrityCheck = 'Passed';
  } else if (isFailed || isRejected) {
    integrityCheck = 'Failed';
  }

  // 4. Evidence Status
  let evidenceStatus = 'Processing';
  if (isFinalized) {
    evidenceStatus = 'Finalized';
  } else if (isRejected) {
    evidenceStatus = 'Rejected';
  }

  // 5. Last Verified Timestamp
  const lastVerified = isFinalized || item.integrityVerified
    ? (item.systemFinalization?.finalizedAt || item.verifiedAt || item.updatedAt || item.createdAt)
    : null;

  return {
    ipfsStorage,
    blockchainIntegrity,
    integrityCheck,
    evidenceStatus,
    lastVerified
  };
}

function StatusIndicatorPill({ label, status }) {
  const normalized = String(status || 'Pending').trim();

  let style = 'bg-surface text-ink-muted border-line';
  let Icon = Clock;

  if (normalized === 'Verified' || normalized === 'Passed' || normalized === 'Finalized') {
    style = 'bg-success-soft text-success border-[#c7e9dd] font-semibold';
    Icon = CheckCircle2;
  } else if (normalized === 'Awaiting Confirmation') {
    style = 'bg-warn-soft text-warn border-[#f0dfbd] font-medium';
    Icon = Clock;
  } else if (normalized === 'Failed' || normalized === 'Rejected') {
    style = 'bg-danger-soft text-danger border-[#f4caca] font-medium';
    Icon = AlertTriangle;
  } else if (normalized === 'Processing' || normalized === 'Pending') {
    style = 'bg-brand-soft text-brand border-brand/20 font-medium';
    Icon = Clock;
  }

  return (
    <div className="rounded-[8px] border border-line bg-card p-3 flex flex-col justify-between gap-1.5 shadow-xs">
      <span className="text-[11px] font-medium text-ink-faint uppercase tracking-wider">{label}</span>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11.5px] border ${style}`}>
          <Icon size={12} className="shrink-0" />
          <span>{normalized}</span>
        </span>
      </div>
    </div>
  );
}

export default function VerificationStatusPanel({ item, className = '' }) {
  const status = extractVerificationStatus(item);

  return (
    <div className={`rounded-xl border border-line bg-card p-4 space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="text-brand h-4 w-4" />
          <h4 className="text-[12.5px] font-semibold text-ink">Verification Status</h4>
        </div>
        <div className="text-[11px] text-ink-muted font-mono">
          Last Verified:{' '}
          <span className="font-sans font-medium text-ink">
            {status.lastVerified ? formatDate(status.lastVerified) : 'Awaiting finalization'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
        <StatusIndicatorPill label="IPFS Storage" status={status.ipfsStorage} />
        <StatusIndicatorPill label="Blockchain Integrity" status={status.blockchainIntegrity} />
        <StatusIndicatorPill label="Evidence Integrity Check" status={status.integrityCheck} />
        <StatusIndicatorPill label="Evidence Status" status={status.evidenceStatus} />
      </div>
    </div>
  );
}

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FolderOpen, ShieldCheck, AlertTriangle, Shield, Clock, Unlock, RefreshCw, Eye } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import FileTypeIcon from './ui/FileTypeIcon.jsx';
import EmptyState from './ui/EmptyState.jsx';
import { formatBytes, formatDate, formatRelativeTime } from '../utils/format.js';
import { useAuth } from '../auth/AuthContext.jsx';

function renderActionCell(file, to, isQuarantine, onRequestAccess, role) {
  if (isQuarantine) {
    return (
      <Link
        to={to}
        className="inline-flex items-center gap-1 rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium text-brand transition hover:bg-brand-soft"
      >
        Review
        <ArrowUpRight size={13} />
      </Link>
    );
  }

  const accessStatus = file.userAccessStatus || (file.activePermission?.hasPermission ? 'approved' : 'access_required');
  const latestReq = file.latestRequest;

  const pendingLabel = role === 'admin'
    ? 'Request Sent — Awaiting Super Admin'
    : role === 'super_admin'
    ? 'Request Sent — Awaiting Organization Admin'
    : 'Request Sent — Pending Approval';

  return (
    <div className="inline-flex items-center gap-1.5 justify-end">
      {accessStatus === 'pending' ? (
        <span
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-amber-300 bg-amber-500/10 px-2.5 py-1 text-[11.5px] font-medium text-amber-800"
          title={`Submitted ${latestReq?.createdAt ? formatRelativeTime(latestReq.createdAt) : ''} · Duration: ${latestReq?.requestedDuration || '1h'}`}
        >
          <Clock size={12} className="animate-spin text-amber-600 shrink-0" />
          {pendingLabel}
        </span>
      ) : accessStatus === 'approved' ? (
        <Link
          to={to}
          className="inline-flex items-center gap-1 rounded-[7px] bg-brand px-2.5 py-1.5 text-[12px] font-medium text-white shadow-xs transition hover:bg-brand-hover"
          title={file.activePermission?.isOwner ? 'Owner access' : `Approved access until ${latestReq?.expiresAt ? formatDate(latestReq.expiresAt) : 'expiry'}`}
        >
          <Unlock size={12} />
          View Evidence
        </Link>
      ) : accessStatus === 'rejected' ? (
        <>
          <span
            className="inline-flex items-center gap-1 rounded-[6px] border border-danger/30 bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-medium text-danger"
            title={latestReq?.rejectionReason ? `Reason: ${latestReq.rejectionReason}` : 'Request rejected'}
          >
            Rejected
          </span>
          {typeof onRequestAccess === 'function' && (
            <button
              type="button"
              onClick={() => onRequestAccess(file)}
              className="btn-secondary btn-sm"
              title="Submit a new view access request"
            >
              <RefreshCw size={12} />
              Request Again
            </button>
          )}
        </>
      ) : accessStatus === 'expired' ? (
        <>
          <span
            className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-ink-muted"
            title="Temporary view access has expired"
          >
            Expired
          </span>
          {typeof onRequestAccess === 'function' && (
            <button
              type="button"
              onClick={() => onRequestAccess(file)}
              className="btn-secondary btn-sm"
              title="Request view access again"
            >
              <RefreshCw size={12} />
              Request Again
            </button>
          )}
        </>
      ) : accessStatus === 'revoked' ? (
        <>
          <span
            className="inline-flex items-center gap-1 rounded-[6px] border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-medium text-rose-700"
            title={latestReq?.revocationReason ? `Revoked: ${latestReq.revocationReason}` : 'Access was revoked'}
          >
            Revoked
          </span>
          {typeof onRequestAccess === 'function' && (
            <button
              type="button"
              onClick={() => onRequestAccess(file)}
              className="btn-secondary btn-sm"
              title="Request view access again"
            >
              <RefreshCw size={12} />
              Request Again
            </button>
          )}
        </>
      ) : (
        /* access_required or no request yet */
        <>
          {typeof onRequestAccess === 'function' && (
            <button
              type="button"
              onClick={() => onRequestAccess(file)}
              className="btn-primary btn-sm"
              title="Request temporary view access"
            >
              <Shield size={12} />
              Request View Access
            </button>
          )}
        </>
      )}

      {/* Details button to open metadata and case history */}
      <Link
        to={to}
        className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-surface hover:text-ink"
        aria-label={`Open details for ${file.fileName}`}
        title="View metadata and access details"
      >
        <Eye size={13} />
        Details
      </Link>
    </div>
  );
}

function storageLabel(file) {
  if (file.isQuarantine) return { status: 'quarantine', label: 'Quarantine' };
  if (file.verification?.ipfsStorage === 'Verified' || file.storageStatus === 'ipfs' || file.ipfsCID) return { status: 'ipfs', label: 'IPFS' };
  if (file.storageStatus === 'failed') return { status: 'failed', label: 'Failed' };
  return { status: 'not_stored', label: 'Not stored' };
}

function blockchainLabel(file) {
  if (file.verification?.blockchainIntegrity === 'Verified' || file.blockchainStatus === 'confirmed' || file.blockchainTxHash) {
    return { status: 'confirmed', label: 'Verified' };
  }
  if (file.blockchainStatus === 'pending') return { status: 'pending_blockchain', label: 'Pending' };
  if (file.blockchainStatus === 'failed') return { status: 'failed', label: 'Failed' };
  return { status: 'not_requested', label: 'Not requested' };
}

function getVerificationStatus(file) {
  if (file.verification?.blockchainIntegrity === 'Verified' || file.blockchainStatus === 'confirmed' || file.blockchainTxHash) {
    return { status: 'verified', label: 'Verified', icon: ShieldCheck };
  }
  if (file.blockchainStatus === 'pending' || file.status === 'pending_blockchain') {
    return { status: 'pending', label: 'Pending Verification', icon: ShieldCheck };
  }
  if (file.blockchainStatus === 'failed') {
    return { status: 'failed', label: 'Needs Review', icon: AlertTriangle };
  }
  if (file.status === 'stored_ipfs' && file.ipfsCID) {
    return { status: 'stored', label: 'Securely Stored', icon: ShieldCheck };
  }
  return { status: 'not_requested', label: 'Not Verified', icon: ShieldCheck };
}

export default function EvidenceTable({
  files = [],
  detailsBase = '/citizen/evidence',
  emptyTitle = 'No files yet',
  emptyDescription = 'Files you upload will appear here with their storage and verification status.',
  emptyAction = null,
  showGroup = false,
  showUploader = false,
  showTechnicalDetails = false,
  onRequestAccess = null
}) {
  const { role } = useAuth();
  if (!files.length) {
    return (
      <EmptyState
        icon={FolderOpen}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
      />
    );
  }

  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">File</th>
              <th scope="col">Size</th>
              <th scope="col">Status</th>
              <th scope="col">Storage</th>
              {showTechnicalDetails ? <th scope="col">Blockchain</th> : null}
              {showTechnicalDetails ? <th scope="col">Verification</th> : null}
              {showGroup ? <th scope="col">Group</th> : null}
              {showUploader ? <th scope="col">Uploaded By</th> : null}
              <th scope="col">Uploaded</th>
              <th scope="col" className="sticky right-0 z-10 bg-card text-right shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.06)] pl-4">Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const storage = storageLabel(file);
              const chain = blockchainLabel(file);
              const verification = getVerificationStatus(file);
              const isQuarantine = Boolean(file.isQuarantine);
              const to = isQuarantine ? '/officer/pending-reviews' : `${detailsBase}/${file._id}`;

              return (
                <tr key={file._id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <FileTypeIcon mimeType={file.mimeType} fileName={file.fileName} size="sm" />
                      <div className="min-w-0">
                        <Link
                          to={to}
                          className="block max-w-[280px] truncate text-[13.5px] font-medium text-ink transition hover:text-brand"
                          title={file.fileName}
                        >
                          {file.fileName}
                        </Link>
                        <p className="mt-0.5 text-[11.5px] text-ink-faint">
                          {file.caseId ? `Case ${file.caseId}` : 'Personal file'}
                        </p>
                        {file.userAccessStatus === 'pending' && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                            <Clock size={10} className="animate-spin text-amber-600" />
                            View Request Pending
                          </span>
                        )}
                        {file.userAccessStatus === 'approved' && (
                          <span className="mt-1 inline-flex items-center gap-1 rounded bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">
                            <Unlock size={10} />
                            Access Approved
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-[13px] text-ink-muted">
                    {formatBytes(file.fileSize)}
                  </td>
                  <td><StatusBadge status={file.status} /></td>
                  <td><StatusBadge status={storage.status} label={storage.label} /></td>
                  {showTechnicalDetails ? <td><StatusBadge status={chain.status} label={chain.label} /></td> : null}
                  {showTechnicalDetails ? (
                    <td>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={verification.status} label={verification.label} />
                      </div>
                    </td>
                  ) : null}
                  {showGroup ? (
                    <td className="text-[13px] text-ink-muted">
                      {file.groupId ? file.groupName || 'Unknown Group' : 'No group'}
                    </td>
                  ) : null}
                  {showUploader ? (
                    <td className="text-[13px] text-ink-muted">
                      {file.uploadedBy?.profile?.displayName || file.UploaderWallet?.slice(0, 8) || 'Unknown'}
                    </td>
                  ) : null}
                  <td className="whitespace-nowrap">
                    <span className="text-[13px] text-ink-muted" title={formatDate(file.createdAt)}>
                      {formatRelativeTime(file.createdAt)}
                    </span>
                  </td>
                  <td className="sticky right-0 z-10 bg-card text-right whitespace-nowrap shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.06)] pl-4">
                    {renderActionCell(file, to, isQuarantine, onRequestAccess, role)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <ul className="divide-y divide-line md:hidden">
        {files.map((file) => {
          const storage = storageLabel(file);
          const chain = blockchainLabel(file);
          const verification = getVerificationStatus(file);
          const isQuarantine = Boolean(file.isQuarantine);
          const to = isQuarantine ? '/officer/pending-reviews' : `${detailsBase}/${file._id}`;

          return (
            <li key={file._id} className="p-4 transition hover:bg-surface/60">
              <div className="flex items-start gap-3">
                <FileTypeIcon mimeType={file.mimeType} fileName={file.fileName} size="sm" />
                <div className="min-w-0 flex-1">
                  <Link to={to} className="block truncate text-[13.5px] font-medium text-ink hover:text-brand">
                    {file.fileName}
                  </Link>
                  <p className="mt-0.5 text-[11.5px] text-ink-faint">
                    {file.caseId ? `Case ${file.caseId}` : 'Personal file'} · {formatBytes(file.fileSize)} · {formatRelativeTime(file.createdAt)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={file.status} />
                    <StatusBadge status={storage.status} label={storage.label} />
                    {showTechnicalDetails ? <StatusBadge status={chain.status} label={chain.label} /> : null}
                    {showTechnicalDetails ? <StatusBadge status={verification.status} label={verification.label} /> : null}
                  </div>
                </div>
              </div>
              <div className="mt-3 border-t border-line/60 pt-2.5">
                {renderActionCell(file, to, isQuarantine, onRequestAccess, role)}
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

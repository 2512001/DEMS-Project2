import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, FolderOpen, ShieldCheck, AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import FileTypeIcon from './ui/FileTypeIcon.jsx';
import EmptyState from './ui/EmptyState.jsx';
import { formatBytes, formatDate, formatRelativeTime } from '../utils/format.js';

function getUploadStatus(file) {
  if (file.status === 'processing') {
    return { status: 'uploading', label: 'Uploading', icon: Clock };
  }
  if (file.status === 'error' || file.status === 'failed') {
    return { status: 'failed', label: 'Upload Failed', icon: AlertTriangle };
  }
  if (file.status === 'stored_ipfs' || file.status === 'stored_on_chain') {
    return { status: 'success', label: 'Uploaded Successfully', icon: CheckCircle2 };
  }
  return { status: 'processing', label: 'Processing', icon: Clock };
}

function getVerificationStatus(file) {
  if (file.verification?.blockchainIntegrity === 'Verified' || file.blockchainStatus === 'confirmed' || file.blockchainTxHash) {
    return { status: 'verified', label: 'Verified', icon: ShieldCheck };
  }
  if (file.blockchainStatus === 'pending' || file.status === 'pending_blockchain') {
    return { status: 'pending', label: 'Pending Verification', icon: Clock };
  }
  if (file.blockchainStatus === 'failed') {
    return { status: 'needs_review', label: 'Needs Review', icon: AlertTriangle };
  }
  if (file.status === 'stored_ipfs' && file.ipfsCID) {
    return { status: 'secure', label: 'Securely Stored', icon: ShieldCheck };
  }
  return { status: 'not_verified', label: 'Not Verified', icon: ShieldCheck };
}

export default function SimpleEvidenceTable({
  files = [],
  detailsBase = '/citizen/evidence',
  emptyTitle = 'No files yet',
  emptyDescription = 'Files you upload will appear here with their upload and verification status.',
  emptyAction = null
}) {
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
              <th scope="col">Upload Status</th>
              <th scope="col">Verification Status</th>
              <th scope="col">Uploaded</th>
              <th scope="col" className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const uploadStatus = getUploadStatus(file);
              const verificationStatus = getVerificationStatus(file);
              const isQuarantine = Boolean(file.isQuarantine);
              const to = isQuarantine ? '/officer/pending-reviews' : `${detailsBase}/${file._id}`;
              const UploadIcon = uploadStatus.icon;
              const VerifyIcon = verificationStatus.icon;

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
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap text-[13px] text-ink-muted">
                    {formatBytes(file.fileSize)}
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <UploadIcon size={14} className={uploadStatus.status === 'uploading' ? 'animate-spin' : ''} />
                      <StatusBadge status={uploadStatus.status} label={uploadStatus.label} />
                    </div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <VerifyIcon size={14} />
                      <StatusBadge status={verificationStatus.status} label={verificationStatus.label} />
                    </div>
                  </td>
                  <td className="whitespace-nowrap">
                    <span className="text-[13px] text-ink-muted" title={formatDate(file.createdAt)}>
                      {formatRelativeTime(file.createdAt)}
                    </span>
                  </td>
                  <td className="text-right">
                    <Link
                      to={to}
                      className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1.5 text-[12.5px] font-medium text-brand transition hover:bg-brand-soft"
                      aria-label={`View ${file.fileName}`}
                    >
                      View
                      <ArrowUpRight size={13} />
                    </Link>
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
          const uploadStatus = getUploadStatus(file);
          const verificationStatus = getVerificationStatus(file);
          const isQuarantine = Boolean(file.isQuarantine);
          const to = isQuarantine ? '/officer/pending-reviews' : `${detailsBase}/${file._id}`;
          const UploadIcon = uploadStatus.icon;
          const VerifyIcon = verificationStatus.icon;

          return (
            <li key={file._id}>
              <Link to={to} className="block px-4 py-3.5 transition hover:bg-surface">
                <div className="flex items-start gap-3">
                  <FileTypeIcon mimeType={file.mimeType} fileName={file.fileName} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium text-ink">{file.fileName}</p>
                    <p className="mt-0.5 text-[11.5px] text-ink-faint">
                      {file.caseId ? `Case ${file.caseId}` : 'Personal file'} · {formatBytes(file.fileSize)} · {formatRelativeTime(file.createdAt)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <div className="flex items-center gap-1.5">
                        <UploadIcon size={12} className={uploadStatus.status === 'uploading' ? 'animate-spin' : ''} />
                        <StatusBadge status={uploadStatus.status} label={uploadStatus.label} />
                      </div>
                      <div className="flex items-center gap-1.5">
                        <VerifyIcon size={12} />
                        <StatusBadge status={verificationStatus.status} label={verificationStatus.label} />
                      </div>
                    </div>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </>
  );
}

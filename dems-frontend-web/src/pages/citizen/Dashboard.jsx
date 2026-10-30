import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Database,
  FolderLock,
  Lock,
  Plus,
  ShieldCheck,
  UploadCloud
} from 'lucide-react';

import { getMyFiles } from '../../api/evidence.js';
import { getCitizenAnalytics } from '../../api/analytics.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import FileTypeIcon from '../../components/ui/FileTypeIcon.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { StatCardSkeleton } from '../../components/ui/Skeleton.jsx';
import { formatBytes, formatRelativeTime, percent } from '../../utils/format.js';

function StorageIntegrityPanel({ overview, files, isLoading }) {
  const total = overview?.totalEvidence ?? 0;
  const chainConfirmed = overview?.blockchainConfirmedEvidence ?? 0;
  const integrityVerified = overview?.verifiedEvidence ?? 0;
  const ipfsCount = files.filter((file) => file.verification?.ipfsStorage === 'Verified' || file.storageStatus === 'ipfs' || file.ipfsCID).length;

  const rows = [
    {
      icon: Lock,
      label: 'Encryption',
      status: <StatusBadge status="encrypted" label="AES-256-GCM" />,
      detail: 'Applied before any file leaves your device session'
    },
    {
      icon: Database,
      label: 'IPFS storage',
      status: total > 0
        ? <StatusBadge status="ipfs" label={`${ipfsCount} of ${files.length} loaded`} />
        : <StatusBadge status="not_stored" label="No files yet" />,
      detail: 'Decentralized storage. Content is encrypted before upload — IPFS itself does not encrypt.'
    },
    {
      icon: ShieldCheck,
      label: 'Blockchain integrity',
      status: chainConfirmed > 0
        ? <StatusBadge status="confirmed" label={`${chainConfirmed} verified`} />
        : <StatusBadge status="not_requested" label="Not requested" />,
      detail: 'An on-chain hash proves the file has not changed. It does not hide the file contents.'
    }
  ];

  return (
    <section className="section-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="section-title">Storage &amp; integrity</h2>
          <p className="section-subtitle">How your files are protected</p>
        </div>
        {total > 0 ? (
          <span className="badge-neutral">{percent(integrityVerified, total)}% integrity verified</span>
        ) : null}
      </div>

      <ul className="mt-4 divide-y divide-line">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <li key={row.label} className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-surface text-ink-muted">
                <Icon size={15} strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[13px] font-medium text-ink">{row.label}</p>
                  {isLoading ? <span className="skeleton h-4 w-20" /> : row.status}
                </div>
                <p className="mt-1 text-[12px] leading-5 text-ink-faint">{row.detail}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function CitizenDashboard() {
  const { user } = useAuth();

  const filesQuery = useQuery({
    queryKey: ['my-files', 1, 5],
    queryFn: () => getMyFiles(1, 5)
  });

  const analytics = useQuery({
    queryKey: ['analytics', 'citizen'],
    queryFn: getCitizenAnalytics
  });

  const files = [...(filesQuery.data?.quarantine || []), ...(filesQuery.data?.data || [])];
  const recent = files.slice(0, 5);
  const overview = analytics.data?.overview;
  const totalFiles = filesQuery.data?.pagination?.totalRecords ?? overview?.totalEvidence ?? 0;
  const blockchainVerified = overview?.blockchainConfirmedEvidence ?? 0;
  const ipfsStored = files.filter((file) => file.verification?.ipfsStorage === 'Verified' || file.storageStatus === 'ipfs' || file.ipfsCID).length;

  const loading = filesQuery.isLoading || analytics.isLoading;
  const firstName = (user?.profile?.displayName || '').split(' ')[0];

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={firstName ? `Welcome back, ${firstName}` : 'Personal workspace'}
        title="Secure File Vault"
        subtitle="Securely store, manage, and verify your digital files."
        actions={
          <Link to="/citizen/upload-evidence" className="btn-primary">
            <Plus size={15} />
            Upload File
          </Link>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          Array.from({ length: 4 }).map((_, index) => <StatCardSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              icon={FolderLock}
              label="Total Files"
              value={totalFiles}
              detail={totalFiles === 1 ? '1 file in your vault' : `${totalFiles} files in your vault`}
              tone="brand"
            />
            <StatCard
              icon={Lock}
              label="Encrypted Storage"
              value={totalFiles > 0 ? `${totalFiles}` : '0'}
              detail="AES-256-GCM encryption at rest"
              tone="success"
            />
            <StatCard
              icon={ShieldCheck}
              label="Blockchain Verified"
              value={blockchainVerified}
              detail={blockchainVerified > 0 ? 'On-chain integrity proofs' : 'No proofs recorded yet'}
              tone={blockchainVerified > 0 ? 'success' : 'neutral'}
            />
            <StatCard
              icon={Database}
              label="IPFS Stored"
              value={ipfsStored}
              detail={files.length < totalFiles ? 'Across your most recent files' : 'Decentralized storage'}
              tone="neutral"
            />
          </>
        )}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Recent files</h2>
              <p className="section-subtitle">Your latest uploads and their verification state</p>
            </div>
            <Link to="/citizen/evidence-vault" className="btn-ghost btn-sm">
              View all
              <ArrowRight size={13} />
            </Link>
          </div>

          {filesQuery.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="skeleton h-8 w-8 rounded-[8px]" />
                  <span className="skeleton h-3 flex-1" />
                  <span className="skeleton h-5 w-16 rounded-full" />
                </div>
              ))}
            </div>
          ) : filesQuery.isError ? (
            <div className="p-5">
              <div className="alert-danger">
                <span>Your files could not be loaded right now.</span>
              </div>
              <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => filesQuery.refetch()}>
                Try again
              </button>
            </div>
          ) : recent.length === 0 ? (
            <div className="p-5">
              <EmptyState
                compact
                icon={UploadCloud}
                title="Your vault is empty"
                description="Upload your first file to store it securely, optionally verify it with AI, and record an on-chain integrity proof."
                action={
                  <Link to="/citizen/upload-evidence" className="btn-primary btn-sm">
                    <UploadCloud size={14} />
                    Upload File
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {recent.map((file) => (
                <li key={file._id}>
                  <Link
                    to={file.isQuarantine ? '/officer/pending-reviews' : `/citizen/evidence/${file._id}`}
                    className="flex items-center gap-3 px-5 py-3.5 transition hover:bg-surface"
                  >
                    <FileTypeIcon mimeType={file.mimeType} fileName={file.fileName} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-ink">{file.fileName}</p>
                      <p className="mt-0.5 text-[12px] text-ink-faint">
                        {formatBytes(file.fileSize)} · {formatRelativeTime(file.createdAt)}
                      </p>
                    </div>
                    <StatusBadge status={file.status} />
                    <ArrowRight size={14} className="hidden shrink-0 text-ink-faint sm:block" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <StorageIntegrityPanel overview={overview} files={files} isLoading={analytics.isLoading} />
      </div>

      <section className="section-card">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="section-title">Recent activity</h2>
            <p className="section-subtitle">Security-relevant activity is recorded in an audit trail</p>
          </div>
          <span className="badge-neutral">Account level</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-[10px] border border-line bg-[#FBFCFD] p-3.5">
            <p className="detail-label">Pending verification</p>
            <p className="mt-1 text-[18px] font-semibold text-ink">{overview?.pendingEvidence ?? '—'}</p>
            <p className="mt-0.5 text-[12px] text-ink-faint">Files without an integrity check</p>
          </div>
          <div className="rounded-[10px] border border-line bg-[#FBFCFD] p-3.5">
            <p className="detail-label">Integrity verified</p>
            <p className="mt-1 text-[18px] font-semibold text-ink">{overview?.verifiedEvidence ?? '—'}</p>
            <p className="mt-0.5 text-[12px] text-ink-faint">Confirmed against stored hashes</p>
          </div>
          <div className="rounded-[10px] border border-line bg-[#FBFCFD] p-3.5">
            <p className="detail-label">Chain confirmations</p>
            <p className="mt-1 text-[18px] font-semibold text-ink">{overview?.blockchainConfirmedEvidence ?? '—'}</p>
            <p className="mt-0.5 text-[12px] text-ink-faint">Recorded on the connected network</p>
          </div>
        </div>
      </section>
    </div>
  );
}

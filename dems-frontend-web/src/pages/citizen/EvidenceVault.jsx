import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChevronLeft,
  ChevronRight,
  FolderLock,
  RefreshCcw,
  Search,
  ShieldCheck,
  UploadCloud,
  X
} from 'lucide-react';

import { getMyFiles } from '../../api/evidence.js';
import SimpleEvidenceTable from '../../components/SimpleEvidenceTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import { StatCardSkeleton, TableSkeleton } from '../../components/ui/Skeleton.jsx';
import { formatBytes } from '../../utils/format.js';

const FILTERS = [
  { value: 'all', label: 'All files' },
  { value: 'verified', label: 'Verified' },
  { value: 'pending', label: 'Pending Verification' },
  { value: 'needs_review', label: 'Needs Review' }
];

function matchesFilter(file, filter) {
  if (filter === 'verified') return file.verification?.blockchainIntegrity === 'Verified' || file.blockchainStatus === 'confirmed' || Boolean(file.blockchainTxHash);
  if (filter === 'pending') return file.blockchainStatus === 'pending' || file.status === 'pending_blockchain';
  if (filter === 'needs_review') return file.blockchainStatus === 'failed';
  return true;
}

export default function EvidenceVault() {
  const [page, setPage] = useState(1);
  const [term, setTerm] = useState('');
  const [filter, setFilter] = useState('all');

  const query = useQuery({
    queryKey: ['my-files', page],
    queryFn: () => getMyFiles(page, 10),
    placeholderData: (previous) => previous
  });

  const files = useMemo(
    () => [...(query.data?.quarantine || []), ...(query.data?.data || [])],
    [query.data]
  );

  const pagination = query.data?.pagination || {};
  const totalRecords = pagination.totalRecords ?? 0;
  const totalPages = pagination.totalPages ?? 1;

  const visible = useMemo(() => {
    const needle = term.trim().toLowerCase();
    return files.filter((file) => {
      if (!matchesFilter(file, filter)) return false;
      if (!needle) return true;
      return [file.fileName, file.caseId]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle));
    });
  }, [files, filter, term]);

  const verified = files.filter((file) => file.verification?.blockchainIntegrity === 'Verified' || file.blockchainStatus === 'confirmed' || file.blockchainTxHash).length;
  const pending = files.filter((file) => file.blockchainStatus === 'pending' || file.status === 'pending_blockchain').length;
  const storedSize = files.reduce((total, file) => total + (Number(file.fileSize) || 0), 0);
  const loading = query.isLoading;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="My files"
        subtitle="Every file you have stored, with its encryption, storage and verification status."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCcw size={14} className={query.isFetching ? 'animate-spin' : ''} />
              Refresh
            </button>
            <Link to="/citizen/upload-evidence" className="btn-primary">
              <UploadCloud size={15} />
              Upload File
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {loading ? (
          Array.from({ length: 3 }).map((_, index) => <StatCardSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              icon={FolderLock}
              label="Total files"
              value={totalRecords}
              detail={pagination.limit ? `${Math.min(pagination.limit, totalRecords)} shown per page` : undefined}
              tone="brand"
            />
            <StatCard
              icon={ShieldCheck}
              label="Verified"
              value={verified}
              detail={`Across ${files.length} loaded files`}
              tone={verified > 0 ? 'success' : 'neutral'}
            />
            <StatCard
              icon={RefreshCcw}
              label="Pending"
              value={pending}
              detail="Awaiting verification"
              tone={pending > 0 ? 'neutral' : 'neutral'}
            />
          </>
        )}
      </div>

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="relative w-full sm:max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Search by name or case ID"
              className="input pl-8 pr-8"
              aria-label="Search files"
            />
            {term ? (
              <button
                type="button"
                onClick={() => setTerm('')}
                className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-ink-faint hover:bg-surface hover:text-ink"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
                className={`rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-medium transition ${
                  filter === item.value
                    ? 'bg-brand-soft text-brand'
                    : 'text-ink-muted hover:bg-surface hover:text-ink'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {query.isLoading ? (
          <div className="p-4"><TableSkeleton rows={6} columns={6} /></div>
        ) : query.isError ? (
          <div className="p-5">
            <div className="alert-danger">Your files could not be loaded. Please try again.</div>
            <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => query.refetch()}>
              Retry
            </button>
          </div>
        ) : (
          <SimpleEvidenceTable
            files={visible}
            emptyTitle={files.length ? 'No files match this view' : 'Your vault is empty'}
            emptyDescription={
              files.length
                ? 'Try a different search term or filter.'
                : 'Upload your first file to store it securely and record its integrity.'
            }
            emptyAction={
              files.length ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setTerm('');
                    setFilter('all');
                  }}
                >
                  Clear filters
                </button>
              ) : (
                <Link to="/citizen/upload-evidence" className="btn-primary btn-sm">
                  <UploadCloud size={14} />
                  Upload File
                </Link>
              )
            }
          />
        )}

        <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-[12.5px] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <p>
            {totalRecords === 0
              ? 'No files'
              : `Page ${pagination.page || page} of ${totalPages} · ${totalRecords} file${totalRecords === 1 ? '' : 's'}`}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setPage((current) => current - 1)}
              disabled={!pagination.hasPrevPage}
            >
              <ChevronLeft size={13} />
              Previous
            </button>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => setPage((current) => current + 1)}
              disabled={!pagination.hasNextPage}
            >
              Next
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

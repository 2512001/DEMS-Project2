import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Eye,
  Filter,
  FolderLock,
  RefreshCcw,
  Search,
  ShieldCheck,
  Shield,
  Plus,
  UploadCloud,
  X
} from 'lucide-react';
import { getOrganizationEvidence } from '../../api/evidence.js';
import EvidenceTable from '../../components/EvidenceTable.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { TableSkeleton } from '../../components/ui/Skeleton.jsx';
import RequestViewAccessModal from '../../components/viewAccess/RequestViewAccessModal.jsx';
import { formatBytes, formatDate, formatRelativeTime } from '../../utils/format.js';
import { subscribeToViewAccessEvents } from '../../api/socket.js';

const FILTER_OPTIONS = [
  { value: '', label: 'All Status' },
  { value: 'stored_on_chain', label: 'Blockchain Verified' },
  { value: 'pending_blockchain', label: 'Pending Blockchain' },
  { value: 'stored_ipfs', label: 'IPFS Only' },
  { value: 'processing', label: 'Processing' },
  { value: 'error', label: 'Error' }
];

const BLOCKCHAIN_FILTER_OPTIONS = [
  { value: '', label: 'All Blockchain' },
  { value: 'confirmed', label: 'Verified' },
  { value: 'pending', label: 'Pending' },
  { value: 'failed', label: 'Failed' },
  { value: 'not_requested', label: 'Not Requested' }
];

const STORAGE_FILTER_OPTIONS = [
  { value: '', label: 'All Storage' },
  { value: 'ipfs', label: 'IPFS' },
  { value: 'failed', label: 'Failed' }
];

export default function OrgEvidence() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [blockchainFilter, setBlockchainFilter] = useState('');
  const [storageFilter, setStorageFilter] = useState('');
  const [sortBy, setSortBy] = useState('createdAt');
  const [sortOrder, setSortOrder] = useState('desc');
  const [showFilters, setShowFilters] = useState(false);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['org-evidence', page, search, statusFilter, blockchainFilter, storageFilter, sortBy, sortOrder],
    queryFn: () => getOrganizationEvidence({
      page,
      limit: 20,
      search,
      status: statusFilter,
      blockchainStatus: blockchainFilter,
      storageStatus: storageFilter,
      sortBy,
      sortOrder
    })
  });

  const files = data?.data || [];
  const pagination = data?.pagination || {};
  const totalRecords = pagination.totalRecords || 0;
  const totalPages = pagination.totalPages || 1;

  const hasActiveFilters = search || statusFilter || blockchainFilter || storageFilter;

  useEffect(() => {
    const unsub = subscribeToViewAccessEvents(() => {
      refetch();
    });
    return () => unsub();
  }, [refetch]);

  const handleFilterReset = () => {
    setSearch('');
    setStatusFilter('');
    setBlockchainFilter('');
    setStorageFilter('');
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organization"
        title="Organization Evidence"
        subtitle="View and manage all evidence within your organization with full access control."
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => refetch()}
              disabled={isLoading}
            >
              <RefreshCcw size={14} className={isLoading ? 'animate-spin' : ''} />
              Refresh
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={() => { setSelectedEvidence(null); setShowRequestModal(true); }}
            >
              <Shield size={14} />
              Request View Access
            </button>
            <Link to="/admin/view-requests" className="btn-secondary">
              <Eye size={14} />
              View Access Requests
            </Link>
            <Link to="/admin/dashboard" className="btn-secondary">
              <UploadCloud size={15} />
              Dashboard
            </Link>
          </>
        }
      />

      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
          <div className="relative w-full sm:max-w-xs">
            <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search by name, case ID, or hash"
              className="input pl-8 pr-8"
              aria-label="Search evidence"
            />
            {search ? (
              <button
                type="button"
                onClick={() => { setSearch(''); setPage(1); }}
                className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-ink-faint hover:bg-surface hover:text-ink"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="btn-secondary btn-sm"
            aria-expanded={showFilters}
          >
            <Filter size={14} />
            Filters
            {hasActiveFilters && <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[11px] text-white">Active</span>}
          </button>
        </div>

        {showFilters && (
          <div className="grid gap-4 border-b border-line px-4 py-4 sm:grid-cols-2 lg:grid-cols-4 sm:px-5">
            <div>
              <label className="block text-[12px] font-medium text-ink-faint mb-1.5">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
                className="input"
              >
                {FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-ink-faint mb-1.5">Blockchain</label>
              <select
                value={blockchainFilter}
                onChange={(e) => { setBlockchainFilter(e.target.value); setPage(1); }}
                className="input"
              >
                {BLOCKCHAIN_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-ink-faint mb-1.5">Storage</label>
              <select
                value={storageFilter}
                onChange={(e) => { setStorageFilter(e.target.value); setPage(1); }}
                className="input"
              >
                {STORAGE_FILTER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[12px] font-medium text-ink-faint mb-1.5">Sort by</label>
              <select
                value={sortBy}
                onChange={(e) => { setSortBy(e.target.value); setPage(1); }}
                className="input"
              >
                <option value="createdAt">Upload Date</option>
                <option value="fileName">File Name</option>
                <option value="fileSize">File Size</option>
                <option value="blockchainStatus">Blockchain Status</option>
              </select>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={6} columns={7} /></div>
        ) : isError ? (
          <div className="p-5">
            <div className="alert-danger">Organization evidence could not be loaded.</div>
            <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => refetch()}>Retry</button>
          </div>
        ) : (
          <>
            <EvidenceTable
              files={files}
              detailsBase="/admin/evidence"
              showGroup={true}
              showUploader={true}
              showTechnicalDetails={true}
              onRequestAccess={(file) => { setSelectedEvidence(file); setShowRequestModal(true); }}
              emptyTitle="No organization evidence yet"
              emptyDescription="Evidence uploaded by members of your organization will appear here."
              emptyAction={
                <Link to="/admin/dashboard" className="btn-secondary btn-sm">
                  <UploadCloud size={14} />
                  Back to dashboard
                </Link>
              }
            />

            <div className="flex flex-col gap-3 border-t border-line px-4 py-3 text-[12.5px] text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-5">
              <p>
                {totalRecords === 0
                  ? 'No evidence'
                  : `Page ${pagination.page || page} of ${totalPages} · ${totalRecords} record${totalRecords === 1 ? '' : 's'}`}
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
          </>
        )}
      </section>

      <RequestViewAccessModal
        open={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        initialTargetType="evidence"
        initialTargetId={selectedEvidence?._id || ''}
        initialTargetName={selectedEvidence?.fileName || ''}
        initialOrgId={selectedEvidence?.organizationId?._id || selectedEvidence?.organizationId || ''}
        lockedTarget={Boolean(selectedEvidence)}
        targetCaseId={selectedEvidence?.caseId || ''}
        targetGroupId={selectedEvidence?.groupId?._id || selectedEvidence?.groupId || ''}
        targetGroupName={selectedEvidence?.groupId?.name || ''}
        onSuccess={() => {
          refetch();
        }}
      />
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search, Filter, FileText, Building2, Hash, X, CheckCircle, Clock, XCircle, AlertTriangle, Eye, Shield, Unlock, RefreshCw, Ban } from 'lucide-react';
import { getPlatformEvidence, listOrganizations } from '../../api/admin.js';
import { subscribeToViewAccessEvents } from '../../api/socket.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { TableSkeleton } from '../../components/ui/Skeleton.jsx';
import RequestViewAccessModal from '../../components/viewAccess/RequestViewAccessModal.jsx';
import { formatDate, formatRelativeTime } from '../../utils/format.js';

export default function GlobalEvidence() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [blockchainFilter, setBlockchainFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [fileTypeFilter, setFileTypeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedEvidence, setSelectedEvidence] = useState(null);

  const { data: evidenceData, isLoading, isError, refetch } = useQuery({
    queryKey: ['platform-evidence', page, search, statusFilter, blockchainFilter, orgFilter, fileTypeFilter, startDate, endDate],
    queryFn: () => getPlatformEvidence({
      page,
      limit: 20,
      search,
      status: statusFilter,
      blockchainStatus: blockchainFilter,
      organizationId: orgFilter,
      fileType: fileTypeFilter,
      startDate,
      endDate
    })
  });

  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: listOrganizations
  });

  const evidence = evidenceData?.data || [];
  const total = evidenceData?.pagination?.totalRecords || 0;
  const organizations = orgsData?.data || [];

  const hasActiveFilters = search || statusFilter || blockchainFilter || orgFilter || fileTypeFilter || startDate || endDate;

  // Real-time synchronization when view access requests are created or updated
  useEffect(() => {
    const unsub = subscribeToViewAccessEvents(() => {
      refetch();
    });
    return () => unsub();
  }, [refetch]);

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('');
    setBlockchainFilter('');
    setOrgFilter('');
    setFileTypeFilter('');
    setStartDate('');
    setEndDate('');
    setPage(1);
  };

  const blockchainStatusIcon = (status) => {
    switch (status) {
      case 'confirmed': return <CheckCircle size={14} className="text-success" />;
      case 'pending': return <Clock size={14} className="text-warn" />;
      case 'failed': return <XCircle size={14} className="text-danger" />;
      default: return <AlertTriangle size={14} className="text-ink-muted" />;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform administration"
        title="Global evidence"
        subtitle="View all evidence files across the platform."
        actions={
          <button
            type="button"
            className="btn-primary"
            onClick={() => { setSelectedEvidence(null); setShowRequestModal(true); }}
          >
            <Shield size={14} />
            Request View Access
          </button>
        }
      />

      <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <div className="relative w-full sm:max-w-xs">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search by name, hash, or case ID"
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
              <option value="">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
              <option value="stored_on_chain">Stored on chain</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-faint mb-1.5">Blockchain status</label>
            <select
              value={blockchainFilter}
              onChange={(e) => { setBlockchainFilter(e.target.value); setPage(1); }}
              className="input"
            >
              <option value="">All blockchain statuses</option>
              <option value="confirmed">Confirmed</option>
              <option value="pending">Pending</option>
              <option value="failed">Failed</option>
              <option value="not_requested">Not requested</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-faint mb-1.5">Organization</label>
            <select
              value={orgFilter}
              onChange={(e) => { setOrgFilter(e.target.value); setPage(1); }}
              className="input"
            >
              <option value="">All organizations</option>
              {organizations.map((org) => (
                <option key={org._id} value={org._id}>{org.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-faint mb-1.5">File type</label>
            <select
              value={fileTypeFilter}
              onChange={(e) => { setFileTypeFilter(e.target.value); setPage(1); }}
              className="input"
            >
              <option value="">All types</option>
              <option value="image">Images</option>
              <option value="video">Videos</option>
              <option value="audio">Audio</option>
              <option value="application/pdf">PDF</option>
              <option value="application">Other documents</option>
            </select>
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-faint mb-1.5">Start date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
              className="input"
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-ink-faint mb-1.5">End date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
              className="input"
            />
          </div>
          <div className="flex items-end sm:col-span-2">
            {hasActiveFilters && (
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={clearFilters}
              >
                <X size={14} />
                Clear filters
              </button>
            )}
          </div>
        </div>
      )}

      {isLoading ? (
        <TableSkeleton rows={7} columns={7} />
      ) : isError ? (
        <div className="p-5">
          <div className="alert-danger">Evidence could not be loaded.</div>
          <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => refetch()}>Retry</button>
        </div>
      ) : evidence.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No evidence found"
          description={hasActiveFilters ? "Try adjusting your filters." : "No evidence has been uploaded yet."}
        />
      ) : (
        <section className="panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">File</th>
                  <th scope="col">Organization</th>
                  <th scope="col">Uploader</th>
                  <th scope="col">Status</th>
                  <th scope="col">Blockchain</th>
                  <th scope="col">IPFS CID</th>
                  <th scope="col">Uploaded</th>
                  <th scope="col" className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {evidence.map((ev) => (
                  <tr key={ev._id}>
                    <td>
                      <div>
                        <p className="text-[13px] font-medium text-ink">{ev.fileName}</p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          <span className="text-[11.5px] text-ink-f">{ev.mimeType}</span>
                          {ev.userAccessStatus === 'pending' && (
                            <span
                              className="inline-flex items-center gap-1 rounded-[5px] border border-amber-300 bg-amber-500/10 px-1.5 py-0.2 text-[10.5px] font-medium text-amber-800"
                              title={`Requested on ${ev.latestRequest?.createdAt ? formatDate(ev.latestRequest.createdAt) : 'N/A'}`}
                            >
                              <Clock size={10} className="animate-spin text-amber-600 shrink-0" />
                              Pending ({ev.latestRequest?.requestedDuration || '1h'}) · {ev.latestRequest?.createdAt ? formatRelativeTime(ev.latestRequest.createdAt) : ''}
                            </span>
                          )}
                          {ev.userAccessStatus === 'approved' && (
                            <span
                              className="inline-flex items-center gap-1 rounded-[5px] border border-[#c7e9dd] bg-success-soft px-1.5 py-0.2 text-[10.5px] font-medium text-success"
                              title={ev.activePermission?.isOwner ? 'Owner access' : `Access granted until ${ev.latestRequest?.expiresAt ? formatDate(ev.latestRequest.expiresAt) : 'expiry'}`}
                            >
                              <Unlock size={10} />
                              {ev.activePermission?.isOwner ? 'Owner Access' : `Access Active (${ev.latestRequest?.requestedDuration || 'Granted'})`}
                            </span>
                          )}
                          {ev.userAccessStatus === 'rejected' && (
                            <span
                              className="inline-flex items-center gap-1 rounded-[5px] border border-danger/30 bg-danger-soft px-1.5 py-0.2 text-[10.5px] font-medium text-danger"
                              title={ev.latestRequest?.rejectionReason ? `Reason: ${ev.latestRequest.rejectionReason}` : 'Rejected'}
                            >
                              <XCircle size={10} />
                              Rejected {ev.latestRequest?.rejectedAt ? `· ${formatRelativeTime(ev.latestRequest.rejectedAt)}` : ''}
                            </span>
                          )}
                          {ev.userAccessStatus === 'expired' && (
                            <span
                              className="inline-flex items-center gap-1 rounded-[5px] border border-line bg-surface px-1.5 py-0.2 text-[10.5px] font-medium text-ink-muted"
                              title="Temporary view access has expired"
                            >
                              <Clock size={10} />
                              Expired
                            </span>
                          )}
                          {ev.userAccessStatus === 'revoked' && (
                            <span
                              className="inline-flex items-center gap-1 rounded-[5px] border border-rose-300 bg-rose-50 px-1.5 py-0.2 text-[10.5px] font-medium text-rose-700"
                              title={ev.latestRequest?.revocationReason ? `Revoked: ${ev.latestRequest.revocationReason}` : 'Revoked'}
                            >
                              <Ban size={10} />
                              Revoked
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td>
                      {ev.organizationId ? (
                        <div>
                          <p className="text-[13px] text-ink">{ev.organizationId.name}</p>
                          <p className="text-[11.5px] text-ink-faint">{ev.organizationId.organizationCode}</p>
                        </div>
                      ) : (
                        <span className="text-[13px] text-ink-muted">None</span>
                      )}
                    </td>
                    <td>
                      {ev.uploadedBy ? (
                        <div>
                          <p className="text-[13px] text-ink">{ev.uploadedBy.profile?.displayName || 'Unknown'}</p>
                          <p className="text-[11.5px] text-ink-f">{ev.uploadedBy.walletAddress?.slice(0, 10)}...</p>
                        </div>
                      ) : (
                        <span className="text-[13px] text-ink-muted">{ev.UploaderWallet?.slice(0, 10)}...</span>
                      )}
                    </td>
                    <td>
                      <StatusBadge 
                        status={ev.status === 'approved' ? 'approved' : ev.status === 'rejected' ? 'failed' : ev.status === 'stored_on_chain' ? 'verified' : 'pending'} 
                        label={ev.status} 
                      />
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        {blockchainStatusIcon(ev.blockchainStatus)}
                        <span className="text-[12.5px] text-ink">{ev.blockchainStatus || 'N/A'}</span>
                      </div>
                    </td>
                    <td>
                      <p className="text-[11.5px] text-ink-f font-mono">{ev.ipfsCID?.slice(0, 12)}...</p>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="text-[12.5px] text-ink-muted" title={formatDate(ev.createdAt)}>
                        {formatRelativeTime(ev.createdAt)}
                      </span>
                    </td>
                    <td className="text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5 justify-end">
                        {ev.userAccessStatus === 'pending' ? (
                          <span
                            className="inline-flex items-center gap-1.5 rounded-[7px] border border-amber-300 bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] font-medium text-amber-800"
                            title={`Submitted ${ev.latestRequest?.createdAt ? formatRelativeTime(ev.latestRequest.createdAt) : ''} · Duration: ${ev.latestRequest?.requestedDuration || '1h'}`}
                          >
                            <Clock size={12} className="animate-spin text-amber-600 shrink-0" />
                            Request Sent — Awaiting Organization Admin
                          </span>
                        ) : ev.userAccessStatus === 'approved' ? (
                          <Link
                            to={`/superadmin/evidence/${ev._id}`}
                            className="inline-flex items-center gap-1 rounded-[7px] bg-brand px-2.5 py-1.5 text-[12px] font-medium text-white shadow-xs transition hover:bg-brand-hover"
                            title={ev.activePermission?.isOwner ? 'Owner access' : `Approved access until ${ev.latestRequest?.expiresAt ? formatDate(ev.latestRequest.expiresAt) : 'expiry'}`}
                          >
                            <Unlock size={12} />
                            View Evidence
                          </Link>
                        ) : ev.userAccessStatus === 'rejected' ? (
                          <>
                            <span
                              className="inline-flex items-center gap-1 rounded-[6px] border border-danger/30 bg-danger-soft px-1.5 py-0.5 text-[10.5px] font-medium text-danger"
                              title={ev.latestRequest?.rejectionReason ? `Reason: ${ev.latestRequest.rejectionReason}` : 'Request rejected'}
                            >
                              Rejected
                            </span>
                            <button
                              type="button"
                              onClick={() => { setSelectedEvidence(ev); setShowRequestModal(true); }}
                              className="btn-secondary btn-sm"
                              title="Submit a new view access request"
                            >
                              <RefreshCw size={12} />
                              Request Again
                            </button>
                          </>
                        ) : ev.userAccessStatus === 'expired' ? (
                          <>
                            <span
                              className="inline-flex items-center gap-1 rounded-[6px] border border-line bg-surface px-1.5 py-0.5 text-[10.5px] font-medium text-ink-muted"
                              title="Temporary view access has expired"
                            >
                              Expired
                            </span>
                            <button
                              type="button"
                              onClick={() => { setSelectedEvidence(ev); setShowRequestModal(true); }}
                              className="btn-secondary btn-sm"
                              title="Request view access again"
                            >
                              <RefreshCw size={12} />
                              Request Again
                            </button>
                          </>
                        ) : ev.userAccessStatus === 'revoked' ? (
                          <>
                            <span
                              className="inline-flex items-center gap-1 rounded-[6px] border border-rose-300 bg-rose-50 px-1.5 py-0.5 text-[10.5px] font-medium text-rose-700"
                              title={ev.latestRequest?.revocationReason ? `Revoked: ${ev.latestRequest.revocationReason}` : 'Access was revoked'}
                            >
                              Revoked
                            </span>
                            <button
                              type="button"
                              onClick={() => { setSelectedEvidence(ev); setShowRequestModal(true); }}
                              className="btn-secondary btn-sm"
                              title="Request view access again"
                            >
                              <RefreshCw size={12} />
                              Request Again
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => { setSelectedEvidence(ev); setShowRequestModal(true); }}
                            className="btn-primary btn-sm"
                            title="Request temporary view access"
                          >
                            <Shield size={12} />
                            Request View Access
                          </button>
                        )}

                        <Link
                          to={`/superadmin/evidence/${ev._id}`}
                          className="inline-flex items-center gap-1 rounded-[7px] px-2 py-1.5 text-[12px] font-medium text-ink-muted transition hover:bg-surface hover:text-ink"
                          title="View metadata and audit details"
                        >
                          <Eye size={13} />
                          Details
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {total > 20 && (
            <div className="border-t border-line px-4 py-3 flex items-center justify-between sm:px-5">
              <p className="text-[12.5px] text-ink-muted">
                Showing {((page - 1) * 20) + 1} to {Math.min(page * 20, total)} of {total} evidence
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  Previous
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page * 20 >= total}
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </section>
      )}

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

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Link as LinkIcon, Clock, CheckCircle, XCircle, AlertTriangle, Filter, X } from 'lucide-react';
import { getBlockchainMonitoring, listOrganizations } from '../../api/admin.js';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { TableSkeleton } from '../../components/ui/Skeleton.jsx';
import { formatDate, formatRelativeTime } from '../../utils/format.js';

export default function BlockchainMonitoring() {
  const [statusFilter, setStatusFilter] = useState('');
  const [orgFilter, setOrgFilter] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [page, setPage] = useState(1);

  const { data: blockchainData, isLoading, isError, refetch } = useQuery({
    queryKey: ['blockchain-monitoring', page, statusFilter, orgFilter],
    queryFn: () => getBlockchainMonitoring({
      page,
      limit: 20,
      status: statusFilter,
      organizationId: orgFilter
    })
  });

  const { data: orgsData } = useQuery({
    queryKey: ['organizations'],
    queryFn: listOrganizations
  });

  const transactions = blockchainData?.data || [];
  const total = blockchainData?.total || 0;
  const stats = blockchainData?.stats || {};
  const organizations = orgsData?.data || [];

  const hasActiveFilters = statusFilter || orgFilter;

  const clearFilters = () => {
    setStatusFilter('');
    setOrgFilter('');
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
        title="Blockchain monitoring"
        subtitle="View blockchain transaction status and verification across the platform."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-[10px] border border-line bg-[#FBFCFD] p-4">
          <CheckCircle size={18} className="text-success" />
          <p className="mt-2 text-[19px] font-semibold text-ink">{stats.confirmed ?? 0}</p>
          <p className="text-[12px] text-ink-muted">Confirmed</p>
        </div>
        <div className="rounded-[10px] border border-line bg-[#FBFCFD] p-4">
          <Clock size={18} className="text-warn" />
          <p className="mt-2 text-[19px] font-semibold text-ink">{stats.pending ?? 0}</p>
          <p className="text-[12px] text-ink-muted">Pending</p>
        </div>
        <div className="rounded-[10px] border border-line bg-[#FBFCFD] p-4">
          <XCircle size={18} className="text-danger" />
          <p className="mt-2 text-[19px] font-semibold text-ink">{stats.failed ?? 0}</p>
          <p className="text-[12px] text-ink-muted">Failed</p>
        </div>
        <div className="rounded-[10px] border border-line bg-[#FBFCFD] p-4">
          <AlertTriangle size={18} className="text-ink-muted" />
          <p className="mt-2 text-[19px] font-semibold text-ink">{stats.notRequested ?? 0}</p>
          <p className="text-[12px] text-ink-muted">Not requested</p>
        </div>
      </div>

      <div className="flex flex-col gap-3 border-b border-line px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
        <p className="text-[13px] text-ink-muted">
          {total} total blockchain operations
        </p>

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
        <div className="grid gap-4 border-b border-line px-4 py-4 sm:grid-cols-2 sm:px-5">
          <div>
            <label className="block text-[12px] font-medium text-ink-faint mb-1.5">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
              className="input"
            >
              <option value="">All statuses</option>
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
        <TableSkeleton rows={7} columns={6} />
      ) : isError ? (
        <div className="p-5">
          <div className="alert-danger">Blockchain data could not be loaded.</div>
          <button type="button" className="btn-secondary btn-sm mt-3" onClick={() => refetch()}>Retry</button>
        </div>
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No blockchain operations"
          description={hasActiveFilters ? "Try adjusting your filters." : "No blockchain operations have been recorded yet."}
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
                  <th scope="col">Transaction hash</th>
                  <th scope="col">IPFS CID</th>
                  <th scope="col">Requested</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx) => (
                  <tr key={tx._id}>
                    <td>
                      <p className="text-[13px] font-medium text-ink">{tx.fileName}</p>
                    </td>
                    <td>
                      {tx.organizationId ? (
                        <div>
                          <p className="text-[13px] text-ink">{tx.organizationId.name}</p>
                          <p className="text-[11.5px] text-ink-faint">{tx.organizationId.organizationCode}</p>
                        </div>
                      ) : (
                        <span className="text-[13px] text-ink-muted">None</span>
                      )}
                    </td>
                    <td>
                      {tx.uploadedBy ? (
                        <div>
                          <p className="text-[13px] text-ink">{tx.uploadedBy.profile?.displayName || 'Unknown'}</p>
                          <p className="text-[11.5px] text-ink-f">{tx.uploadedBy.walletAddress?.slice(0, 10)}...</p>
                        </div>
                      ) : (
                        <span className="text-[13px] text-ink-muted">Unknown</span>
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-1.5">
                        {blockchainStatusIcon(tx.blockchainStatus)}
                        <span className="text-[12.5px] text-ink">{tx.blockchainStatus || 'N/A'}</span>
                      </div>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-success-soft text-success border border-[#c7e9dd]">
                        <CheckCircle2 size={11} />
                        Verified
                      </span>
                    </td>
                    <td>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-success-soft text-success border border-[#c7e9dd]">
                        <CheckCircle2 size={11} />
                        Stored
                      </span>
                    </td>
                    <td className="whitespace-nowrap">
                      <span className="text-[12.5px] text-ink-muted" title={formatDate(tx.createdAt)}>
                        {formatRelativeTime(tx.createdAt)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          
          {total > 20 && (
            <div className="border-t border-line px-4 py-3 flex items-center justify-between sm:px-5">
              <p className="text-[12.5px] text-ink-muted">
                Showing {((page - 1) * 20) + 1} to {Math.min(page * 20, total)} of {total} transactions
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
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  FileText,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Building2,
  RefreshCw,
  Search,
  Filter,
  Copy,
  Check,
  Cpu,
  Lock
} from 'lucide-react';
import { getPendingUploads } from '../../api/controlledUpload.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { formatBytes, formatDate, formatRelativeTime } from '../../utils/format.js';
import { subscribeToUploadEvents } from '../../api/socket.js';
import { useToast } from '../../components/ui/Toast.jsx';

export default function SuperAdminPendingUploads() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const [filterStatus, setFilterStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState('');

  const list = useQuery({
    queryKey: ['super-admin-pending-uploads', filterStatus, searchTerm],
    queryFn: () => getPendingUploads({ status: filterStatus, search: searchTerm }),
    refetchInterval: 15000
  });

  // Real-time Socket.IO listener for platform monitoring
  useEffect(() => {
    const unsubscribe = subscribeToUploadEvents((event) => {
      queryClient.invalidateQueries({ queryKey: ['super-admin-pending-uploads'] });
      push(`Platform Upload Event: ${event.eventName?.replaceAll('_', ' ')} (${event.evidenceId || event.requestId})`, { tone: 'brand' });
    });

    return () => unsubscribe();
  }, [queryClient, push]);

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  const requests = list.data?.requests || [];
  const total = list.data?.pagination?.total ?? requests.length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Platform Monitoring"
        title="Evidence Upload Pipeline Monitor"
        subtitle="Monitor global evidence upload requests, quarantine states, and permanent finalization lifecycles across all organizations."
        actions={
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => list.refetch()}
            disabled={list.isFetching}
          >
            <RefreshCw size={14} className={list.isFetching ? 'animate-spin' : ''} />
            Refresh
          </button>
        }
        meta={
          <span className="badge-brand">
            <ShieldCheck size={11} /> {total} Total Tracked
          </span>
        }
      />

      <div className="section-card flex flex-wrap items-center justify-between gap-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-muted flex items-center gap-1">
            <Filter size={13} /> Status:
          </span>
          {[
            { value: '', label: 'All' },
            { value: 'PENDING_REVIEW', label: 'Pending Review' },
            { value: 'APPROVED_PROCESSING', label: 'Processing' },
            { value: 'FINALIZED', label: 'Finalized' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'PROCESSING_FAILED', label: 'Failed' }
          ].map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn-sm ${filterStatus === f.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setFilterStatus(f.value)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative min-w-[240px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            type="text"
            className="input pl-8 py-1.5 text-xs"
            placeholder="Search Request or File..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {list.isLoading ? (
        <div className="panel p-10 text-center space-y-3">
          <RefreshCw size={24} className="animate-spin text-brand mx-auto" />
          <p className="text-xs text-ink-muted">Loading platform evidence pipeline data...</p>
        </div>
      ) : list.isError ? (
        <div className="alert-danger p-4">
          <AlertTriangle size={16} />
          <span>Failed to load platform upload data: {list.error?.message}</span>
        </div>
      ) : requests.length === 0 ? (
        <div className="panel p-12 text-center">
          <CheckCircle2 size={44} className="mx-auto mb-3 text-success" />
          <h3 className="text-base font-semibold text-ink">No Upload Requests</h3>
          <p className="mt-1 text-xs text-ink-muted">
            No evidence upload requests match the selected filters.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {requests.map((request) => (
            <div key={request._id} className="panel p-5 transition hover:shadow-card">
              <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-brand bg-brand-soft px-2 py-0.5 rounded">
                      {request.evidenceId}
                    </span>
                    <button
                      type="button"
                      className="text-ink-faint hover:text-ink text-xs inline-flex items-center gap-0.5"
                      onClick={() => handleCopy(request.evidenceId, request._id + '-evd')}
                      title="Copy ID"
                    >
                      {copiedId === request._id + '-evd' ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                    </button>
                    <StatusBadge status={request.workflowStatus} />
                    {request.caseId ? (
                      <span className="text-xs bg-surface border border-line px-2 py-0.5 rounded text-ink-muted">
                        Case: <strong className="text-ink">{request.caseId}</strong>
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs bg-[#FBFCFD] p-3 rounded-lg border border-line">
                    <div>
                      <span className="text-ink-faint block">Organization:</span>
                      <span className="font-medium text-ink block truncate">
                        {request.organizationId ? `Org ID: ${request.organizationId}` : 'None'}
                      </span>
                      <span className="text-[10px] text-ink-muted truncate block">
                        Submitter: {request.uploaderWallet?.slice(0, 10)}...
                      </span>
                    </div>

                    <div>
                      <span className="text-ink-faint block">Original File:</span>
                      <span className="font-medium text-ink block truncate">{request.fileName}</span>
                      <span className="text-[10px] text-ink-muted">
                        {formatBytes(request.fileSize)} · {request.mimeType}
                      </span>
                    </div>

                    <div>
                      <span className="text-ink-faint block">Submitted:</span>
                      <span className="font-medium text-ink block">{formatRelativeTime(request.createdAt)}</span>
                      <span className="text-[10px] text-ink-muted block">{formatDate(request.createdAt)}</span>
                    </div>

                    <div>
                      <span className="text-ink-faint block">Integrity Check:</span>
                      <span className="text-[11px] font-medium text-success">
                        {request.workflowStatus === 'FINALIZED' ? 'Passed' : 'Pending'}
                      </span>
                    </div>
                  </div>

                  {request.workflowStatus === 'FINALIZED' || request.systemFinalization?.ipfsStored ? (
                    <div className="text-xs bg-success-soft/30 border border-success/30 rounded p-2 flex items-center justify-between text-success-dark">
                      <span className="font-medium text-[11px]">
                        IPFS Storage: Verified · Blockchain Integrity: Verified
                      </span>
                      <span className="text-[10px] text-ink-faint">
                        {request.systemFinalization?.finalizedAt ? formatDate(request.systemFinalization.finalizedAt) : 'Verified'}
                      </span>
                    </div>
                  ) : null}

                  {request.rejection?.reason ? (
                    <div className="text-xs bg-danger-soft border border-danger/30 rounded p-2 text-danger">
                      <strong>Rejection Reason:</strong> {request.rejection.reason}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-2 text-right">
                  <span className="badge-neutral text-[11px] inline-flex items-center gap-1">
                    <Lock size={10} /> Image Preview Restricted to Org Admin
                  </span>
                  {request.aiAnalysis?.requested ? (
                    <span className="text-xs text-ink-muted flex items-center gap-1">
                      <Cpu size={12} /> AI Score: {request.aiAnalysis.authenticityScore ?? request.aiAnalysis.score}%
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  FileText,
  ShieldCheck,
  XCircle,
  CheckCircle2,
  AlertTriangle,
  Eye,
  Copy,
  Check,
  RefreshCw,
  Search,
  Filter,
  MapPin,
  Smartphone,
  Cpu,
  X,
  ExternalLink
} from 'lucide-react';
import {
  getPendingUploads,
  getPendingUploadById,
  approvePendingUpload,
  rejectPendingUpload,
  retryPendingFinalization,
  getPendingUploadPreviewBlob
} from '../../api/controlledUpload.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { formatBytes, formatDate, formatRelativeTime } from '../../utils/format.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { subscribeToUploadEvents } from '../../api/socket.js';

export default function PendingUploads() {
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { role, user } = useAuth();
  const { requestId } = useParams();
  const [searchParams] = useSearchParams();
  const targetRequestId = requestId || searchParams.get('requestId') || '';

  const [selectedStatus, setSelectedStatus] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [copiedId, setCopiedId] = useState('');

  // Preview modal state
  const [previewRequest, setPreviewRequest] = useState(null);
  const [previewImageUrl, setPreviewImageUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  // Reject modal state
  const [rejectModalRequest, setRejectModalRequest] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Approve note modal state
  const [approveModalRequest, setApproveModalRequest] = useState(null);
  const [approveNote, setApproveNote] = useState('');

  // Fetch pending uploads list from MongoDB
  const list = useQuery({
    queryKey: ['pending-uploads', selectedStatus, searchTerm],
    queryFn: () => getPendingUploads({ status: selectedStatus, search: searchTerm }),
    refetchInterval: 15000 // Real-time fallback
  });

  // Real-time Socket.IO subscription
  useEffect(() => {
    const unsubscribe = subscribeToUploadEvents((event) => {
      console.log('[REAL-TIME] Upload workflow event received:', event);
      queryClient.invalidateQueries({ queryKey: ['pending-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });

      if (event.eventName === 'upload_request_created') {
        push(`New evidence upload submitted: ${event.evidenceId || event.requestId}`, { tone: 'brand' });
      } else if (event.eventName === 'upload_approved') {
        push(`Evidence approved: ${event.evidenceId}`, { tone: 'success' });
      } else if (event.eventName === 'upload_rejected') {
        push(`Evidence upload rejected: ${event.evidenceId}`, { tone: 'warning' });
      } else if (event.eventName === 'finalization_completed') {
        push(`Evidence finalized and registered: ${event.evidenceId}`, { tone: 'success' });
      } else if (event.eventName === 'processing_failed') {
        push(`Processing failure for ${event.evidenceId}: ${event.error || 'Check details'}`, { tone: 'danger' });
      }
    });

    return () => unsubscribe();
  }, [queryClient, push]);

  // Copy helper
  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(''), 2000);
  };

  // Preview helper
  const handleOpenPreview = async (request) => {
    setPreviewRequest(request);
    setPreviewLoading(true);
    setPreviewError('');
    setPreviewImageUrl('');

    try {
      const blob = await getPendingUploadPreviewBlob(request._id);
      const url = URL.createObjectURL(blob);
      setPreviewImageUrl(url);
    } catch (err) {
      let errMsg = err?.message || 'Failed to load protected preview.';
      if (err?.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          if (parsed.message) errMsg = parsed.message;
        } catch {
          // ignore
        }
      } else if (err?.response?.data?.message) {
        errMsg = err.response.data.message;
      }
      setPreviewError(errMsg);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleClosePreview = () => {
    if (previewImageUrl) {
      URL.revokeObjectURL(previewImageUrl);
    }
    setPreviewRequest(null);
    setPreviewImageUrl('');
    setPreviewError('');
  };

  // Auto-open preview or scroll to request if targeted via URL param
  useEffect(() => {
    if (!targetRequestId) return;
    let isMounted = true;

    const autoInspect = async () => {
      const existing = list.data?.requests?.find(
        (r) => r._id === targetRequestId || r.evidenceId === targetRequestId
      );
      if (existing) {
        handleOpenPreview(existing);
        const el = document.getElementById(`request-${existing._id}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (!list.isLoading) {
        try {
          const single = await getPendingUploadById(targetRequestId);
          if (single && isMounted) {
            handleOpenPreview(single);
          }
        } catch (err) {
          console.warn('Could not auto-fetch request for preview:', err);
        }
      }
    };

    autoInspect();
    return () => {
      isMounted = false;
    };
  }, [targetRequestId, list.data?.requests, list.isLoading]);

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: ({ requestId, reason }) => approvePendingUpload(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-uploads'] });
      push('Upload approved! IPFS encryption and blockchain registration initiated.', { tone: 'success' });
      setApproveModalRequest(null);
      setApproveNote('');
    },
    onError: (err) => {
      push(err?.response?.data?.message || err.message || 'Approval failed.', { tone: 'danger' });
    }
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ requestId, reason }) => rejectPendingUpload(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-uploads'] });
      push('Upload rejected and quarantine file cleaned up.', { tone: 'warning' });
      setRejectModalRequest(null);
      setRejectReason('');
      setRejectError('');
    },
    onError: (err) => {
      setRejectError(err?.response?.data?.message || err.message || 'Rejection failed.');
    }
  });

  // Retry finalization mutation
  const retryMutation = useMutation({
    mutationFn: (requestId) => retryPendingFinalization(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-uploads'] });
      push('Finalization retry started.', { tone: 'brand' });
    },
    onError: (err) => {
      push(err?.response?.data?.message || err.message || 'Retry failed.', { tone: 'danger' });
    }
  });

  const requests = list.data?.requests || [];
  const total = list.data?.pagination?.total ?? requests.length;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Organization Review"
        title="Upload Approval Requests"
        subtitle="Review, inspect, and approve evidence submitted to your organization before per-file DEK encryption, IPFS pinning, and blockchain registration."
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
            <ShieldCheck size={12} /> {total} Requests
          </span>
        }
      />

      {/* Filter and Search Bar */}
      <div className="section-card flex flex-wrap items-center justify-between gap-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-muted flex items-center gap-1">
            <Filter size={13} /> Filter:
          </span>
          {[
            { value: '', label: 'All Requests' },
            { value: 'PENDING_REVIEW', label: 'Pending Review' },
            { value: 'APPROVED_PROCESSING', label: 'Processing' },
            { value: 'FINALIZED', label: 'Finalized' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: 'PROCESSING_FAILED', label: 'Failed' }
          ].map((f) => (
            <button
              key={f.value}
              type="button"
              className={`btn-sm ${selectedStatus === f.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setSelectedStatus(f.value)}
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
            placeholder="Search Case ID or File name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Content State */}
      {list.isLoading ? (
        <div className="panel p-10 text-center space-y-3">
          <RefreshCw size={24} className="animate-spin mx-auto text-brand" />
          <p className="text-sm text-ink-muted">Loading evidence upload requests...</p>
        </div>
      ) : list.isError ? (
        <div className="alert-danger p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} />
            <span>Failed to load upload requests: {list.error?.message || 'Server error'}</span>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={() => list.refetch()}>
            Retry
          </button>
        </div>
      ) : requests.length === 0 ? (
        <div className="panel p-12 text-center space-y-3">
          <CheckCircle2 size={40} className="mx-auto text-success" />
          <h3 className="text-base font-semibold text-ink">No upload requests found</h3>
          <p className="text-xs text-ink-muted max-w-sm mx-auto">
            {selectedStatus
              ? `There are no upload requests matching status "${selectedStatus}".`
              : 'All evidence upload submissions for your organization have been reviewed and processed.'}
          </p>
          {selectedStatus ? (
            <button
              type="button"
              className="btn-secondary btn-sm mt-2"
              onClick={() => setSelectedStatus('')}
            >
              Clear filter
            </button>
          ) : null}
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const isSelf = String(req.uploaderId?._id || req.uploaderId) === String(user?.id);
            const isPending = req.workflowStatus === 'PENDING_REVIEW';
            const suspicious = req.aiAnalysis?.isSuspicious;
            const isTargeted = targetRequestId && (targetRequestId === req._id || targetRequestId === req.evidenceId);

            return (
              <div
                key={req._id}
                id={`request-${req._id}`}
                className={`section-card transition p-5 border ${isTargeted ? 'ring-2 ring-brand border-brand bg-brand/[0.02]' : 'hover:border-ink-faint'}`}
              >
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  {/* Left Column: Essential details */}
                  <div className="space-y-3 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-bold text-ink bg-surface px-2 py-0.5 rounded border border-line flex items-center gap-1.5">
                        <FileText size={13} className="text-ink-muted" />
                        {req.evidenceId}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleCopy(req.evidenceId, req._id)}
                        className="text-ink-faint hover:text-ink transition"
                        title="Copy Evidence ID"
                      >
                        {copiedId === req._id ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                      </button>

                      <StatusBadge status={req.workflowStatus} />

                      {req.caseId ? (
                        <span className="text-xs bg-surface-hover text-ink-muted px-2 py-0.5 rounded border border-line">
                          Case: <strong className="text-ink">{req.caseId}</strong>
                        </span>
                      ) : null}

                      {isSelf ? (
                        <span className="text-[11px] bg-warn/10 text-warn font-medium px-2 py-0.5 rounded">
                          Your Upload (Self-review restricted)
                        </span>
                      ) : null}
                    </div>

                    {/* Metadata Grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-surface/50 p-3 rounded-lg border border-line">
                      <div>
                        <span className="text-ink-faint block">File</span>
                        <span className="font-medium text-ink truncate block" title={req.fileName}>
                          {req.fileName}
                        </span>
                        <span className="text-[11px] text-ink-muted">
                          {formatBytes(req.fileSize)} · {req.mimeType?.replace('image/', '').toUpperCase()}
                        </span>
                      </div>

                      <div>
                        <span className="text-ink-faint block">Submitter</span>
                        <span className="font-mono text-[11px] text-ink block truncate" title={req.uploaderWallet}>
                          {req.uploaderWallet ? `${req.uploaderWallet.slice(0, 6)}...${req.uploaderWallet.slice(-4)}` : 'Unknown'}
                        </span>
                        <span className="text-[11px] text-ink-muted truncate block">
                          {req.uploaderId?.profile?.displayName || 'Authorized User'}
                        </span>
                      </div>

                      <div>
                        <span className="text-ink-faint block">Submitted</span>
                        <span className="font-medium text-ink block">
                          {formatRelativeTime(req.createdAt)}
                        </span>
                        <span className="text-[11px] text-ink-muted block">
                          {formatDate(req.createdAt)}
                        </span>
                      </div>

                      <div>
                        <span className="text-ink-faint block">Organization</span>
                        <span className="font-medium text-ink block truncate">
                          {req.organizationId?.name || 'Assigned Org'}
                        </span>
                        {req.organizationId?.organizationCode ? (
                          <span className="text-[11px] text-ink-muted font-mono block">
                            Code: {req.organizationId.organizationCode}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    {/* Reason / Description */}
                    {req.description || req.reason ? (
                      <p className="text-xs text-ink-muted italic bg-surface p-2 rounded border border-line">
                        &quot;{req.description || req.reason}&quot;
                      </p>
                    ) : null}

                    {/* AI Screening / Capture Hardware Info */}
                    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-muted pt-1">
                      {req.captureMetadata?.cameraMake ? (
                        <span className="flex items-center gap-1">
                          <Smartphone size={13} className="text-ink-faint" />
                          {req.captureMetadata.cameraMake} {req.captureMetadata.cameraModel}
                        </span>
                      ) : null}

                      {req.captureMetadata?.gpsCoordinates?.latitude ? (
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          <MapPin size={13} className="text-ink-faint" />
                          {Number(req.captureMetadata.gpsCoordinates.latitude).toFixed(4)},{' '}
                          {Number(req.captureMetadata.gpsCoordinates.longitude).toFixed(4)}
                        </span>
                      ) : null}

                      {req.aiAnalysis ? (
                        <span
                          className={`flex items-center gap-1 font-medium ${
                            suspicious ? 'text-danger' : 'text-success'
                          }`}
                        >
                          <Cpu size={13} />
                          AI Score: {req.aiAnalysis.authenticityScore ?? req.aiAnalysis.score}%{' '}
                          {suspicious ? '(Potential Manipulation Flagged)' : '(Authentic)'}
                        </span>
                      ) : (
                        <span className="text-ink-faint">AI: Not requested</span>
                      )}
                    </div>

                    {/* Authoritative Verification Status when finalized */}
                    {req.workflowStatus === 'FINALIZED' || req.systemFinalization?.ipfsStored ? (
                      <div className="text-xs bg-success-soft/40 border border-success/30 rounded-lg p-2.5 flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[11.5px] text-success-dark font-medium">
                          <ShieldCheck size={14} className="text-success shrink-0" />
                          <span>IPFS Storage: Verified · Blockchain Integrity: Verified</span>
                        </div>
                        <span className="text-[11px] text-ink-faint">
                          {req.verification?.lastVerified || req.systemFinalization?.finalizedAt
                            ? `Verified ${formatDate(req.verification?.lastVerified || req.systemFinalization?.finalizedAt)}`
                            : 'Verified'}
                        </span>
                      </div>
                    ) : null}

                    {req.systemFinalization?.error ? (
                      <div className="text-xs bg-danger-soft border border-danger/30 rounded p-2 text-danger flex items-center gap-1.5">
                        <AlertTriangle size={14} className="shrink-0" />
                        <span>Processing error: {req.systemFinalization.error}</span>
                      </div>
                    ) : null}

                    {req.rejection?.reason ? (
                      <div className="text-xs bg-danger-soft border border-danger/30 rounded p-2 text-danger">
                        <strong>Rejection Reason:</strong> {req.rejection.reason}
                      </div>
                    ) : null}
                  </div>

                  {/* Right Column: Actions */}
                  <div className="flex flex-row lg:flex-col items-center lg:items-end gap-2 pt-2 lg:pt-0 shrink-0">
                    <Link
                      to={`/admin/upload-requests/${req._id}`}
                      className="btn-secondary btn-sm text-brand font-medium hover:bg-brand/5"
                      title="Open dedicated request detail page"
                    >
                      <FileText size={13} />
                      View Details
                    </Link>

                    {/* Protected Preview Button */}
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => handleOpenPreview(req)}
                      title="Inspect pending original image"
                    >
                      <Eye size={13} />
                      Inspect Original
                    </button>

                    {/* Approve / Reject buttons when pending */}
                    {isPending ? (
                      <>
                        <button
                          type="button"
                          className="btn-primary btn-sm bg-success hover:bg-success/90 text-white"
                          disabled={isSelf || approveMutation.isPending}
                          onClick={() => setApproveModalRequest(req)}
                          title={isSelf ? 'Self-approval is prohibited' : 'Accept evidence upload'}
                        >
                          <CheckCircle2 size={13} />
                          Accept Upload
                        </button>

                        <button
                          type="button"
                          className="btn-secondary btn-sm text-danger hover:bg-danger-soft"
                          disabled={rejectMutation.isPending}
                          onClick={() => {
                            setRejectModalRequest(req);
                            setRejectReason('');
                            setRejectError('');
                          }}
                          title="Reject evidence upload"
                        >
                          <XCircle size={13} />
                          Reject Upload
                        </button>
                      </>
                    ) : null}

                    {/* Retry button on processing failure */}
                    {req.workflowStatus === 'PROCESSING_FAILED' ? (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => retryMutation.mutate(req._id)}
                        disabled={retryMutation.isPending}
                      >
                        <RefreshCw size={13} className={retryMutation.isPending ? 'animate-spin' : ''} />
                        Retry Processing
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* MODAL 1: Protected Image Preview */}
      {previewRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative max-w-3xl w-full bg-card rounded-xl shadow-2xl border border-line overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-line px-5 py-3.5 bg-surface">
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  Inspect Quarantine Original: {previewRequest.fileName}
                </h3>
                <p className="text-[11px] text-ink-muted">
                  Evidence ID: {previewRequest.evidenceId} · Private quarantine storage
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1 text-ink-faint hover:text-ink hover:bg-surface-hover"
                onClick={handleClosePreview}
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-6 overflow-auto flex-1 flex flex-col items-center justify-center bg-neutral-900/5 min-h-[300px]">
              {previewLoading ? (
                <div className="text-center space-y-2 py-10">
                  <RefreshCw size={24} className="animate-spin text-brand mx-auto" />
                  <p className="text-xs text-ink-muted">Decrypting and streaming from quarantine store...</p>
                </div>
              ) : previewError ? (
                <div className="alert-danger text-xs p-4 max-w-md">
                  <AlertTriangle size={16} />
                  <span>{previewError}</span>
                </div>
              ) : previewImageUrl ? (
                <div className="space-y-3 text-center w-full">
                  <img
                    src={previewImageUrl}
                    alt={previewRequest.fileName}
                    className="max-h-[50vh] max-w-full rounded border border-line object-contain mx-auto shadow-sm"
                  />
                  <div className="text-[11.5px] text-ink-muted bg-surface p-2 rounded-full border border-line max-w-sm mx-auto flex items-center justify-center gap-1.5 shadow-xs">
                    <ShieldCheck size={13} className="text-success shrink-0" />
                    <span>Evidence Integrity: <strong className="text-ink">{previewRequest.verification?.integrityCheck || (previewRequest.workflowStatus === 'FINALIZED' ? 'Passed' : 'Pending')}</strong></span>
                  </div>
                </div>
              ) : null}

              {/* Inspection Details Section */}
              <div className="w-full mt-4 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-surface p-3 rounded-lg border border-line text-left">
                <div>
                  <span className="text-ink-faint block text-[11px]">Submitter</span>
                  <span className="font-mono text-ink text-[11px] truncate block">
                    {previewRequest.uploaderWallet}
                  </span>
                </div>
                <div>
                  <span className="text-ink-faint block text-[11px]">Case ID</span>
                  <span className="text-ink font-medium truncate block">
                    {previewRequest.caseId || 'Not specified'}
                  </span>
                </div>
                <div>
                  <span className="text-ink-faint block text-[11px]">AI Authenticity</span>
                  <span className={`font-medium block ${previewRequest.aiAnalysis?.isSuspicious ? 'text-danger' : 'text-success'}`}>
                    {previewRequest.aiAnalysis?.authenticityScore ?? previewRequest.aiAnalysis?.score ?? 'N/A'}%
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-line px-5 py-3 bg-surface flex items-center justify-between">
              <span className="text-xs text-ink-muted">
                Authorized Admin Review Session
              </span>
              <div className="flex items-center gap-2">
                {previewRequest.workflowStatus === 'PENDING_REVIEW' && role === 'admin' ? (
                  <>
                    <button
                      type="button"
                      className="btn-secondary btn-sm text-danger hover:bg-danger-soft"
                      onClick={() => {
                        const target = previewRequest;
                        handleClosePreview();
                        setRejectModalRequest(target);
                        setRejectReason('');
                        setRejectError('');
                      }}
                    >
                      <XCircle size={13} />
                      Reject Upload
                    </button>
                    <button
                      type="button"
                      className="btn-primary btn-sm bg-success hover:bg-success/90 text-white"
                      disabled={String(previewRequest.uploaderId?._id || previewRequest.uploaderId) === String(user?.id)}
                      onClick={() => {
                        const target = previewRequest;
                        handleClosePreview();
                        setApproveModalRequest(target);
                      }}
                    >
                      <CheckCircle2 size={13} />
                      Accept Upload
                    </button>
                  </>
                ) : null}
                <button type="button" className="btn-secondary btn-sm" onClick={handleClosePreview}>
                  Close Inspector
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL 2: Approve Confirmation */}
      {approveModalRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-card rounded-xl shadow-2xl border border-line p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="p-2 rounded-full bg-success-soft text-success">
                <CheckCircle2 size={20} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">Approve Evidence Upload</h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Request {approveModalRequest.evidenceId} will be encrypted with a per-file DEK, pinned to IPFS, and registered on the blockchain.
                </p>
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink">Approval note / reason (optional):</span>
              <textarea
                className="textarea min-h-[70px] text-xs"
                placeholder="Approved following standard evidence review protocol..."
                value={approveNote}
                onChange={(e) => setApproveNote(e.target.value)}
              />
            </label>

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setApproveModalRequest(null)}
                disabled={approveMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary btn-sm bg-success hover:bg-success/90 text-white"
                onClick={() =>
                  approveMutation.mutate({
                    requestId: approveModalRequest._id,
                    reason: approveNote
                  })
                }
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? 'Committing...' : 'Confirm Acceptance'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL 3: Reject Confirmation (Reason Required) */}
      {rejectModalRequest ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-card rounded-xl shadow-2xl border border-line p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="p-2 rounded-full bg-danger-soft text-danger">
                <XCircle size={20} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">Reject Evidence Upload</h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  This will mark request {rejectModalRequest.evidenceId} as rejected, delete the quarantine file, and notify the uploader. A rejection reason is required.
                </p>
              </div>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-ink">
                Rejection reason <span className="text-danger">*</span>:
              </span>
              <textarea
                className="textarea min-h-[80px] text-xs"
                placeholder="Explain why this upload is rejected (e.g., blurry image, invalid context, unauthorized case assignment)..."
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                required
              />
            </label>

            {rejectError ? (
              <p className="text-xs text-danger">{rejectError}</p>
            ) : null}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setRejectModalRequest(null)}
                disabled={rejectMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-danger btn-sm"
                onClick={() => {
                  if (!rejectReason.trim()) {
                    setRejectError('Please enter a rejection reason.');
                    return;
                  }
                  rejectMutation.mutate({
                    requestId: rejectModalRequest._id,
                    reason: rejectReason
                  });
                }}
                disabled={rejectMutation.isPending || !rejectReason.trim()}
              >
                {rejectMutation.isPending ? 'Rejecting...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

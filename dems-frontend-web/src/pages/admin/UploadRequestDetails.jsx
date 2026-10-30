import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
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
  MapPin,
  Smartphone,
  Cpu,
  Lock,
  User,
  Building2,
  Hash,
  ExternalLink,
  ShieldAlert
} from 'lucide-react';

import {
  getPendingUploadById,
  approvePendingUpload,
  rejectPendingUpload,
  retryPendingFinalization,
  getPendingUploadPreviewBlob
} from '../../api/controlledUpload.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import VerificationStatusPanel from '../../components/verification/VerificationStatusPanel.jsx';
import { formatBytes, formatDate, formatRelativeTime } from '../../utils/format.js';
import { useToast } from '../../components/ui/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { subscribeToUploadEvents } from '../../api/socket.js';

export default function UploadRequestDetails() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { push } = useToast();
  const { role, user } = useAuth();

  const [copiedField, setCopiedField] = useState('');
  const [previewImageUrl, setPreviewImageUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(true);
  const [previewError, setPreviewError] = useState('');

  // Modals state
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [approveNote, setApproveNote] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Fetch single request details
  const requestQuery = useQuery({
    queryKey: ['pending-upload-detail', requestId],
    queryFn: () => getPendingUploadById(requestId),
    enabled: Boolean(requestId),
    retry: 1
  });

  const request = requestQuery.data;

  // Real-time Socket.IO subscription
  useEffect(() => {
    const unsubscribe = subscribeToUploadEvents((event) => {
      if (event.requestId === requestId || event.evidenceId === request?.evidenceId) {
        queryClient.invalidateQueries({ queryKey: ['pending-upload-detail', requestId] });
        queryClient.invalidateQueries({ queryKey: ['pending-uploads'] });
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard-pending-uploads'] });

        if (event.eventName === 'upload_approved') {
          push('Upload request has been approved! Background finalization started.', { tone: 'success' });
        } else if (event.eventName === 'upload_rejected') {
          push('Upload request has been rejected.', { tone: 'warning' });
        } else if (event.eventName === 'finalization_completed') {
          push('Evidence successfully pinned to IPFS and registered on blockchain!', { tone: 'success' });
        } else if (event.eventName === 'processing_failed') {
          push(`Finalization failed: ${event.error || 'Check error details'}`, { tone: 'danger' });
        }
      }
    });

    return () => unsubscribe();
  }, [requestId, request?.evidenceId, queryClient, push]);

  // Load protected image preview securely
  useEffect(() => {
    let isMounted = true;
    let objectUrl = '';

    const loadPreview = async () => {
      if (!requestId) return;

      // Only attempt preview if temporary file is stored
      if (request && request.cleanupStatus === 'CLEANED') {
        setPreviewLoading(false);
        setPreviewError('Temporary quarantine file has been permanently deleted after review decision.');
        return;
      }

      setPreviewLoading(true);
      setPreviewError('');

      try {
        const blob = await getPendingUploadPreviewBlob(requestId);
        if (isMounted) {
          objectUrl = URL.createObjectURL(blob);
          setPreviewImageUrl(objectUrl);
        }
      } catch (err) {
        if (!isMounted) return;
        let errMsg = 'Failed to load protected preview image.';
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
        } else if (err?.message) {
          errMsg = err.message;
        }
        setPreviewError(errMsg);
      } finally {
        if (isMounted) setPreviewLoading(false);
      }
    };

    loadPreview();

    return () => {
      isMounted = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requestId, request?.cleanupStatus]);

  // Copy helper
  const handleCopy = (text, fieldName) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(''), 2000);
  };

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: ({ reason }) => approvePendingUpload(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-upload-detail', requestId] });
      queryClient.invalidateQueries({ queryKey: ['pending-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard-pending-uploads'] });
      push('Upload approved! Permanent IPFS encryption and blockchain registration initiated.', { tone: 'success' });
      setShowApproveModal(false);
      setApproveNote('');
    },
    onError: (err) => {
      push(err?.response?.data?.message || err.message || 'Approval failed.', { tone: 'danger' });
    }
  });

  // Reject mutation
  const rejectMutation = useMutation({
    mutationFn: ({ reason }) => rejectPendingUpload(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-upload-detail', requestId] });
      queryClient.invalidateQueries({ queryKey: ['pending-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard-pending-uploads'] });
      push('Upload rejected and quarantine file cleaned up.', { tone: 'warning' });
      setShowRejectModal(false);
      setRejectReason('');
      setRejectError('');
    },
    onError: (err) => {
      setRejectError(err?.response?.data?.message || err.message || 'Rejection failed.');
    }
  });

  // Retry finalization mutation
  const retryMutation = useMutation({
    mutationFn: () => retryPendingFinalization(requestId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pending-upload-detail', requestId] });
      push('Finalization retry initiated.', { tone: 'brand' });
    },
    onError: (err) => {
      push(err?.response?.data?.message || err.message || 'Retry failed.', { tone: 'danger' });
    }
  });

  if (requestQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link to="/admin/upload-requests" className="btn-ghost btn-sm">
            <ArrowLeft size={14} /> Back to Upload Requests
          </Link>
        </div>
        <div className="panel p-12 text-center space-y-3">
          <RefreshCw size={28} className="animate-spin text-brand mx-auto" />
          <h3 className="text-sm font-semibold text-ink">Loading evidence upload request...</h3>
          <p className="text-xs text-ink-muted">Retrieving submission details from database...</p>
        </div>
      </div>
    );
  }

  if (requestQuery.isError || !request) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link to="/admin/upload-requests" className="btn-ghost btn-sm">
            <ArrowLeft size={14} /> Back to Upload Requests
          </Link>
        </div>
        <div className="panel p-12 text-center space-y-3">
          <AlertTriangle size={36} className="text-danger mx-auto" />
          <h3 className="text-base font-semibold text-ink">Upload Request Not Found</h3>
          <p className="text-xs text-ink-muted max-w-md mx-auto">
            {requestQuery.error?.response?.data?.message ||
              requestQuery.error?.message ||
              `The requested evidence upload (${requestId}) does not exist or has been removed.`}
          </p>
          <div className="pt-2">
            <Link to="/admin/upload-requests" className="btn-primary btn-sm">
              Return to Upload Approval Requests
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isSelf = String(request.uploaderId?._id || request.uploaderId) === String(user?.id);
  const isPending = request.workflowStatus === 'PENDING_REVIEW';
  const suspicious = request.aiAnalysis?.isSuspicious;

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link
          to="/admin/upload-requests"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-muted hover:text-ink transition"
        >
          <ArrowLeft size={14} /> Back to Upload Approval Requests
        </Link>

        {isPending && role === 'admin' ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-secondary btn-sm text-danger hover:bg-danger-soft"
              disabled={rejectMutation.isPending}
              onClick={() => {
                setShowRejectModal(true);
                setRejectReason('');
                setRejectError('');
              }}
            >
              <XCircle size={14} />
              Reject Upload
            </button>
            <button
              type="button"
              className="btn-primary btn-sm bg-success hover:bg-success/90 text-white"
              disabled={isSelf || approveMutation.isPending}
              onClick={() => setShowApproveModal(true)}
              title={isSelf ? 'Self-approval is prohibited' : 'Accept evidence upload'}
            >
              <CheckCircle2 size={14} />
              Accept Upload
            </button>
          </div>
        ) : null}
      </div>

      <PageHeader
        eyebrow="Evidence Inspection & Decision"
        title={request.fileName}
        subtitle={`Submitted for ${request.organizationId?.name || 'Assigned Organization'} · Evidence ID: ${request.evidenceId}`}
        meta={
          <div className="flex items-center gap-2">
            <StatusBadge status={request.workflowStatus} />
            {isSelf ? (
              <span className="text-[11px] bg-warn/10 text-warn font-medium px-2 py-0.5 rounded">
                Your Upload (Self-review restricted)
              </span>
            ) : null}
          </div>
        }
      />

      {/* Main Two-Column Layout */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        {/* Left Column: Protected Image Inspection */}
        <div className="space-y-5">
          <section className="section-card">
            <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Lock size={16} className="text-brand" />
                <h2 className="text-sm font-semibold text-ink">Quarantine Image Inspection</h2>
              </div>
              <span className="text-[11px] text-ink-faint font-mono">
                {request.mimeType?.replace('image/', '').toUpperCase()} · {formatBytes(request.fileSize)}
              </span>
            </div>

            {/* Image Preview Container */}
            <div className="rounded-xl border border-line bg-neutral-900/5 p-4 flex flex-col items-center justify-center min-h-[340px]">
              {previewLoading ? (
                <div className="text-center space-y-2 py-16">
                  <RefreshCw size={26} className="animate-spin text-brand mx-auto" />
                  <p className="text-xs font-medium text-ink">Streaming from quarantine storage...</p>
                  <p className="text-[11px] text-ink-muted">Decrypting temporary image with organization key...</p>
                </div>
              ) : previewError ? (
                <div className="alert-danger text-xs p-4 max-w-md text-center space-y-2">
                  <AlertTriangle size={18} className="mx-auto" />
                  <p className="font-medium">{previewError}</p>
                  <p className="text-[11px] text-ink-muted">
                    {request.cleanupStatus === 'CLEANED'
                      ? 'The temporary file was securely wiped following decision.'
                      : 'Ensure you have Organization Admin authorization to preview quarantined files.'}
                  </p>
                </div>
              ) : previewImageUrl ? (
                <div className="space-y-3 w-full text-center">
                  <img
                    src={previewImageUrl}
                    alt={request.fileName}
                    className="max-h-[55vh] max-w-full rounded-lg border border-line object-contain mx-auto shadow-md bg-card"
                  />
                  <div className="inline-flex items-center gap-2 text-[11.5px] bg-surface px-3 py-1.5 rounded-full border border-line text-ink-muted shadow-xs">
                    <ShieldCheck size={13} className="text-success shrink-0" />
                    <span>Evidence integrity check: <strong className="text-ink">{request.verification?.integrityCheck || (request.workflowStatus === 'FINALIZED' ? 'Passed' : 'Pending')}</strong></span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex items-center justify-between text-[11.5px] text-ink-muted bg-surface p-2.5 rounded-lg border border-line">
              <span className="flex items-center gap-1.5">
                <ShieldCheck size={14} className="text-success" />
                Decrypted strictly in-memory · Not publicly accessible
              </span>
              <span className="font-mono text-ink-faint">
                Storage: {request.cleanupStatus === 'CLEANED' ? 'Cleaned' : 'Private Quarantine'}
              </span>
            </div>

            {/* Decision Controls Below Image */}
            {isPending && role === 'admin' ? (
              <div className="mt-5 border-t border-line pt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-ink-muted">
                  Inspect image integrity and metadata before deciding.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="btn-secondary btn-sm text-danger hover:bg-danger-soft"
                    disabled={rejectMutation.isPending}
                    onClick={() => {
                      setShowRejectModal(true);
                      setRejectReason('');
                      setRejectError('');
                    }}
                  >
                    <XCircle size={14} />
                    Reject Upload
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-sm bg-success hover:bg-success/90 text-white"
                    disabled={isSelf || approveMutation.isPending}
                    onClick={() => setShowApproveModal(true)}
                    title={isSelf ? 'Self-approval is prohibited' : 'Accept evidence upload'}
                  >
                    <CheckCircle2 size={14} />
                    Accept Upload
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          {/* AI Screening Assessment */}
          <section className="section-card">
            <div className="flex items-center justify-between border-b border-line pb-2.5 mb-3">
              <div className="flex items-center gap-2">
                <Cpu size={15} className="text-brand" />
                <h3 className="text-xs font-semibold text-ink">AI Screening & Authenticity Analysis</h3>
              </div>
              {request.aiAnalysis ? (
                <span className={`badge text-[11px] ${suspicious ? 'badge-danger' : 'badge-success'}`}>
                  {suspicious ? 'Manipulation Flagged' : 'Authentic'}
                </span>
              ) : (
                <span className="badge-neutral text-[11px]">Not Evaluated</span>
              )}
            </div>

            {request.aiAnalysis ? (
              <div className="space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3 bg-surface p-3 rounded-lg border border-line">
                  <div>
                    <span className="text-ink-faint block text-[11px]">Authenticity Score</span>
                    <span className="text-base font-bold text-ink">
                      {request.aiAnalysis.authenticityScore ?? request.aiAnalysis.score ?? 'N/A'}%
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-faint block text-[11px]">Screening Result</span>
                    <span className={`font-medium ${suspicious ? 'text-danger' : 'text-success'}`}>
                      {suspicious ? 'Flagged for Potential Manipulation' : 'Passes Standard Screening'}
                    </span>
                  </div>
                </div>

                {request.aiAnalysis.details || request.aiAnalysis.flags?.length ? (
                  <div className="bg-surface/50 p-2.5 rounded border border-line text-ink-muted">
                    <p className="font-medium text-ink text-[11.5px] mb-1">Analysis Flags:</p>
                    <p className="text-[11.5px]">
                      {Array.isArray(request.aiAnalysis.flags)
                        ? request.aiAnalysis.flags.join(', ')
                        : JSON.stringify(request.aiAnalysis.details || request.aiAnalysis.flags)}
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-ink-muted">No AI screening was requested or performed on this evidence.</p>
            )}
          </section>
        </div>

        {/* Right Column: Metadata & Audit Information */}
        <div className="space-y-5">
          {/* Submission Information Card */}
          <section className="section-card space-y-3">
            <h3 className="text-xs font-semibold text-ink border-b border-line pb-2">
              Submission & Case Details
            </h3>

            <div className="space-y-2.5 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">Evidence ID</span>
                <span className="font-mono text-ink flex items-center gap-1 font-semibold">
                  {request.evidenceId}
                  <button
                    type="button"
                    onClick={() => handleCopy(request.evidenceId, 'evidenceId')}
                    className="text-ink-muted hover:text-ink"
                  >
                    {copiedField === 'evidenceId' ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                  </button>
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">Case ID</span>
                <span className="font-medium text-ink">{request.caseId || 'Not specified'}</span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">Organization</span>
                <span className="font-medium text-ink">
                  {request.organizationId?.name || 'Assigned Org'}
                  {request.organizationId?.organizationCode ? ` (${request.organizationId.organizationCode})` : ''}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">Submitter Wallet</span>
                <span className="font-mono text-ink text-[11px] truncate max-w-[180px] flex items-center gap-1">
                  {request.uploaderWallet}
                  <button
                    type="button"
                    onClick={() => handleCopy(request.uploaderWallet, 'wallet')}
                    className="text-ink-muted hover:text-ink shrink-0"
                  >
                    {copiedField === 'wallet' ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                  </button>
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">Submitter Name</span>
                <span className="font-medium text-ink">
                  {request.uploaderId?.profile?.displayName || 'Authorized Member'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">Submitted At</span>
                <span className="text-ink">
                  {formatDate(request.createdAt)} ({formatRelativeTime(request.createdAt)})
                </span>
              </div>

              {request.description || request.reason ? (
                <div className="pt-2">
                  <span className="text-ink-faint block text-[11px] mb-1">Description / Reason</span>
                  <p className="bg-surface p-2.5 rounded border border-line text-ink-muted italic">
                    &quot;{request.description || request.reason}&quot;
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          {/* Capture Hardware & EXIF Details */}
          <section className="section-card space-y-3">
            <h3 className="text-xs font-semibold text-ink border-b border-line pb-2 flex items-center gap-1.5">
              <Smartphone size={14} className="text-brand" />
              Capture Metadata
            </h3>

            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">Device Model</span>
                <span className="font-medium text-ink">
                  {request.captureMetadata?.cameraMake
                    ? `${request.captureMetadata.cameraMake} ${request.captureMetadata.cameraModel || ''}`
                    : 'Unknown / Stripped from original'}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">Capture Timestamp</span>
                <span className="text-ink">
                  {request.captureMetadata?.captureTimestamp
                    ? formatDate(request.captureMetadata.captureTimestamp)
                    : formatDate(request.createdAt)}
                </span>
              </div>

              <div className="flex items-center justify-between py-1 border-b border-line/60">
                <span className="text-ink-faint">GPS Coordinates</span>
                {request.captureMetadata?.gpsCoordinates?.latitude ? (
                  <span className="font-mono text-[11px] text-ink flex items-center gap-1">
                    <MapPin size={12} className="text-brand" />
                    {Number(request.captureMetadata.gpsCoordinates.latitude).toFixed(4)},{' '}
                    {Number(request.captureMetadata.gpsCoordinates.longitude).toFixed(4)}
                  </span>
                ) : (
                  <span className="text-ink-faint">Not embedded</span>
                )}
              </div>
            </div>
          </section>

          {/* Authoritative Verification Status Panel */}
          <section className="space-y-3">
            <VerificationStatusPanel item={request} />

            {request.orgAdminApproval?.note ? (
              <div className="section-card text-xs">
                <span className="text-ink-faint block text-[11px] font-medium uppercase tracking-wider mb-1">
                  Admin Approval Note
                </span>
                <p className="bg-surface p-2.5 rounded-lg border border-line text-ink-muted text-[11.5px]">
                  &quot;{request.orgAdminApproval.note}&quot;
                </p>
              </div>
            ) : null}
          </section>

          {/* Rejection Outcome */}
          {request.workflowStatus === 'REJECTED' ? (
            <section className="section-card border-danger/30 bg-danger-soft/10 space-y-3">
              <h3 className="text-xs font-semibold text-danger border-b border-danger/20 pb-2 flex items-center gap-1.5">
                <XCircle size={14} className="text-danger" />
                Upload Rejected
              </h3>

              <div className="space-y-2 text-xs">
                <div>
                  <span className="text-ink-faint block text-[11px]">Rejection Reason</span>
                  <p className="bg-card p-2.5 rounded border border-danger/20 text-danger text-xs font-medium">
                    {request.rejection?.reason || 'No specific reason provided.'}
                  </p>
                </div>
                <div className="text-[11px] text-ink-faint">
                  Temporary file deleted · Upload terminated
                </div>
              </div>
            </section>
          ) : null}

          {/* Processing Failure Card */}
          {request.workflowStatus === 'PROCESSING_FAILED' ? (
            <section className="section-card border-danger/30 bg-danger-soft/10 space-y-3">
              <h3 className="text-xs font-semibold text-danger border-b border-danger/20 pb-2 flex items-center gap-1.5">
                <AlertTriangle size={14} className="text-danger" />
                Permanent Processing Failure
              </h3>

              <p className="text-xs text-danger font-medium">
                {request.systemFinalization?.error || 'Failed during encryption or IPFS/blockchain registration.'}
              </p>

              <button
                type="button"
                className="btn-primary btn-sm"
                onClick={() => retryMutation.mutate()}
                disabled={retryMutation.isPending}
              >
                <RefreshCw size={13} className={retryMutation.isPending ? 'animate-spin' : ''} />
                {retryMutation.isPending ? 'Retrying...' : 'Retry Finalization Pipeline'}
              </button>
            </section>
          ) : null}
        </div>
      </div>

      {/* MODAL 1: Approve Confirmation */}
      {showApproveModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-card rounded-xl shadow-2xl border border-line p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="p-2 rounded-full bg-success-soft text-success">
                <CheckCircle2 size={20} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">Confirm Evidence Approval</h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  Request {request.evidenceId} will be encrypted with a unique per-file DEK, pinned permanently to IPFS, and registered on the blockchain.
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
                onClick={() => setShowApproveModal(false)}
                disabled={approveMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-primary btn-sm bg-success hover:bg-success/90 text-white"
                onClick={() => approveMutation.mutate({ reason: approveNote })}
                disabled={approveMutation.isPending}
              >
                {approveMutation.isPending ? 'Committing...' : 'Confirm Acceptance'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* MODAL 2: Reject Confirmation (Reason Required) */}
      {showRejectModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="max-w-md w-full bg-card rounded-xl shadow-2xl border border-line p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="p-2 rounded-full bg-danger-soft text-danger">
                <XCircle size={20} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-ink">Reject Evidence Upload</h3>
                <p className="text-xs text-ink-muted mt-0.5">
                  This will mark request {request.evidenceId} as rejected, permanently delete the temporary quarantine file, and notify the submitter.
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

            {rejectError ? <p className="text-xs text-danger">{rejectError}</p> : null}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-line">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => setShowRejectModal(false)}
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
                  rejectMutation.mutate({ reason: rejectReason });
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

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgeCheck,
  ClipboardList,
  FolderLock,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
  FolderTree,
  UploadCloud,
  Eye,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RefreshCw,
  FileText,
  Copy,
  Check,
  Smartphone,
  MapPin,
  Cpu,
  X
} from 'lucide-react';

import { getOrganizationOverview, getOrganization } from '../../api/admin.js';
import { getOrganizationAnalytics } from '../../api/analytics.js';
import {
  getPendingUploads,
  approvePendingUpload,
  rejectPendingUpload,
  getPendingUploadPreviewBlob
} from '../../api/controlledUpload.js';
import { getWorkflowCounts } from '../../api/viewAccess.js';
import { subscribeToUploadEvents, subscribeToViewAccessEvents } from '../../api/socket.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import StatCard from '../../components/ui/StatCard.jsx';
import InviteEmployee from '../../components/InviteEmployee.jsx';
import { StatCardSkeleton } from '../../components/ui/Skeleton.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { formatBytes, formatDate, formatRelativeTime } from '../../utils/format.js';
import { useToast } from '../../components/ui/Toast.jsx';

const ACTIVITY_LABELS = {
  upload: 'File uploaded',
  ipfs_storage: 'Stored on IPFS',
  quarantine: 'File quarantined',
  membership_application_review: 'Membership reviewed',
  employee_approval: 'Employee approved',
  employee_rejection: 'Employee rejected',
  blockchain_transaction: 'Blockchain transaction',
  evidence_access: 'File accessed',
  pending_upload_created: 'Upload request submitted',
  pending_upload_approved: 'Upload request approved',
  pending_upload_rejected: 'Upload request rejected',
  evidence_finalized: 'Evidence finalized'
};

export default function AdminDashboard() {
  const { user } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [copiedId, setCopiedId] = useState('');

  // Modals state for dashboard actions
  const [previewRequest, setPreviewRequest] = useState(null);
  const [previewImageUrl, setPreviewImageUrl] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const [approveModalRequest, setApproveModalRequest] = useState(null);
  const [approveNote, setApproveNote] = useState('');

  const [rejectModalRequest, setRejectModalRequest] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Main queries
  const overview = useQuery({ queryKey: ['org-overview'], queryFn: getOrganizationOverview });
  const organization = useQuery({ queryKey: ['organization'], queryFn: getOrganization });
  const analytics = useQuery({ queryKey: ['analytics', 'organization'], queryFn: getOrganizationAnalytics });
  const workflowCountsQuery = useQuery({ queryKey: ['workflow-counts'], queryFn: getWorkflowCounts, refetchInterval: 15000 });

  // Query pending uploads for dashboard review section
  const [selectedUploadStatus, setSelectedUploadStatus] = useState('PENDING_REVIEW');

  // Query pending uploads for dashboard review section
  const pendingUploadsQuery = useQuery({
    queryKey: ['admin-dashboard-pending-uploads', selectedUploadStatus],
    queryFn: () => getPendingUploads({ status: selectedUploadStatus, limit: 6 }),
    refetchInterval: 15000
  });

  // Socket.IO real-time subscriptions
  useEffect(() => {
    const unsub = subscribeToUploadEvents((event) => {
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard-pending-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });

      if (event.eventName === 'upload_request_created') {
        push(`New evidence upload submitted for review: ${event.evidenceId || event.requestId}`, { tone: 'brand' });
      } else if (event.eventName === 'upload_approved') {
        push(`Evidence upload approved: ${event.evidenceId}`, { tone: 'success' });
      } else if (event.eventName === 'upload_rejected') {
        push(`Evidence upload rejected: ${event.evidenceId}`, { tone: 'warning' });
      } else if (event.eventName === 'finalization_completed') {
        push(`Evidence finalized and registered: ${event.evidenceId}`, { tone: 'success' });
      }
    });

    const unsubView = subscribeToViewAccessEvents((event) => {
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (event.eventName === 'view_access_request_created') {
        push(`Super Admin requested view access: ${event.requestId}`, { tone: 'brand' });
      } else if (event.eventName === 'view_access_approved') {
        push(`View access approved: ${event.requestId}`, { tone: 'success' });
      }
    });

    return () => {
      unsub();
      unsubView();
    };
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

  // Approve mutation
  const approveMutation = useMutation({
    mutationFn: ({ requestId, reason }) => approvePendingUpload(requestId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard-pending-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
      push('Upload approved! Per-file DEK encryption and blockchain registration initiated.', { tone: 'success' });
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
      queryClient.invalidateQueries({ queryKey: ['admin-dashboard-pending-uploads'] });
      queryClient.invalidateQueries({ queryKey: ['org-overview'] });
      push('Upload rejected and temporary file cleaned up.', { tone: 'warning' });
      setRejectModalRequest(null);
      setRejectReason('');
      setRejectError('');
    },
    onError: (err) => {
      setRejectError(err?.response?.data?.message || err.message || 'Rejection failed.');
    }
  });

  const data = overview.data || {};
  const activity = analytics.data?.recentActivity || [];
  const loading = overview.isLoading;
  const pendingRequests = pendingUploadsQuery.data?.requests || [];
  const totalPending = pendingUploadsQuery.data?.pagination?.total ?? (data.pendingUploads ?? pendingRequests.length);
  const workflowCounts = workflowCountsQuery.data?.data || {};

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={organization.data?.name || 'Organization workspace'}
        title="Organization overview"
        subtitle="Manage employees, files, and verification activity for your organization."
        actions={
          <>
            <button type="button" className="btn-secondary" onClick={() => setShowInviteForm((current) => !current)}>
              <UserPlus size={15} />
              {showInviteForm ? 'Cancel' : 'Invite employee'}
            </button>
            <Link to="/admin/view-requests" className="btn-secondary">
              <Eye size={15} />
              View Access ({workflowCounts.pendingViewApprovals || 0})
            </Link>
            <Link to="/admin/upload-requests" className="btn-secondary">
              <UploadCloud size={15} />
              Upload Requests ({data.pendingUploads ?? totalPending ?? 0})
            </Link>
            <Link to="/admin/evidence" className="btn-primary">
              <FolderLock size={15} />
              Browse files
            </Link>
          </>
        }
      />

      {showInviteForm ? (
        <InviteEmployee
          onSuccess={() => setShowInviteForm(false)}
          onCancel={() => setShowInviteForm(false)}
        />
      ) : null}

      {/* Metric Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {loading ? (
          Array.from({ length: 5 }).map((_, index) => <StatCardSkeleton key={index} />)
        ) : (
          <>
            <StatCard
              icon={FolderLock}
              label="Organization Files"
              value={data.totalEvidence ?? 0}
              detail="Stored under this organization"
              tone="brand"
            />
            <StatCard
              icon={Users}
              label="Active Employees"
              value={data.employees ?? 0}
              detail="Members with approved access"
              tone="neutral"
            />
            <StatCard
              icon={UploadCloud}
              label="Upload Requests"
              value={data.pendingUploads ?? totalPending ?? 0}
              detail={(data.pendingUploads ?? totalPending) > 0 ? 'Awaiting your approval decision' : 'No uploads pending review'}
              tone={(data.pendingUploads ?? totalPending) > 0 ? 'warn' : 'neutral'}
            />
            <Link to="/admin/view-requests" className="block transition hover:opacity-90">
              <StatCard
                icon={Eye}
                label="View Access Requests"
                value={workflowCounts.pendingViewApprovals ?? 0}
                detail={(workflowCounts.pendingViewApprovals ?? 0) > 0 ? `${workflowCounts.pendingViewApprovals} awaiting your approval` : 'No view requests pending review'}
                tone={(workflowCounts.pendingViewApprovals ?? 0) > 0 ? 'success' : 'neutral'}
              />
            </Link>
            <StatCard
              icon={ShieldCheck}
              label="Blockchain Verified"
              value={data.blockchain ?? 0}
              detail="Confirmed on-chain proofs"
              tone="success"
            />
          </>
        )}
      </div>

      {/* Alert Banner for Pending View Access Requests */}
      {workflowCounts.pendingViewApprovals > 0 ? (
        <div className="flex items-center justify-between rounded-[9px] border border-brand/30 bg-brand-soft px-4 py-3">
          <div className="flex items-center gap-2.5 text-[13px] font-medium text-brand">
            <Eye size={17} />
            <span>You have <strong>{workflowCounts.pendingViewApprovals}</strong> view access request(s) awaiting your review.</span>
          </div>
          <Link to="/admin/view-requests" className="btn-primary btn-sm">
            Review View Requests
            <ArrowRight size={13} />
          </Link>
        </div>
      ) : null}

      {/* Dedicated Upload Requests Section */}
      <section className="panel overflow-hidden">
        <div className="card-header border-b border-line px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 bg-surface/50">
          <div>
            <div className="flex items-center gap-2">
              <UploadCloud size={17} className="text-brand" />
              <h2 className="section-title">Upload Approval Requests</h2>
              {totalPending > 0 ? (
                <span className="badge-warn text-[11px]">{totalPending} awaiting decision</span>
              ) : null}
            </div>
            <p className="section-subtitle mt-0.5">
              Review, inspect quarantined images, and approve or reject submissions before blockchain registration
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => pendingUploadsQuery.refetch()}
              disabled={pendingUploadsQuery.isFetching}
              title="Refresh upload requests"
            >
              <RefreshCw size={13} className={pendingUploadsQuery.isFetching ? 'animate-spin' : ''} />
              Refresh
            </button>
            <Link to="/admin/upload-requests" className="btn-secondary btn-sm">
              View all requests ({totalPending})
              <ArrowRight size={13} />
            </Link>
          </div>
        </div>

        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1.5 px-5 py-2.5 bg-surface/40 border-b border-line text-xs">
          <span className="text-ink-muted text-[11.5px] mr-1 font-medium">Filter status:</span>
          {[
            { value: 'PENDING_REVIEW', label: 'Pending Review' },
            { value: 'APPROVED_PROCESSING', label: 'Processing' },
            { value: 'FINALIZED', label: 'Finalized' },
            { value: 'REJECTED', label: 'Rejected' },
            { value: '', label: 'All' }
          ].map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={`px-2.5 py-1 rounded text-xs transition ${
                selectedUploadStatus === tab.value
                  ? 'bg-brand text-white font-medium shadow-sm'
                  : 'bg-card text-ink-muted hover:text-ink hover:bg-surface border border-line'
              }`}
              onClick={() => setSelectedUploadStatus(tab.value)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {pendingUploadsQuery.isLoading ? (
          <div className="p-8 text-center space-y-2">
            <RefreshCw size={22} className="animate-spin text-brand mx-auto" />
            <p className="text-xs text-ink-muted">Loading pending evidence upload requests...</p>
          </div>
        ) : pendingUploadsQuery.isError ? (
          <div className="p-4 m-4 alert-danger flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle size={15} />
              <span>Failed to load upload requests: {pendingUploadsQuery.error?.message}</span>
            </div>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => pendingUploadsQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : pendingRequests.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <CheckCircle2 size={36} className="mx-auto text-success" />
            <h3 className="text-sm font-semibold text-ink">All upload requests reviewed</h3>
            <p className="text-xs text-ink-muted max-w-md mx-auto">
              There are currently no evidence submissions awaiting your review. New uploads from authorized users will appear here immediately.
            </p>
            <div className="pt-2">
              <Link to="/admin/upload-requests" className="text-xs text-brand hover:underline">
                View completed upload history →
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {pendingRequests.map((req) => {
              const isSelf = String(req.uploaderId?._id || req.uploaderId) === String(user?.id);
              const suspicious = req.aiAnalysis?.isSuspicious;

              return (
                <div key={req._id} className="p-5 hover:bg-surface/30 transition">
                  <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                    {/* Left Column: Details */}
                    <div className="space-y-2.5 flex-1 min-w-0">
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
                            Your Upload (Self-approval restricted)
                          </span>
                        ) : null}
                      </div>

                      {/* Summary Data Grid */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs bg-surface/60 p-2.5 rounded-lg border border-line">
                        <div>
                          <span className="text-ink-faint block text-[11px]">File name</span>
                          <span className="font-medium text-ink truncate block" title={req.fileName}>
                            {req.fileName}
                          </span>
                          <span className="text-[11px] text-ink-muted">
                            {formatBytes(req.fileSize)} · {req.mimeType?.replace('image/', '').toUpperCase()}
                          </span>
                        </div>

                        <div>
                          <span className="text-ink-faint block text-[11px]">Submitter</span>
                          <span className="font-mono text-[11px] text-ink block truncate" title={req.uploaderWallet}>
                            {req.uploaderWallet ? `${req.uploaderWallet.slice(0, 6)}...${req.uploaderWallet.slice(-4)}` : 'Unknown'}
                          </span>
                          <span className="text-[11px] text-ink-muted truncate block">
                            {req.uploaderId?.profile?.displayName || 'Authorized User'}
                          </span>
                        </div>

                        <div>
                          <span className="text-ink-faint block text-[11px]">Submission Time</span>
                          <span className="font-medium text-ink block">
                            {formatRelativeTime(req.createdAt)}
                          </span>
                          <span className="text-[11px] text-ink-muted block">
                            {formatDate(req.createdAt)}
                          </span>
                        </div>

                        <div>
                          <span className="text-ink-faint block text-[11px]">AI Screening</span>
                          {req.aiAnalysis ? (
                            <span className={`font-medium block ${suspicious ? 'text-danger' : 'text-success'}`}>
                              {req.aiAnalysis.authenticityScore ?? req.aiAnalysis.score}% {suspicious ? 'Flagged' : 'Authentic'}
                            </span>
                          ) : (
                            <span className="text-ink-faint block">Not requested</span>
                          )}
                        </div>
                      </div>

                      {/* Reason / Context */}
                      {req.description || req.reason ? (
                        <p className="text-xs text-ink-muted italic bg-surface/80 p-2 rounded border border-line">
                          &quot;{req.description || req.reason}&quot;
                        </p>
                      ) : null}
                    </div>

                    {/* Right Column: Direct Actions */}
                    <div className="flex flex-row lg:flex-col items-center lg:items-end gap-2 pt-1 lg:pt-0 shrink-0">
                      <Link
                        to={`/admin/upload-requests/${req._id}`}
                        className="btn-secondary btn-sm text-brand font-medium hover:bg-brand/5"
                        title="View complete request details"
                      >
                        <FileText size={13} />
                        View Details
                      </Link>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => handleOpenPreview(req)}
                        title="Inspect original quarantined image"
                      >
                        <Eye size={13} />
                        Inspect Original
                      </button>

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
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Grid: Recent Activity & Admin Quick Tasks */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="panel overflow-hidden">
          <div className="card-header">
            <div>
              <h2 className="section-title">Recent activity</h2>
              <p className="section-subtitle">Uploads, reviews, and security events</p>
            </div>
            <Link to="/admin/audit-logs" className="btn-ghost btn-sm">
              Audit log
              <ArrowRight size={13} />
            </Link>
          </div>

          {analytics.isLoading ? (
            <div className="space-y-3 p-5">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="flex items-center gap-3">
                  <span className="skeleton h-7 w-7 rounded-full" />
                  <div className="flex-1 space-y-1">
                    <span className="skeleton block h-3 w-32" />
                    <span className="skeleton block h-2.5 w-48" />
                  </div>
                </div>
              ))}
            </div>
          ) : activity.length === 0 ? (
            <div className="p-8">
              <EmptyState
                icon={FolderLock}
                title="No recent activity"
                description="Events will appear here as employees upload files or membership applications are reviewed."
              />
            </div>
          ) : (
            <div className="divide-y divide-line">
              {activity.slice(0, 8).map((event) => (
                <div key={event._id} className="flex items-start justify-between gap-3 px-5 py-3 text-xs">
                  <div>
                    <p className="font-medium text-ink">
                      {ACTIVITY_LABELS[event.action] || event.action.replaceAll('_', ' ')}
                    </p>
                    <p className="mt-0.5 text-ink-faint">
                      {event.actor?.walletAddress
                        ? `${event.actor.walletAddress.slice(0, 8)}...${event.actor.walletAddress.slice(-4)}`
                        : 'System'}
                      {event.targetType ? ` · ${event.targetType}` : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-ink-faint">{formatRelativeTime(event.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="section-card">
          <h2 className="section-title">Administration</h2>
          <p className="section-subtitle">Common tasks for your organization</p>
          <div className="mt-4 space-y-2">
            {[
              {
                to: '/admin/upload-requests',
                icon: UploadCloud,
                title: 'Upload Requests',
                detail: `${data.pendingUploads ?? totalPending ?? 0} request${(data.pendingUploads ?? totalPending ?? 0) === 1 ? '' : 's'} awaiting review`
              },
              {
                to: '/admin/officer-approval',
                icon: BadgeCheck,
                title: 'Employee approval',
                detail: `${data.pendingApplications ?? 0} pending application${(data.pendingApplications ?? 0) === 1 ? '' : 's'}`
              },
              {
                to: '/admin/quarantine',
                icon: ShieldAlert,
                title: 'Quarantine review',
                detail: `${data.quarantined ?? 0} flagged files`
              },
              {
                to: '/admin/users',
                icon: Users,
                title: 'Employees',
                detail: 'Roles and verification status'
              },
              {
                to: '/admin/groups',
                icon: FolderTree,
                title: 'Groups',
                detail: 'Team and access management'
              },
              {
                to: '/admin/organization',
                icon: ClipboardList,
                title: 'Organization settings',
                detail: organization.data?.organizationCode
                  ? `Code ${organization.data.organizationCode}`
                  : 'Policy and access code'
              }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className="flex items-center gap-3 rounded-[10px] border border-line px-3 py-2.5 transition hover:border-[#d3d8e0] hover:bg-[#FBFCFD]"
                >
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-surface text-ink-muted">
                    <Icon size={15} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-medium text-ink">{item.title}</span>
                    <span className="block text-[11.5px] text-ink-faint">{item.detail}</span>
                  </span>
                  <ArrowRight size={13} className="shrink-0 text-ink-faint" />
                </Link>
              );
            })}
          </div>

          <div className="mt-5 border-t border-line pt-4">
            <p className="detail-label">Quarantined files</p>
            <p className="mt-1 text-[20px] font-semibold text-ink">{data.quarantined ?? 0}</p>
            <p className="mt-0.5 text-[12px] text-ink-faint">Isolated by AI screening until reviewed</p>
          </div>
        </section>
      </div>

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

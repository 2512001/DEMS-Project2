import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Shield, Clock, AlertTriangle, CheckCircle2, XCircle, User, Building2, Calendar, FileText, Ban } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import StatusBadge from '../StatusBadge.jsx';
import { approveViewRequest, rejectViewRequest, revokeViewPermission } from '../../api/viewAccess.js';
import { formatDate, formatRelativeTime } from '../../utils/format.js';
import { useToast } from '../ui/Toast.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

export default function ViewRequestDetailsModal({
  request,
  open,
  onClose,
  canApprove = false,
  canRevoke = false,
  onActionComplete
}) {
  const { user } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [showRejectForm, setShowRejectForm] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [showRevokeForm, setShowRevokeForm] = useState(false);
  const [revokeReason, setRevokeReason] = useState('');

  const approveMutation = useMutation({
    mutationFn: () => approveViewRequest(request.requestId),
    onSuccess: () => {
      push(`View access approved for request ${request.requestId}`, { tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['incoming-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      if (typeof onActionComplete === 'function') onActionComplete();
      onClose();
    },
    onError: (err) => push(err.response?.data?.message || 'Approval failed.', { tone: 'error' })
  });

  const rejectMutation = useMutation({
    mutationFn: () => rejectViewRequest(request.requestId, rejectReason),
    onSuccess: () => {
      push(`View access rejected for request ${request.requestId}`, { tone: 'warning' });
      queryClient.invalidateQueries({ queryKey: ['incoming-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setShowRejectForm(false);
      setRejectReason('');
      if (typeof onActionComplete === 'function') onActionComplete();
      onClose();
    },
    onError: (err) => push(err.response?.data?.message || 'Rejection failed.', { tone: 'error' })
  });

  const revokeMutation = useMutation({
    mutationFn: () => revokeViewPermission(request.requestId, revokeReason),
    onSuccess: () => {
      push(`View permission revoked for request ${request.requestId}`, { tone: 'neutral' });
      queryClient.invalidateQueries({ queryKey: ['incoming-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      setShowRevokeForm(false);
      setRevokeReason('');
      if (typeof onActionComplete === 'function') onActionComplete();
      onClose();
    },
    onError: (err) => push(err.response?.data?.message || 'Revocation failed.', { tone: 'error' })
  });

  if (!request) return null;

  const isPending = request.status === 'pending';
  const isActive = request.status === 'approved' && request.permission?.status === 'active' && new Date(request.permission.expiresAt) > new Date();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Request Details · ${request.requestId}`}
      description="Inspect authorization parameters and administrative rationale."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
          <div className="flex items-center gap-2">
            {canRevoke && isActive && !showRevokeForm && (
              <button
                type="button"
                className="btn-secondary text-danger hover:bg-danger-soft"
                onClick={() => setShowRevokeForm(true)}
              >
                <Ban size={14} />
                Revoke Access
              </button>
            )}

            {canApprove && isPending && !showRejectForm && (
              <>
                <button
                  type="button"
                  className="btn-secondary text-danger hover:bg-danger-soft"
                  onClick={() => setShowRejectForm(true)}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  <XCircle size={14} />
                  Reject
                </button>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => approveMutation.mutate()}
                  disabled={approveMutation.isPending || rejectMutation.isPending}
                >
                  <CheckCircle2 size={14} />
                  {approveMutation.isPending ? 'Approving…' : 'Approve Request'}
                </button>
              </>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Status header banner */}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[9px] border border-line bg-surface p-3.5">
          <div className="flex items-center gap-2.5">
            <StatusBadge status={request.status} />
            <span className="text-[13px] font-medium text-ink">
              Scope: {request.targetType?.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center gap-2 text-[12.5px] text-ink-muted">
            <Clock size={14} />
            <span>Duration: <strong>{request.requestedDuration}</strong></span>
          </div>
        </div>

        {/* Reject reason form inline if opened */}
        {showRejectForm && (
          <div className="rounded-[9px] border border-danger/30 bg-danger-soft p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-danger">Provide Rejection Reason</span>
              <button
                type="button"
                className="text-[11.5px] text-ink-muted hover:underline"
                onClick={() => setShowRejectForm(false)}
              >
                Cancel
              </button>
            </div>
            <textarea
              className="textarea bg-card text-[13px]"
              placeholder="State the reason this view access request is rejected..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={2}
            />
            <button
              type="button"
              className="btn-primary bg-danger hover:bg-danger/90 w-full"
              disabled={rejectMutation.isPending}
              onClick={() => rejectMutation.mutate()}
            >
              {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Rejection'}
            </button>
          </div>
        )}

        {/* Revoke reason form inline if opened */}
        {showRevokeForm && (
          <div className="rounded-[9px] border border-warn/30 bg-warn-soft p-3.5 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-warn">Revoke Active Access</span>
              <button
                type="button"
                className="text-[11.5px] text-ink-muted hover:underline"
                onClick={() => setShowRevokeForm(false)}
              >
                Cancel
              </button>
            </div>
            <textarea
              className="textarea bg-card text-[13px]"
              placeholder="Reason for revoking active permission..."
              value={revokeReason}
              onChange={(e) => setRevokeReason(e.target.value)}
              rows={2}
            />
            <button
              type="button"
              className="btn-primary bg-danger hover:bg-danger/90 w-full"
              disabled={revokeMutation.isPending}
              onClick={() => revokeMutation.mutate()}
            >
              {revokeMutation.isPending ? 'Revoking…' : 'Confirm Immediate Revocation'}
            </button>
          </div>
        )}

        {/* Requester & Target Metadata */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-[8px] border border-line p-3">
            <span className="text-[11px] font-medium text-ink-faint uppercase tracking-wider block mb-1">
              Requester
            </span>
            <div className="flex items-center gap-2">
              <User size={15} className="text-ink-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink truncate">
                  {request.requesterId?.profile?.displayName || request.requesterId?.walletAddress || 'Requester'}
                </p>
                <p className="text-[11.5px] text-ink-faint capitalize">{request.requesterRole?.replace('_', ' ')}</p>
              </div>
            </div>
          </div>

          <div className="rounded-[8px] border border-line p-3">
            <span className="text-[11px] font-medium text-ink-faint uppercase tracking-wider block mb-1">
              Organization
            </span>
            <div className="flex items-center gap-2">
              <Building2 size={15} className="text-ink-muted shrink-0" />
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-ink truncate">
                  {request.organizationId?.name || 'Assigned Organization'}
                </p>
                <p className="text-[11.5px] text-ink-faint">{request.organizationId?.organizationCode || ''}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Target Details */}
        <div className="rounded-[8px] border border-line p-3.5 space-y-2">
          <span className="text-[11px] font-medium text-ink-faint uppercase tracking-wider block">
            Requested Target Details
          </span>
          <div className="grid gap-2 sm:grid-cols-2 text-[12.5px]">
            <div>
              <span className="text-ink-muted">Target Name: </span>
              <strong className="text-ink">{request.targetName || request.targetId}</strong>
            </div>
            <div>
              <span className="text-ink-muted">Target ID: </span>
              <code className="text-ink text-[11.5px] bg-surface px-1 py-0.5 rounded">{request.targetId}</code>
            </div>
            {request.targetMetadata?.caseId && (
              <div>
                <span className="text-ink-muted">Case ID: </span>
                <span className="text-ink">{request.targetMetadata.caseId}</span>
              </div>
            )}
            {request.targetMetadata?.fileName && (
              <div>
                <span className="text-ink-muted">File: </span>
                <span className="text-ink">{request.targetMetadata.fileName}</span>
              </div>
            )}
          </div>
        </div>

        {/* Reason field */}
        <div className="rounded-[8px] border border-line p-3.5 bg-card">
          <span className="text-[11px] font-medium text-ink-faint uppercase tracking-wider block mb-1">
            Request Reason
          </span>
          <p className="text-[13px] leading-relaxed text-ink">{request.reason}</p>
        </div>

        {/* Timestamps & Approver info */}
        <div className="rounded-[8px] border border-line p-3 text-[12px] space-y-1.5 text-ink-muted">
          <div className="flex items-center justify-between">
            <span>Requested At:</span>
            <span className="text-ink">{formatDate(request.createdAt)} ({formatRelativeTime(request.createdAt)})</span>
          </div>
          {request.approvedAt && (
            <div className="flex items-center justify-between">
              <span>Approved At:</span>
              <span className="text-ink">{formatDate(request.approvedAt)}</span>
            </div>
          )}
          {request.permission?.expiresAt && (
            <div className="flex items-center justify-between">
              <span>Expires At:</span>
              <span className="font-semibold text-brand">{formatDate(request.permission.expiresAt)}</span>
            </div>
          )}
          {request.rejectionReason && (
            <div className="border-t border-line pt-2 text-danger">
              <span>Rejection Reason: </span>
              <strong>{request.rejectionReason}</strong>
            </div>
          )}
          {request.permission?.revocationReason && (
            <div className="border-t border-line pt-2 text-danger">
              <span>Revocation Reason: </span>
              <strong>{request.permission.revocationReason}</strong>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}

import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, Clock, AlertTriangle, FileText, FolderTree, Archive, CheckCircle2 } from 'lucide-react';
import Modal from '../ui/Modal.jsx';
import { createViewAccessRequest } from '../../api/viewAccess.js';
import { listOrganizations } from '../../api/admin.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { useToast } from '../ui/Toast.jsx';

const DURATION_OPTIONS = [
  { value: '1h', label: '1 hour', desc: 'Short review' },
  { value: '6h', label: '6 hours', desc: 'Same-day task' },
  { value: '12h', label: '12 hours', desc: 'Extended shift' },
  { value: '1d', label: '1 day', desc: '24-hour grant' },
  { value: '2d', label: '2 days', desc: 'Maximum period' }
];

export default function RequestViewAccessModal({
  open,
  onClose,
  initialTargetType = 'evidence',
  initialTargetId = '',
  initialTargetName = '',
  initialOrgId = '',
  lockedTarget = false,
  targetCaseId = '',
  targetGroupId = '',
  targetGroupName = '',
  onSuccess
}) {
  const { user, role } = useAuth();
  const { push } = useToast();
  const queryClient = useQueryClient();

  const [targetType, setTargetType] = useState(initialTargetType);
  const [targetId, setTargetId] = useState(initialTargetId);
  const [targetName, setTargetName] = useState(initialTargetName);
  const [organizationId, setOrganizationId] = useState(initialOrgId);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('1h');
  const [validationError, setValidationError] = useState('');

  const isSuperAdmin = role === 'super_admin';

  // Fetch organizations list if Super Admin needs to select
  const orgsQuery = useQuery({
    queryKey: ['organizations'],
    queryFn: listOrganizations,
    enabled: isSuperAdmin && open
  });

  const organizations = orgsQuery.data?.data || [];

  // Reset form when modal opens with new initial props
  useEffect(() => {
    if (open) {
      setTargetType(initialTargetType || 'evidence');
      setTargetId(initialTargetId || '');
      setTargetName(initialTargetName || '');
      setOrganizationId(initialOrgId || (user?.organizationId ? String(user.organizationId) : ''));
      setReason('');
      setDuration('1h');
      setValidationError('');
    }
  }, [open, initialTargetType, initialTargetId, initialTargetName, initialOrgId, user?.organizationId]);

  const handleSelectScope = (scope) => {
    setTargetType(scope);
    setValidationError('');
    if (lockedTarget) {
      if (scope === 'evidence') {
        setTargetId(initialTargetId || '');
        setTargetName(initialTargetName || '');
      } else if (scope === 'case') {
        setTargetId(targetCaseId || '');
        setTargetName(targetCaseId ? `Case ${targetCaseId}` : '');
      } else if (scope === 'group') {
        setTargetId(targetGroupId || '');
        setTargetName(targetGroupName || 'Evidence Group');
      }
    }
  };

  const mutation = useMutation({
    mutationFn: createViewAccessRequest,
    onSuccess: (data) => {
      push('View access request submitted successfully. Awaiting required approval.', { tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['my-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['incoming-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['superadmin-incoming-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['superadmin-my-view-requests'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-counts'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['org-evidence'] });
      queryClient.invalidateQueries({ queryKey: ['platform-evidence'] });
      if (initialTargetId) {
        queryClient.invalidateQueries({ queryKey: ['evidence', initialTargetId] });
      }
      if (typeof onSuccess === 'function') {
        onSuccess(data);
      }
      onClose();
    },
    onError: (err) => {
      const msg = err.response?.data?.message || err.message || 'Failed to submit view access request.';
      setValidationError(msg);
      push(msg, { tone: 'error' });
    }
  });

  const handleSubmit = (e) => {
    if (e && e.preventDefault) {
      e.preventDefault();
    }
    setValidationError('');

    const cleanTargetId = (targetId || '').trim();
    if (!cleanTargetId) {
      setValidationError('Target ID or item reference is required.');
      return;
    }

    const cleanReason = (reason || '').trim();
    if (!cleanReason || cleanReason.length < 3) {
      setValidationError('A clear reason of at least 3 characters is required.');
      return;
    }

    if (isSuperAdmin && !organizationId && targetType !== 'evidence') {
      setValidationError('Please select the relevant organization for this request.');
      return;
    }

    mutation.mutate({
      targetType,
      targetId: cleanTargetId,
      organizationId: organizationId || undefined,
      reason: cleanReason,
      duration
    });
  };

  const approverNote = isSuperAdmin
    ? 'Your request will be submitted to the relevant Organization Admin for review and approval.'
    : role === 'admin'
    ? 'Your request will be submitted to the Super Admin for platform-level approval.'
    : 'Your request will be submitted to your Organization Admin for review and approval.';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Request View Access"
      description="Request temporary authorization to inspect protected, decrypted evidence."
      size="md"
      footer={
        <div className="flex w-full items-center justify-end gap-2">
          <button
            type="button"
            className="btn-secondary"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            className="btn-primary"
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Submitting…' : 'Submit Request'}
          </button>
        </div>
      }
    >
      <form id="request-view-access-form" onSubmit={handleSubmit} className="space-y-4">
        {/* Hidden submit button to guarantee Enter key submits the form from any input */}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />

        {/* Approver policy notice */}
        <div className="rounded-[9px] border border-brand/20 bg-brand-soft p-3 text-[12.5px] leading-5 text-brand flex items-start gap-2.5">
          <Shield size={16} className="mt-0.5 shrink-0 text-brand" />
          <div>
            <p className="font-semibold text-brand">Two-Way Approval Policy</p>
            <p className="mt-0.5 text-ink-muted">{approverNote}</p>
          </div>
        </div>

        {validationError ? (
          <div className="alert-danger" role="alert">
            <AlertTriangle size={15} className="mt-0.5 shrink-0" />
            <span>{validationError}</span>
          </div>
        ) : null}

        {/* Scope / Target Type selection */}
        <div>
          <label className="label">Target Scope</label>
          <div className="grid grid-cols-3 gap-2 mt-1">
            <button
              type="button"
              onClick={() => handleSelectScope('evidence')}
              className={`flex flex-col items-center justify-center gap-1 p-2.5 rounded-[8px] border text-center transition cursor-pointer ${
                targetType === 'evidence'
                  ? 'border-brand bg-brand-soft text-brand font-medium shadow-sm'
                  : 'border-line bg-card text-ink-muted hover:border-[#ccd2dc]'
              }`}
            >
              <FileText size={16} />
              <span className="text-[12.5px]">Evidence File</span>
            </button>

            <button
              type="button"
              disabled={lockedTarget && !targetCaseId}
              title={lockedTarget && !targetCaseId ? 'No Case ID associated with this file' : 'Request access for entire Case'}
              onClick={() => handleSelectScope('case')}
              className={`flex flex-col items-center justify-center gap-1 p-2.5 rounded-[8px] border text-center transition ${
                targetType === 'case'
                  ? 'border-brand bg-brand-soft text-brand font-medium shadow-sm'
                  : 'border-line bg-card text-ink-muted hover:border-[#ccd2dc]'
              } ${lockedTarget && !targetCaseId ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <Archive size={16} />
              <span className="text-[12.5px]">Case Scope</span>
            </button>

            <button
              type="button"
              disabled={lockedTarget && !targetGroupId}
              title={lockedTarget && !targetGroupId ? 'No Group associated with this file' : 'Request access for entire Group'}
              onClick={() => handleSelectScope('group')}
              className={`flex flex-col items-center justify-center gap-1 p-2.5 rounded-[8px] border text-center transition ${
                targetType === 'group'
                  ? 'border-brand bg-brand-soft text-brand font-medium shadow-sm'
                  : 'border-line bg-card text-ink-muted hover:border-[#ccd2dc]'
              } ${lockedTarget && !targetGroupId ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              <FolderTree size={16} />
              <span className="text-[12.5px]">Group Scope</span>
            </button>
          </div>
        </div>

        {/* Target Item details */}
        <div>
          <label className="label">
            {targetType === 'evidence' && 'Target Evidence ID / Record'}
            {targetType === 'case' && 'Target Case ID'}
            {targetType === 'group' && 'Target Group ID'}
          </label>
          <input
            className="input mt-1"
            value={targetId}
            onChange={(e) => setTargetId(e.target.value)}
            placeholder={
              targetType === 'evidence'
                ? '64a... or Evidence ID'
                : targetType === 'case'
                ? 'e.g. CASE-2026-001'
                : 'Group ObjectId'
            }
            readOnly={lockedTarget}
            required
          />
          {targetName ? (
            <p className="mt-1 text-[11.5px] text-ink-faint">Item: {targetName}</p>
          ) : null}
        </div>

        {/* Relevant Organization Selector for Super Admin */}
        {isSuperAdmin && targetType !== 'evidence' && (
          <div>
            <label className="label">Target Organization</label>
            <select
              className="select mt-1"
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              required
            >
              <option value="">Select organization…</option>
              {organizations.map((org) => (
                <option key={org._id} value={org._id}>
                  {org.name} ({org.organizationCode})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Requested Duration */}
        <div>
          <label className="label flex items-center justify-between">
            <span>Requested Duration</span>
            <span className="text-[11.5px] font-normal text-ink-faint">Approved period only</span>
          </label>
          <div className="grid grid-cols-5 gap-1.5 mt-1">
            {DURATION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setDuration(opt.value)}
                className={`py-2 px-1 text-center rounded-[7px] border text-[12px] transition ${
                  duration === opt.value
                    ? 'border-brand bg-brand text-white font-medium shadow-sm'
                    : 'border-line bg-card text-ink-muted hover:border-[#ccd2dc]'
                }`}
              >
                <div className="font-semibold">{opt.label}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Reason field */}
        <div>
          <label className="label flex items-center justify-between">
            <span>Reason for Request</span>
            <span className="text-[11px] text-ink-faint">Required (min 3 chars) · Press Ctrl+Enter to submit</span>
          </label>
          <textarea
            className="textarea mt-1 min-h-[85px]"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="Describe the lawful or administrative reason for requesting access to this evidence..."
            required
            maxLength={1000}
          />
        </div>
      </form>
    </Modal>
  );
}

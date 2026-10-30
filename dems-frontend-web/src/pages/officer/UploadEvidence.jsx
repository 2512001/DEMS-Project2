import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Copy,
  Database,
  FileUp,
  Loader2,
  Lock,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  X,
  XCircle
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import exifr from 'exifr';

import { getUploadPolicy } from '../../api/evidence.js';
import { getActiveOrganizations } from '../../api/admin.js';
import { createPendingUpload } from '../../api/controlledUpload.js';
import { getUserGroups } from '../../api/groups.js';
import { subscribeToUploadEvents } from '../../api/socket.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import VerificationStatusPanel from '../../components/verification/VerificationStatusPanel.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatBytes, formatDate } from '../../utils/format.js';
import { useToast } from '../../components/ui/Toast.jsx';

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

const schema = z.object({
  caseId: z.string().max(120).optional(),
  reason: z.string().max(500).optional(),
  deviceInfo: z.string().min(2).max(300),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  capturedAt: z.string().min(1),
  evidence: z.any()
});

const STAGE_ORDER = ['collect', 'quarantine', 'review', 'permanent_processing', 'complete'];

const STAGE_COPY = {
  collect: { title: '1. File & Context', detail: 'Select JPEG or PNG (max 20MB) and capture context' },
  quarantine: { title: '2. Private Quarantine', detail: 'Server-side validation & encryption in quarantine storage' },
  review: { title: '3. Organization Review', detail: 'Awaiting Organization Admin approval decision' },
  permanent_processing: { title: '4. Permanent Storage', detail: 'IPFS encryption & blockchain registration' },
  complete: { title: '5. Finalized', detail: 'Verified permanent evidence committed & temporary file cleaned' }
};

export default function UploadEvidence() {
  const { role, user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { push } = useToast();
  const fileInputRef = useRef(null);
  const isEmployee = role === 'officer';

  const [stage, setStage] = useState('collect');
  const [uploadResult, setUploadResult] = useState(null);
  const [currentStatus, setCurrentStatus] = useState('PENDING_REVIEW');
  const [error, setError] = useState('');
  const [requestAI, setRequestAI] = useState(!isEmployee);
  const [requestBlockchain, setRequestBlockchain] = useState(true);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [selectedOrg, setSelectedOrg] = useState(user?.organizationId || '');
  const [copied, setCopied] = useState(false);

  const activeOrgsQuery = useQuery({
    queryKey: ['active-organizations'],
    queryFn: getActiveOrganizations,
    enabled: !user?.organizationId
  });
  const activeOrgs = activeOrgsQuery.data || [];

  useEffect(() => {
    if (!selectedOrg && activeOrgs.length > 0) {
      setSelectedOrg(activeOrgs[0]._id);
    }
  }, [activeOrgs, selectedOrg]);

  const policyQuery = useQuery({ queryKey: ['upload-policy'], queryFn: getUploadPolicy });
  const groupsQuery = useQuery({ queryKey: ['user-groups'], queryFn: getUserGroups, enabled: isEmployee });
  const policy = policyQuery.data;
  const groups = groupsQuery.data?.data || [];
  const aiRequired = Boolean(policy?.requireAIForEmployees);
  const chainRequired = Boolean(policy?.requireBlockchainForEmployees);
  const aiEnabled = isEmployee ? (aiRequired || requestAI) : requestAI;
  const chainEnabled = isEmployee ? (chainRequired || requestBlockchain) : requestBlockchain;

  const form = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      caseId: '',
      reason: '',
      deviceInfo: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      latitude: 0,
      longitude: 0,
      capturedAt: new Date().toISOString().slice(0, 16),
      evidence: undefined
    }
  });

  const evidenceRegister = form.register('evidence');

  // Real-time Socket.IO listener for upload approval workflow
  useEffect(() => {
    const unsubscribe = subscribeToUploadEvents((event) => {
      if (!uploadResult?.requestId && !uploadResult?._id) return;
      const targetId = uploadResult.requestId || uploadResult._id;

      if (event.requestId === targetId || event.evidenceId === uploadResult.evidenceId) {
        console.log('[UPLOAD SCREEN REAL-TIME] Received event for this upload:', event);
        setCurrentStatus(event.status);

        if (event.eventName === 'upload_approved' || event.eventName === 'permanent_processing_started') {
          setStage('permanent_processing');
          push('Your evidence upload was approved! Permanent processing started.', { tone: 'brand' });
        } else if (event.eventName === 'ipfs_stored') {
          setStage('permanent_processing');
          push('Evidence securely stored in decentralized storage.', { tone: 'brand' });
        } else if (event.eventName === 'blockchain_pending') {
          setStage('permanent_processing');
        } else if (event.eventName === 'finalization_completed') {
          setStage('complete');
          setCurrentStatus('FINALIZED');
          push('Evidence successfully finalized and registered on blockchain!', { tone: 'success' });
          queryClient.invalidateQueries({ queryKey: ['my-files'] });
        } else if (event.eventName === 'upload_rejected') {
          setCurrentStatus('REJECTED');
          setError(`Upload rejected by Organization Admin: ${event.reason || 'No reason provided'}`);
          push(`Upload rejected: ${event.reason || 'Declined by Admin'}`, { tone: 'warning' });
        } else if (event.eventName === 'processing_failed') {
          setError(`Finalization error: ${event.error || 'Check with administrator'}`);
        }
      }
    });

    return () => unsubscribe();
  }, [uploadResult, push, queryClient]);

  const handleCopyHash = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const uploadMutation = useMutation({
    mutationFn: createPendingUpload,
    onSuccess: (response) => {
      setError('');
      const pendingData = response.pendingRequest;
      setUploadResult(pendingData);
      setCurrentStatus(pendingData.workflowStatus || 'PENDING_REVIEW');
      setStage('review');
      push('Evidence submitted! Quarantined and awaiting Organization Admin review.', { tone: 'success' });
      queryClient.invalidateQueries({ queryKey: ['my-files'] });
    },
    onError: (err) => {
      setError(err?.response?.data?.message || err.message || 'Upload failed.');
      setStage('collect');
    }
  });

  const handleFileChosen = async (file) => {
    if (!file) {
      setSelectedFile(null);
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError(`File size (${formatBytes(file.size)}) exceeds the 20MB limit. Please choose a smaller image.`);
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      form.setValue('evidence', undefined);
      return;
    }

    const extension = file.name.split('.').pop()?.toLowerCase();
    const allowedType = (extension === 'jpg' || extension === 'jpeg')
      ? ['image/jpeg', 'image/jpg'].includes(file.type)
      : extension === 'png' && file.type === 'image/png';

    if (!allowedType) {
      setError('Unsupported file type. Only JPEG/JPG and PNG images are permitted.');
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      form.setValue('evidence', undefined);
      return;
    }

    setError('');
    setSelectedFile(file);

    try {
      const exif = await exifr.parse(file);
      const source = exif?.DateTimeOriginal || file.lastModified;
      if (source) {
        const d = new Date(source);
        form.setValue('capturedAt', new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
      }
    } catch {
      // EXIF optional
    }
  };

  const onDrop = (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file) return;
    const input = fileInputRef.current;
    if (input) {
      const transfer = new DataTransfer();
      transfer.items.add(file);
      input.files = transfer.files;
      evidenceRegister.onChange({ target: input, type: 'change' });
    }
    handleFileChosen(file);
  };

  const submit = async (values) => {
    setError('');
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });
      values.latitude = Number(position.coords.latitude.toFixed(6));
      values.longitude = Number(position.coords.longitude.toFixed(6));
    } catch (err) {
      setError(err?.message || 'Unable to get GPS location. Allow location access and try again.');
      return;
    }

    if (!values.evidence?.[0]) {
      setError('Please select an evidence image file.');
      return;
    }

    const file = values.evidence[0];
    const formData = new FormData();
    formData.append('evidence', file);
    if (values.caseId) formData.append('caseId', values.caseId);
    if (values.reason) formData.append('reason', values.reason);
    if (selectedGroup) formData.append('groupId', selectedGroup);

    const effectiveOrg = user?.organizationId || selectedOrg;
    if (effectiveOrg) {
      formData.append('organizationId', effectiveOrg);
    }
    formData.append('requestAI', String(aiEnabled));
    formData.append('requestBlockchain', String(chainEnabled));
    formData.append(
      'captureMetadata',
      JSON.stringify({
        deviceInfo: navigator.userAgent,
        gpsLocation: { latitude: Number(values.latitude), longitude: Number(values.longitude) },
        capturedAt: new Date(values.capturedAt).toISOString()
      })
    );

    setStage('quarantine');
    uploadMutation.mutate(formData);
  };

  const activeIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Evidence Upload Workflow"
        title="Upload Evidence"
        subtitle="Submit digital evidence into private quarantine storage. Evidence requires Organization Admin approval before permanent IPFS pinning and blockchain proof registration."
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Form Container */}
        <form className="section-card" onSubmit={form.handleSubmit(submit)}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title">Evidence &amp; Context</h2>
              <p className="section-subtitle">JPEG or PNG files only (max 20 MB). Encrypted at rest upon upload.</p>
            </div>
            <span className="badge-brand">
              <Lock size={11} />
              Quarantined at rest
            </span>
          </div>

          <div className="mt-4">
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={`relative rounded-[11px] border-2 border-dashed px-5 py-8 text-center transition ${
                dragging
                  ? 'border-brand bg-brand-soft/60'
                  : selectedFile
                    ? 'border-[#c7e9dd] bg-success-soft/40'
                    : 'border-line bg-[#FBFCFD] hover:border-[#d3d8e0]'
              }`}
            >
              <input
                ref={fileInputRef}
                className="sr-only"
                id="evidence-file"
                type="file"
                accept=".jpg,.jpeg,.png,image/jpeg,image/png"
                disabled={stage !== 'collect'}
                {...evidenceRegister}
                onChange={async (event) => {
                  evidenceRegister.onChange(event);
                  await handleFileChosen(event.target.files?.[0]);
                }}
              />

              {selectedFile ? (
                <div className="flex flex-col items-center">
                  <span className="grid h-11 w-11 place-items-center rounded-[11px] bg-success-soft text-success">
                    <FileUp size={20} />
                  </span>
                  <p className="mt-3 max-w-full truncate text-[13.5px] font-medium text-ink">{selectedFile.name}</p>
                  <p className="mt-0.5 text-[12px] text-ink-muted">
                    {formatBytes(selectedFile.size)} · {selectedFile.type || 'JPEG/PNG Image'}
                  </p>
                  {stage === 'collect' ? (
                    <div className="mt-3 flex items-center gap-2">
                      <label htmlFor="evidence-file" className="btn-secondary btn-sm cursor-pointer">
                        Change image
                      </label>
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => {
                          if (fileInputRef.current) fileInputRef.current.value = '';
                          evidenceRegister.onChange({ target: { files: [] }, type: 'change' });
                          setSelectedFile(null);
                        }}
                      >
                        <X size={13} />
                        Remove
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="grid h-11 w-11 place-items-center rounded-[11px] border border-line bg-card text-ink-muted shadow-card">
                    <UploadCloud size={20} />
                  </span>
                  <p className="mt-3 text-[13.5px] font-medium text-ink">
                    Drop image here, or{' '}
                    <label htmlFor="evidence-file" className="cursor-pointer text-brand underline-offset-2 hover:underline">
                      browse
                    </label>
                  </p>
                  <p className="mt-1 text-[12px] text-ink-faint">Supported formats: JPEG, JPG, PNG (Max 20 MB)</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            {!user?.organizationId ? (
              <label className="block sm:col-span-2">
                <span className="label">Target Organization <span className="text-danger">*</span></span>
                <select
                  className="input"
                  value={selectedOrg}
                  disabled={stage !== 'collect'}
                  onChange={(e) => setSelectedOrg(e.target.value)}
                  required
                >
                  <option value="">Select recipient organization for admin review...</option>
                  {activeOrgs.map((org) => (
                    <option key={org._id} value={org._id}>
                      {org.name} ({org.organizationCode})
                    </option>
                  ))}
                </select>
                <span className="hint">Your evidence will be placed in private quarantine and forwarded to this organization's administrator for review.</span>
              </label>
            ) : null}

            <label className="block">
              <span className="label">Case ID <span className="font-normal text-ink-faint">(optional)</span></span>
              <input
                className="input"
                placeholder="CASE-2026-001"
                disabled={stage !== 'collect'}
                {...form.register('caseId')}
              />
            </label>

            {isEmployee && groups.length > 0 ? (
              <label className="block">
                <span className="label">Group / Unit <span className="font-normal text-ink-faint">(optional)</span></span>
                <select
                  className="input"
                  value={selectedGroup}
                  disabled={stage !== 'collect'}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                >
                  <option value="">No group</option>
                  {groups.map((group) => (
                    <option key={group._id} value={group._id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label className="block sm:col-span-2">
              <span className="label">Reason / Description</span>
              <textarea
                className="textarea min-h-[60px]"
                placeholder="Briefly describe the evidence or context of capture..."
                disabled={stage !== 'collect'}
                {...form.register('reason')}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="label">Captured at</span>
              <input
                className="input"
                type="datetime-local"
                disabled={stage !== 'collect'}
                {...form.register('capturedAt')}
              />
            </label>

            <label className="block sm:col-span-2">
              <span className="label">Device fingerprint</span>
              <input className="input bg-[#FBFCFD] text-ink-muted text-xs" readOnly {...form.register('deviceInfo')} />
              <span className="hint">Recorded automatically for immutable chain of custody.</span>
            </label>
          </div>

          {/* Security & Verification Options */}
          <div className="mt-5 rounded-[10px] border border-line">
            <div className="border-b border-line px-3.5 py-2.5">
              <p className="text-[13px] font-medium text-ink">Verification Options</p>
            </div>
            <label className="flex items-start justify-between gap-4 px-3.5 py-3">
              <span>
                <span className="block text-[13px] text-ink">AI screening &amp; authenticity check</span>
                <span className="mt-0.5 block text-[12px] text-ink-faint">
                  {aiRequired ? 'Required by organization policy.' : 'Screens for deepfake or image tampering prior to review.'}
                </span>
              </span>
              <input
                type="checkbox"
                className="checkbox mt-0.5"
                checked={aiEnabled}
                disabled={aiRequired || stage !== 'collect'}
                onChange={(event) => setRequestAI(event.target.checked)}
              />
            </label>
            <label className="flex items-start justify-between gap-4 border-t border-line px-3.5 py-3">
              <span>
                <span className="block text-[13px] text-ink">Blockchain registration upon approval</span>
                <span className="mt-0.5 block text-[12px] text-ink-faint">
                  {chainRequired ? 'Required by organization policy.' : 'Registers immutable integrity proof on-chain via smart contract upon admin approval.'}
                </span>
              </span>
              <input
                type="checkbox"
                className="checkbox mt-0.5"
                checked={chainEnabled}
                disabled={chainRequired || stage !== 'collect'}
                onChange={(event) => setRequestBlockchain(event.target.checked)}
              />
            </label>
          </div>

          {error ? (
            <div className="alert-danger mt-4" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-xs">{error}</p>
              </div>
            </div>
          ) : null}

          {stage === 'collect' ? (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button type="submit" className="btn-primary" disabled={uploadMutation.isPending}>
                {uploadMutation.isPending ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />}
                {uploadMutation.isPending ? 'Validating & Quarantining…' : 'Submit for Approval'}
              </button>
              <p className="text-[12px] text-ink-faint">
                Evidence is securely stored in quarantine until an administrator accepts it.
              </p>
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="btn-secondary btn-sm"
                onClick={() => {
                  setStage('collect');
                  setSelectedFile(null);
                  setUploadResult(null);
                  setError('');
                  form.reset();
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Upload another file
              </button>
              <button
                type="button"
                className="btn-ghost btn-sm"
                onClick={() => navigate(isEmployee ? '/officer/dashboard' : '/citizen/evidence-vault')}
              >
                Go to Vault <ArrowRight size={13} />
              </button>
            </div>
          )}
        </form>

        {/* Pipeline & Status Tracker */}
        <div className="space-y-5">
          <section className="section-card">
            <h2 className="section-title">Approval Workflow Pipeline</h2>
            <p className="section-subtitle">Real-time status of your evidence request</p>

            <ol className="mt-4 space-y-0">
              {STAGE_ORDER.map((step, index) => {
                const done = index < activeIndex || stage === 'complete';
                const active = step === stage && stage !== 'complete';
                const copy = STAGE_COPY[step];

                return (
                  <li key={step} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < STAGE_ORDER.length - 1 ? (
                      <span
                        className={`absolute left-[11px] top-6 h-full w-px ${done ? 'bg-success/40' : 'bg-line'}`}
                        aria-hidden="true"
                      />
                    ) : null}
                    <span
                      className={`relative z-10 mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border ${
                        done
                          ? 'border-success bg-success text-white'
                          : active
                            ? 'border-brand bg-brand-soft text-brand'
                            : 'border-line bg-card text-ink-faint'
                      }`}
                    >
                      {done ? <Check size={12} /> : active ? <Loader2 size={12} className="animate-spin" /> : <Circle size={6} fill="currentColor" />}
                    </span>
                    <div className="min-w-0">
                      <p className={`text-[13px] font-medium ${active ? 'text-brand' : done ? 'text-ink' : 'text-ink-muted'}`}>
                        {copy.title}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-5 text-ink-faint">{copy.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
          </section>

          {/* Pending Request Details Card */}
          {uploadResult ? (
            <section className="section-card space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="section-title">Submission Details</h2>
                  <p className="section-subtitle">Awaiting Organization Admin Decision</p>
                </div>
                <StatusBadge status={currentStatus} />
              </div>

              <div className="bg-[#FBFCFD] border border-line rounded-lg p-3 space-y-2 text-xs">
                <div>
                  <span className="text-ink-faint block">Request ID:</span>
                  <span className="font-mono font-medium text-brand">{uploadResult.evidenceId}</span>
                </div>

                <div>
                  <span className="text-ink-faint block">Original File:</span>
                  <span className="text-ink font-medium">{uploadResult.fileName}</span>
                </div>

                <div>
                  <span className="text-ink-faint block">Evidence Integrity:</span>
                  <span className="text-ink font-medium">
                    {currentStatus === 'FINALIZED' ? 'Passed and verified' : 'Pending admin review and finalization'}
                  </span>
                </div>

                <div>
                  <span className="text-ink-faint block">Status:</span>
                  <span className="text-ink font-medium">
                    {currentStatus === 'PENDING_REVIEW'
                      ? 'In quarantine storage. A notification has been sent to your Organization Admin.'
                      : currentStatus === 'APPROVED_PROCESSING'
                        ? 'Approved! Encrypting per-file DEK and pinning to IPFS...'
                        : currentStatus === 'IPFS_STORED'
                          ? 'Encrypted and stored in IPFS. Registering proof on blockchain...'
                          : currentStatus === 'BLOCKCHAIN_PENDING'
                            ? 'Awaiting blockchain transaction confirmation...'
                            : currentStatus === 'FINALIZED'
                              ? 'Permanently stored and verified on-chain. Quarantine file cleaned.'
                              : currentStatus === 'REJECTED'
                                ? 'Upload rejected by Organization Admin.'
                                : currentStatus}
                  </span>
                </div>
              </div>

              <VerificationStatusPanel item={{ ...uploadResult, workflowStatus: currentStatus }} className="mt-3" />

              {stage === 'review' ? (
                <div className="p-3 bg-brand-soft/40 border border-brand/20 rounded-lg text-xs text-brand flex items-center gap-2">
                  <RefreshCw size={14} className="animate-spin shrink-0" />
                  <span>Listening for real-time administrator decision via Socket.IO...</span>
                </div>
              ) : null}

              {stage === 'complete' ? (
                <div className="p-3 bg-success-soft border border-success/40 rounded-lg text-xs text-success flex items-center gap-2">
                  <CheckCircle2 size={16} className="shrink-0" />
                  <span>Evidence permanent finalization complete! You can now track it in your vault.</span>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

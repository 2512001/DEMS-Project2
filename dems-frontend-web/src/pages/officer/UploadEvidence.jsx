import React, { useMemo, useRef, useState } from 'react';
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
  FileUp,
  Loader2,
  Lock,
  ShieldCheck,
  UploadCloud,
  X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import exifr from 'exifr';

import {
  finalizeEvidence,
  getUploadPolicy,
  markBlockchainFailed,
  retryBlockchainRegistration,
  checkWalletBalance,
  uploadEvidence
} from '../../api/evidence.js';
import { getUserGroups } from '../../api/groups.js';
import { addEvidenceOnChain, EVIDENCE_CONTRACT_ADDRESS } from '../../blockchain/evidenceContract.js';
import StatusBadge from '../../components/StatusBadge.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';
import { formatBytes } from '../../utils/format.js';

const schema = z.object({
  caseId: z.string().max(120).optional(),
  deviceInfo: z.string().min(2).max(300),
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  capturedAt: z.string().min(1),
  evidence: z.any()
});

const STAGE_ORDER = ['collect', 'upload', 'ai', 'chain', 'finalize', 'complete'];

const STAGE_COPY = {
  collect: { title: 'Collect details', detail: 'Select the file and capture context' },
  upload: { title: 'Encrypt & store', detail: 'AES-256-GCM, then upload to IPFS' },
  ai: { title: 'AI verification', detail: 'Authenticity screening, if requested' },
  chain: { title: 'Blockchain proof', detail: 'Record the integrity hash on-chain' },
  finalize: { title: 'Confirm', detail: 'Associate the transaction with the file' },
  complete: { title: 'Complete', detail: 'File is stored and verifiable' }
};

export default function UploadEvidence() {
  const { role } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef(null);
  const isEmployee = role === 'officer';

  const [stage, setStage] = useState('collect');
  const [uploadResult, setUploadResult] = useState(null);
  const [aiPreview, setAiPreview] = useState(null);
  const [txHash, setTxHash] = useState('');
  const [error, setError] = useState('');
  const [requestAI, setRequestAI] = useState(!isEmployee);
  const [requestBlockchain, setRequestBlockchain] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [diagnostics, setDiagnostics] = useState(null);
  const [selectedGroup, setSelectedGroup] = useState('');
  const pendingFormData = useRef(null);

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
      deviceInfo: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      latitude: 0,
      longitude: 0,
      capturedAt: new Date().toISOString().slice(0, 16),
      evidence: undefined
    }
  });

  const evidenceRegister = form.register('evidence');

  const resetAfterSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ['my-files'] });
    setTimeout(() => {
      if (fileInputRef.current) fileInputRef.current.value = '';
      form.reset();
      setSelectedFile(null);
      setUploadResult(null);
      setAiPreview(null);
      setTxHash('');
      setError('');
      setStage('collect');
      navigate(isEmployee ? '/officer/dashboard' : '/citizen/evidence-vault');
    }, 1800);
  };

  const chainMutation = useMutation({
    mutationFn: async (stored) => {
      const record = stored || uploadResult;
      const payload = record?.blockchainPayload;
      const evidenceId = record?.evidenceId;
      if (!payload || !evidenceId) {
        throw new Error('Blockchain payload is missing from the backend response.');
      }
      if (!window.ethereum) {
        throw new Error('MetaMask is not installed.');
      }
      if (!EVIDENCE_CONTRACT_ADDRESS) {
        throw new Error('Evidence contract address is not configured.');
      }
      setStage('chain');
      const chain = await addEvidenceOnChain(payload);
      setTxHash(chain.txHash);
      setStage('finalize');
      return finalizeEvidence(evidenceId, chain.txHash);
    },
    onSuccess: (response) => {
      if (response?.data) setUploadResult(response.data);
      setStage('complete');
      resetAfterSuccess();
    },
    onError: async (err, stored) => {
      const message = err?.response?.data?.message || err.message || 'Blockchain proof could not be created. Your file remains stored in IPFS.';
      setError(message);
      const evidenceId = stored?.evidenceId || uploadResult?.evidenceId;
      if (evidenceId) {
        await markBlockchainFailed(evidenceId, message).catch(() => {});
      }
      setStage('ai');

      // Run diagnostics on blockchain error
      if (window.ethereum) {
        try {
          const accounts = await window.ethereum.request({ method: 'eth_accounts' });
          const chainId = await window.ethereum.request({ method: 'eth_chainId' });
          if (accounts[0]) {
            const balanceData = await checkWalletBalance(accounts[0]);
            setDiagnostics({
              frontend: {
                connectedAccount: accounts[0],
                chainId,
                chainIdDecimal: parseInt(chainId, 16)
              },
              backend: balanceData.data
            });
          }
        } catch (diagErr) {
          console.error('Diagnostic check failed:', diagErr);
        }
      }
    }
  });

  const retryMutation = useMutation({
    mutationFn: async (evidenceId) => {
      const response = await retryBlockchainRegistration(evidenceId);
      return response.data;
    },
    onSuccess: (data) => {
      setUploadResult(data);
      setError('');
      chainMutation.mutate(data);
    },
    onError: (err) => {
      setError(err?.response?.data?.message || err.message || 'Failed to retry blockchain registration.');
    }
  });

  const uploadMutation = useMutation({
    mutationFn: uploadEvidence,
    onSuccess: (response) => {
      setError('');
      if (response.requiresConfirmation) {
        setAiPreview(response.data?.aiAnalysis);
        setStage('ai');
        return;
      }
      if (response.quarantined) {
        setAiPreview(response.data?.aiAnalysis || null);
        setUploadResult(response.data);
        setStage('complete');
        queryClient.invalidateQueries({ queryKey: ['my-files'] });
        queryClient.invalidateQueries({ queryKey: ['quarantine'] });
        return;
      }
      setUploadResult(response.data);
      setAiPreview(response.data?.aiAnalysis || null);
      queryClient.invalidateQueries({ queryKey: ['my-files'] });
      if (response.data?.blockchainPayload) {
        setStage('chain');
        chainMutation.mutate(response.data);
      } else {
        setStage('complete');
        resetAfterSuccess();
      }
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

    const extension = file.name.split('.').pop()?.toLowerCase();
    const allowedType = (extension === 'jpg' || extension === 'jpeg')
      ? ['image/jpeg', 'image/jpg'].includes(file.type)
      : extension === 'png' && file.type === 'image/png';
    if (!allowedType) {
      setError('Unsupported file. Choose a JPEG or PNG image.');
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
      if (!source) return;
      const d = new Date(source);
      form.setValue('capturedAt', new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    } catch {
      /* EXIF is optional; keep the current timestamp */
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

  const buildFormData = (values, extra = {}) => {
    const file = values.evidence?.[0];
    const formData = new FormData();
    formData.append('evidence', file);
    if (values.caseId) formData.append('caseId', values.caseId);
    formData.append('requestAI', String(aiEnabled));
    formData.append('requestBlockchain', String(chainEnabled));
    if (selectedGroup) formData.append('groupId', selectedGroup);
    Object.entries(extra).forEach(([key, value]) => formData.append(key, String(value)));
    formData.append('captureMetadata', JSON.stringify({
      deviceInfo: navigator.userAgent,
      gpsLocation: { latitude: Number(values.latitude), longitude: Number(values.longitude) },
      capturedAt: new Date(values.capturedAt).toISOString()
    }));
    return formData;
  };

  const submit = async (values) => {
    setError('');
    setUploadResult(null);
    setAiPreview(null);
    setTxHash('');
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
      setError('A file is required.');
      return;
    }

    const formData = buildFormData(values);
    pendingFormData.current = values;
    setStage('upload');
    uploadMutation.mutate(formData);
  };

  const storeAnyway = () => {
    const values = pendingFormData.current || form.getValues();
    const formData = buildFormData(values, { confirmStoreDespiteAi: true });
    setStage('upload');
    uploadMutation.mutate(formData);
  };

  const suspicious = useMemo(
    () => Boolean(aiPreview?.deepfakeDetected || aiPreview?.tamperingDetected),
    [aiPreview]
  );

  const activeIndex = STAGE_ORDER.indexOf(stage);
  const busy = uploadMutation.isPending || chainMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Upload file"
        subtitle={
          isEmployee
            ? 'Your organization policy is applied to employee uploads. Suspicious files are quarantined instead of stored as trusted.'
            : 'Files are encrypted before storage. AI analysis and blockchain proof are optional.'
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <form className="section-card" onSubmit={form.handleSubmit(submit)}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="section-title">File &amp; context</h2>
              <p className="section-subtitle">The file and its capture details are stored together</p>
            </div>
            <span className="badge-brand">
              <Lock size={11} />
              Encrypted
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
                    {formatBytes(selectedFile.size)} · {selectedFile.type || 'Unknown type'}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <label
                      htmlFor="evidence-file"
                      className="btn-secondary btn-sm cursor-pointer"
                    >
                      Choose another
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
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <span className="grid h-11 w-11 place-items-center rounded-[11px] border border-line bg-card text-ink-muted shadow-card">
                    <UploadCloud size={20} />
                  </span>
                  <p className="mt-3 text-[13.5px] font-medium text-ink">
                    Drop a file here, or{' '}
                    <label htmlFor="evidence-file" className="cursor-pointer text-brand underline-offset-2 hover:underline">
                      browse
                    </label>
                  </p>
                  <p className="mt-1 text-[12px] text-ink-faint">JPEG or PNG images only</p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="label">Case ID <span className="font-normal text-ink-faint">(optional)</span></span>
              <input className="input" placeholder="CASE-2026-001" {...form.register('caseId')} />
            </label>
            {isEmployee && groups.length > 0 ? (
              <label className="block">
                <span className="label">Group <span className="font-normal text-ink-faint">(optional)</span></span>
                <select
                  className="input"
                  value={selectedGroup}
                  onChange={(e) => setSelectedGroup(e.target.value)}
                >
                  <option value="">No group</option>
                  {groups.map((group) => (
                    <option key={group._id} value={group._id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                <span className="hint">Assign evidence to a group for team access.</span>
              </label>
            ) : (
              <label className="block">
                <span className="label">Captured at</span>
                <input className="input" type="datetime-local" {...form.register('capturedAt')} />
              </label>
            )}
            {!isEmployee || groups.length === 0 ? (
              <label className="block sm:col-span-2">
                <span className="label">Captured at</span>
                <input className="input" type="datetime-local" {...form.register('capturedAt')} />
              </label>
            ) : null}
            <label className="block sm:col-span-2">
              <span className="label">Device fingerprint</span>
              <input className="input bg-[#FBFCFD] text-ink-muted" readOnly {...form.register('deviceInfo')} />
              <span className="hint">Recorded automatically for the audit trail.</span>
            </label>
          </div>

          <div className="mt-5 rounded-[10px] border border-line">
            <div className="border-b border-line px-3.5 py-2.5">
              <p className="text-[13px] font-medium text-ink">Security options</p>
            </div>
            <label className="flex items-start justify-between gap-4 px-3.5 py-3">
              <span>
                <span className="block text-[13px] text-ink">AI authenticity verification</span>
                <span className="mt-0.5 block text-[12px] text-ink-faint">
                  {aiRequired ? 'Required by your organization policy.' : 'Optional. Flags potential manipulation before storage.'}
                </span>
              </span>
              <input
                type="checkbox"
                className="checkbox mt-0.5"
                checked={aiEnabled}
                disabled={aiRequired}
                onChange={(event) => setRequestAI(event.target.checked)}
              />
            </label>
            <label className="flex items-start justify-between gap-4 border-t border-line px-3.5 py-3">
              <span>
                <span className="block text-[13px] text-ink">Blockchain integrity proof</span>
                <span className="mt-0.5 block text-[12px] text-ink-faint">
                  {chainRequired ? 'Required by your organization policy.' : 'Optional. Records the file hash on-chain via MetaMask.'}
                </span>
              </span>
              <input
                type="checkbox"
                className="checkbox mt-0.5"
                checked={chainEnabled}
                disabled={chainRequired}
                onChange={(event) => setRequestBlockchain(event.target.checked)}
              />
            </label>
          </div>

          {error ? (
            <div className="alert-danger mt-4" role="alert">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <div className="flex-1">
                <p className="font-medium">{error}</p>
                {diagnostics ? (
                  <div className="mt-3 text-xs space-y-2 border-t border-red-200 pt-2">
                    <p className="font-semibold">Diagnostics:</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="font-medium text-red-700">Frontend (MetaMask):</p>
                        <p>Account: {diagnostics.frontend.connectedAccount.slice(0, 8)}...{diagnostics.frontend.connectedAccount.slice(-6)}</p>
                        <p>Chain ID: {diagnostics.frontend.chainIdDecimal} (0x{diagnostics.frontend.chainId})</p>
                      </div>
                      <div>
                        <p className="font-medium text-red-700">Backend (RPC):</p>
                        <p>Balance: {diagnostics.backend.balance} ETH</p>
                        <p>Chain ID: {diagnostics.backend.chainId}</p>
                        <p>RPC: {diagnostics.backend.rpcUrl}</p>
                      </div>
                    </div>
                    {diagnostics.frontend.chainIdDecimal !== diagnostics.backend.chainId ? (
                      <p className="text-red-600 font-medium">⚠️ Chain ID mismatch! Frontend on {diagnostics.frontend.chainIdDecimal}, Backend on {diagnostics.backend.chainId}</p>
                    ) : null}
                    {parseFloat(diagnostics.backend.balance) === 0 ? (
                      <p className="text-red-600 font-medium">⚠️ Account has 0 ETH on this network. Switch to a funded Hardhat account.</p>
                    ) : null}
                    {diagnostics.frontend.connectedAccount.toLowerCase() !== uploadResult?.uploaderWallet?.toLowerCase() ? (
                      <p className="text-red-600 font-medium">⚠️ MetaMask account does not match evidence uploader. Switch to account: {uploadResult?.uploaderWallet?.slice(0, 8)}...</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn-primary" disabled={busy}>
              {uploadMutation.isPending ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />}
              {uploadMutation.isPending ? 'Securing file…' : 'Secure file'}
            </button>
            <p className="text-[12px] text-ink-faint">
              Encryption happens before the file leaves the application.
            </p>
          </div>
        </form>

        <div className="space-y-5">
          <section className="section-card">
            <h2 className="section-title">Pipeline</h2>
            <p className="section-subtitle">Where this upload is right now</p>

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

          {aiPreview?.requested ? (
            <section className={`section-card ${suspicious ? 'border-[#f0dfbd]' : 'border-[#c7e9dd]'}`}>
              <div className="flex items-start justify-between gap-3">
                <h2 className="section-title">AI assessment</h2>
                <StatusBadge status={suspicious ? 'quarantine' : 'approved'} label={suspicious ? 'Flagged' : 'Completed'} />
              </div>
              <p className="mt-2 text-[13px] leading-6 text-ink-muted">{aiPreview.explanation}</p>

              <dl className="mt-3 grid grid-cols-3 gap-2">
                {[
                  ['Authenticity', aiPreview.authenticityScore ?? aiPreview.score],
                  ['Tampering', aiPreview.tamperingScore ?? 0],
                  ['Deepfake', aiPreview.deepfakeScore ?? 0]
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[9px] border border-line bg-[#FBFCFD] px-2.5 py-2">
                    <dt className="text-[11px] text-ink-faint">{label}</dt>
                    <dd className="mt-0.5 text-[15px] font-semibold text-ink">{value}%</dd>
                  </div>
                ))}
              </dl>

              <p className="mt-3 text-[11.5px] leading-5 text-ink-faint">
                Automated analysis should not be treated as absolute proof.
              </p>

              {!uploadResult && !isEmployee && aiPreview?.requested ? (
                <button type="button" className="btn-primary btn-sm mt-3" onClick={storeAnyway} disabled={uploadMutation.isPending}>
                  {suspicious ? 'Store anyway' : 'Continue and store'}
                  <ArrowRight size={13} />
                </button>
              ) : null}

              {uploadResult?.status === 'quarantine' ? (
                <p className="alert-warn mt-3">Submitted for administrator review.</p>
              ) : null}
            </section>
          ) : null}

          {uploadResult ? (
            <section className="section-card">
              <div className="flex items-start justify-between gap-3">
                <h2 className="section-title">Result</h2>
                <StatusBadge status={uploadResult.status} />
              </div>
              {uploadResult.statusMessage ? (
                <p className="mt-2 text-[13px] leading-5 text-ink-muted">{uploadResult.statusMessage}</p>
              ) : null}

              <dl className="mt-4 space-y-3">
                <div>
                  <dt className="detail-label">File ID</dt>
                  <dd className="mt-0.5"><span className="text-[13px] text-ink">Available</span></dd>
                </div>
                <div>
                  <dt className="detail-label">File integrity</dt>
                  <dd className="mt-0.5"><span className="text-[13px] text-ink">Available</span></dd>
                </div>
                {uploadResult.ipfsCID ? (
                  <div>
                    <dt className="detail-label">IPFS storage</dt>
                    <dd className="mt-0.5"><span className="text-[13px] text-ink">Stored on IPFS</span></dd>
                  </div>
                ) : null}
                {txHash ? (
                  <div>
                    <dt className="detail-label">Blockchain transaction</dt>
                    <dd className="mt-0.5"><span className="text-[13px] text-ink">Recorded on blockchain</span></dd>
                  </div>
                ) : null}
              </dl>

              {uploadResult.blockchainPayload && !txHash ? (
                <button
                  type="button"
                  className="btn-primary mt-4 w-full"
                  onClick={() => {
                    if (uploadResult.blockchainStatus === 'failed') {
                      retryMutation.mutate(uploadResult.evidenceId);
                    } else {
                      chainMutation.mutate(uploadResult);
                    }
                  }}
                  disabled={chainMutation.isPending || retryMutation.isPending || !EVIDENCE_CONTRACT_ADDRESS}
                >
                  {(chainMutation.isPending || retryMutation.isPending) ? <Loader2 className="animate-spin" size={15} /> : <ShieldCheck size={15} />}
                  {uploadResult.blockchainStatus === 'failed' ? 'Retry blockchain proof' : 'Confirm with MetaMask'}
                </button>
              ) : null}

              {uploadResult.status === 'complete' || uploadResult.storageStatus === 'ipfs' ? (
                <p className="mt-3 flex items-center gap-1.5 text-[13px] text-success">
                  <CheckCircle2 size={14} />
                  Storage complete.
                </p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

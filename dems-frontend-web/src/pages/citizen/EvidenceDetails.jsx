import React, { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import Zoom from 'react-medium-image-zoom';
import 'react-medium-image-zoom/dist/styles.css';

import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  Calendar,
  ChevronDown,
  Download,
  FileText,
  Fingerprint,
  HardDrive,
  Link2,
  Lock,
  Shield,
  ShieldCheck,
  User as UserIcon
} from 'lucide-react';

import StatusBadge from '../../components/StatusBadge.jsx';
import VerificationButton from '../../components/verification/VerificationButton.jsx';
import VerificationResultCard from '../../components/verification/VerificationResultCard.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import FileTypeIcon from '../../components/ui/FileTypeIcon.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import { formatBytes, formatDate, formatRelativeTime } from '../../utils/format.js';
import { downloadEvidence, verifyEvidenceBlockchain } from '../../api/evidence.js';
import { useAuth } from '../../auth/AuthContext.jsx';

const VERIFICATION_LOADING_MESSAGES = [
  'Verifying file integrity…',
  'Checking blockchain records…',
  'Comparing hashes…'
];

function Field({ label, children }) {
  return (
    <div>
      <dt className="detail-label">{label}</dt>
      <dd className="detail-value">{children ?? '—'}</dd>
    </div>
  );
}

function TechnicalSection({ title, description, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-[10px] border border-line">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span>
          <span className="block text-[13px] font-medium text-ink">{title}</span>
          <span className="mt-0.5 block text-[12px] text-ink-faint">{description}</span>
        </span>
        <ChevronDown size={15} className={`shrink-0 text-ink-faint transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? <div className="border-t border-line px-4 py-3.5">{children}</div> : null}
    </div>
  );
}

function AiSummary({ analysis }) {
  if (!analysis?.requested) {
    return (
      <p className="text-[13px] text-ink-muted">
        AI verification was not requested for this file. Authenticity screening is optional.
      </p>
    );
  }

  const flagged = Boolean(analysis.deepfakeDetected || analysis.tamperingDetected);
  const score = analysis.authenticityScore ?? analysis.score ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={flagged ? 'quarantine' : 'approved'} label={flagged ? 'Flagged for review' : 'Completed'} />
        <span className="text-[12.5px] text-ink-muted">Authenticity {score}%</span>
      </div>
      {analysis.explanation ? (
        <p className="mt-2 text-[13px] leading-6 text-ink-muted">{analysis.explanation}</p>
      ) : null}
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Tampering score">{analysis.tamperingScore != null ? `${analysis.tamperingScore}%` : '—'}</Field>
        <Field label="Deepfake score">{analysis.deepfakeScore != null ? `${analysis.deepfakeScore}%` : '—'}</Field>
        <Field label="Model">{analysis.modelVersion || '—'}</Field>
      </dl>
      <p className="mt-3 text-[11.5px] leading-5 text-ink-faint">
        Automated analysis is a signal, not proof. Combine it with blockchain integrity checks.
      </p>
    </div>
  );
}

export default function EvidenceDetails() {
  const { evidenceId } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [verificationError, setVerificationError] = useState('');

  // Determine back link based on user role and referrer
  const getBackLink = () => {
    if (user?.role === 'super_admin') {
      return '/superadmin/evidence';
    }
    if (user?.role === 'admin') {
      return '/admin/evidence';
    }
    return '/citizen/evidence-vault';
  };

  const getBackLabel = () => {
    if (user?.role === 'super_admin') {
      return 'Global evidence';
    }
    if (user?.role === 'admin') {
      return 'Organization evidence';
    }
    return 'My files';
  };

  const { data, isLoading, error } = useQuery({
    queryKey: ['evidence', evidenceId],
    queryFn: () => downloadEvidence(evidenceId),
    enabled: !!evidenceId
  });

  const verifyMutation = useMutation({
    mutationFn: () => verifyEvidenceBlockchain(evidenceId),
    onMutate: () => setVerificationError(''),
    onError: (err) => {
      setVerificationError(err.response?.data?.message || err.message || 'Verification request failed.');
    }
  });

  useEffect(() => {
    if (!verifyMutation.isPending) {
      setLoadingMessageIndex(0);
      return undefined;
    }
    const interval = setInterval(() => {
      setLoadingMessageIndex((current) => (current + 1) % VERIFICATION_LOADING_MESSAGES.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [verifyMutation.isPending]);

  const evidence = data?.data;
  const canViewImage = user?.role === 'admin' || user?.role === 'super_admin';

  if (isLoading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <span className="skeleton h-6 w-40" />
        <div className="section-card">
          <div className="flex items-center gap-4">
            <span className="skeleton h-12 w-12 rounded-[11px]" />
            <div className="flex-1 space-y-2">
              <span className="skeleton block h-4 w-1/3" />
              <span className="skeleton block h-3 w-1/4" />
            </div>
          </div>
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div className="section-card space-y-3">
            <span className="skeleton block h-3 w-full" />
            <span className="skeleton block h-3 w-5/6" />
            <span className="skeleton block h-3 w-2/3" />
          </div>
          <div className="section-card space-y-3">
            <span className="skeleton block h-3 w-full" />
            <span className="skeleton block h-3 w-3/4" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="File could not be loaded"
        description="The file may have been removed, or you may not have access to it."
        action={
          <Link to={getBackLink()} className="btn-secondary btn-sm">
            <ArrowLeft size={14} />
            Back to files
          </Link>
        }
      />
    );
  }

  if (!evidence) {
    return (
      <EmptyState
        icon={FileText}
        title="File not found"
        description="This record does not exist or is no longer available."
        action={
          <Link to={getBackLink()} className="btn-secondary btn-sm">
            <ArrowLeft size={14} />
            Back to files
          </Link>
        }
      />
    );
  }

  const fileUrl = canViewImage && evidence.fileContent ? `data:${evidence.mimeType};base64,${evidence.fileContent}` : '';
  const chainStatus = evidence.blockchainStatus || (evidence.blockchainTxHash ? 'confirmed' : 'not_requested');
  const storageStatus = evidence.storageStatus || (evidence.ipfsCID ? 'ipfs' : 'not_stored');
  const isPreviewable = Boolean(
    evidence.fileContent && (evidence.mimeType?.startsWith('image/') || evidence.mimeType === 'application/pdf')
  );

  return (
    <div className="space-y-6">
      <div>
        <Link
          to={getBackLink()}
          className="mb-3 inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted transition hover:text-ink"
        >
          <ArrowLeft size={13} />
          {getBackLabel()}
        </Link>
        <PageHeader
          title={evidence.fileName}
          subtitle={`Uploaded ${formatDate(evidence.createdAt)}`}
          meta={
            <>
              <StatusBadge status={evidence.status} />
              <StatusBadge status={storageStatus} />
              <StatusBadge status={chainStatus} />
              <span className="text-[12.5px] text-ink-faint">
                {evidence.caseId ? `Case ${evidence.caseId}` : 'Personal file'}
              </span>
            </>
          }
          actions={
            canViewImage && fileUrl ? (
              <a href={fileUrl} download={evidence.fileName} className="btn-primary">
                <Download size={15} />
                Download
              </a>
            ) : null
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {canViewImage && isPreviewable ? (
            <section className="panel overflow-hidden">
              <div className="card-header">
                <div className="flex items-center gap-3">
                  <FileTypeIcon mimeType={evidence.mimeType} fileName={evidence.fileName} size="sm" />
                  <div>
                    <h2 className="section-title">Preview</h2>
                    <p className="section-subtitle">Decrypted for your session</p>
                  </div>
                </div>
              </div>
              <div className="bg-[#FAFBFC] p-4">
                {evidence.mimeType?.startsWith('image/') ? (
                  <Zoom>
                    <img
                      src={fileUrl}
                      alt={evidence.fileName}
                      className="mx-auto max-h-[640px] w-full cursor-zoom-in rounded-[9px] object-contain"
                    />
                  </Zoom>
                ) : (
                  <div className="flex flex-col items-center justify-center rounded-[9px] border border-line bg-card py-14">
                    <FileText size={28} className="text-ink-faint" />
                    <p className="mt-3 text-[13px] font-medium text-ink">PDF document</p>
                    <p className="mt-1 text-[12px] text-ink-muted">Download to view the full document.</p>
                  </div>
                )}
              </div>
            </section>
          ) : !canViewImage ? (
            <section className="panel flex items-center gap-3 p-4">
              <FileTypeIcon mimeType={evidence.mimeType} fileName={evidence.fileName} size="sm" />
              <div>
                <h2 className="section-title">Image details</h2>
                <p className="section-subtitle">The original image is not displayed in the user interface.</p>
              </div>
            </section>
          ) : null}

          <section className="section-card">
            <h2 className="section-title">File information</h2>
            <p className="section-subtitle">What this file is and where it came from</p>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field label="File name">{evidence.fileName}</Field>
              <Field label="Type">{evidence.mimeType}</Field>
              <Field label="Size">{formatBytes(evidence.fileSize)}</Field>
              <Field label="Uploaded">
                <span title={formatDate(evidence.createdAt)}>{formatRelativeTime(evidence.createdAt)}</span>
              </Field>
              <Field label="Owner">
                <span className="inline-flex items-center gap-1.5">
                  <UserIcon size={13} className="text-ink-faint" />
                  <span className="text-[13px] text-ink">Authorized uploader</span>
                </span>
              </Field>
              <Field label="Organization">
                {evidence.organizationId ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 size={13} className="text-ink-faint" />
                    Organization-assigned
                  </span>
                ) : (
                  <span className="text-ink-muted">Personal</span>
                )}
              </Field>
              <Field label="Case ID">{evidence.caseId || <span className="text-ink-muted">Personal file</span>}</Field>
              <Field label="Version">{evidence.versionNumber ?? 1}</Field>
            </dl>
          </section>

          <section className="section-card">
            <h2 className="section-title">AI verification</h2>
            <p className="section-subtitle">Automated authenticity screening, when requested</p>
            <div className="mt-4">
              <AiSummary analysis={evidence.aiAnalysis} />
            </div>
          </section>
        </div>

        <div className="space-y-5">
          <section className="section-card">
            <h2 className="section-title">Protection</h2>
            <p className="section-subtitle">Three separate guarantees</p>
            <ul className="mt-4 space-y-3">
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-success-soft text-success">
                  <Lock size={14} />
                </span>
                <div>
                  <p className="text-[13px] font-medium text-ink">Encryption: enabled</p>
                  <p className="text-[12px] leading-5 text-ink-faint">
                    Stored with AES-256-GCM. Encryption is applied by DEMS before storage — IPFS itself does not encrypt content.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[7px] bg-brand-soft text-brand">
                  <HardDrive size={14} />
                </span>
                <div>
                  <p className="text-[13px] font-medium text-ink">
                    IPFS storage: {evidence.ipfsCID ? 'available' : 'not stored'}
                  </p>
                  <p className="text-[12px] leading-5 text-ink-faint">
                    {evidence.ipfsCID
                      ? 'Content is retrievable by its content identifier.'
                      : 'This file has no decentralized storage record.'}
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-2.5">
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-[7px] ${
                  evidence.blockchainTxHash ? 'bg-success-soft text-success' : 'bg-surface text-ink-muted'
                }`}>
                  <ShieldCheck size={14} />
                </span>
                <div>
                  <p className="text-[13px] font-medium text-ink">
                    Blockchain integrity: {evidence.blockchainTxHash ? 'recorded' : 'not requested'}
                  </p>
                  <p className="text-[12px] leading-5 text-ink-faint">
                    {evidence.blockchainTxHash
                      ? 'An on-chain hash proves the file has not changed since verification.'
                      : 'No on-chain proof exists for this file.'}
                  </p>
                </div>
              </li>
            </ul>
          </section>

          <section className="section-card">
            <h2 className="section-title">Technical details</h2>
            <p className="section-subtitle">Verification status and identifiers</p>
            <div className="mt-3 space-y-2">
              <TechnicalSection
                title="File integrity"
                description="Cryptographic hash verification status"
                defaultOpen
              >
                <div className="flex items-center gap-2">
                  <Fingerprint size={13} className="shrink-0 text-ink-faint" />
                  <span className="text-[13px] text-ink">Available</span>
                </div>
              </TechnicalSection>

              <TechnicalSection title="IPFS storage" description="Decentralized content addressable storage">
                {evidence.ipfsCID ? (
                  <div className="flex items-center gap-2">
                    <Link2 size={13} className="shrink-0 text-ink-faint" />
                    <span className="text-[13px] text-ink">Stored on IPFS</span>
                  </div>
                ) : (
                  <p className="text-[12.5px] text-ink-muted">Not stored on IPFS.</p>
                )}
              </TechnicalSection>

              <TechnicalSection title="Blockchain transaction" description="On-chain integrity proof">
                {evidence.blockchainTxHash ? (
                  <div className="flex items-center gap-2">
                    <Shield size={13} className="shrink-0 text-ink-faint" />
                    <span className="text-[13px] text-ink">Recorded on blockchain</span>
                  </div>
                ) : (
                  <p className="text-[12.5px] text-ink-muted">No transaction recorded.</p>
                )}
              </TechnicalSection>

              <TechnicalSection title="Record metadata" description="Storage, review and audit fields">
                <dl className="grid gap-3 sm:grid-cols-2">
                  <Field label="Record ID">Available</Field>
                  <Field label="Storage status">{storageStatus}</Field>
                  <Field label="Blockchain status">{chainStatus}</Field>
                  <Field label="Review status">{evidence.reviewStatus || 'not_required'}</Field>
                  <Field label="Created">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar size={12} className="text-ink-faint" />
                      {formatDate(evidence.createdAt)}
                    </span>
                  </Field>
                  <Field label="Encryption method">{evidence.encryptionMethod || 'AES-256'}</Field>
                </dl>
              </TechnicalSection>
            </div>
          </section>

          <section className="section-card">
            <h2 className="section-title">Blockchain integrity check</h2>
            <p className="section-subtitle">
              Compares stored metadata, IPFS content and the on-chain proof.
            </p>

            <div className="mt-4">
              {evidence.status === 'stored_on_chain' || evidence.blockchainTxHash ? (
                <VerificationButton
                  onVerify={() => verifyMutation.mutate()}
                  isLoading={verifyMutation.isPending}
                  loadingMessage={VERIFICATION_LOADING_MESSAGES[loadingMessageIndex]}
                />
              ) : (
                <p className="alert-warn">
                  No blockchain proof was recorded for this file, so on-chain verification is unavailable.
                </p>
              )}
            </div>

            {verificationError ? (
              <div className="alert-danger mt-3" role="alert">{verificationError}</div>
            ) : null}
          </section>
        </div>
      </div>

      {verifyMutation.data ? <VerificationResultCard result={verifyMutation.data} /> : null}
    </div>
  );
}

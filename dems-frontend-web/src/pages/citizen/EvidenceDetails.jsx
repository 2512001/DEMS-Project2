import React, { useEffect, useState } from 'react';
import { useParams, Link, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Zoom from 'react-medium-image-zoom';
import 'react-medium-image-zoom/dist/styles.css';

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Building2,
  Calendar,
  ChevronDown,
  Clock,
  Eye,
  FileText,
  Fingerprint,
  HardDrive,
  Link2,
  Lock,
  Plus,
  Shield,
  ShieldCheck,
  Unlock,
  User as UserIcon,
  XCircle,
  Ban
} from 'lucide-react';

import StatusBadge from '../../components/StatusBadge.jsx';
import VerificationButton from '../../components/verification/VerificationButton.jsx';
import VerificationResultCard from '../../components/verification/VerificationResultCard.jsx';
import VerificationStatusPanel from '../../components/verification/VerificationStatusPanel.jsx';
import PageHeader from '../../components/ui/PageHeader.jsx';
import FileTypeIcon from '../../components/ui/FileTypeIcon.jsx';
import EmptyState from '../../components/ui/EmptyState.jsx';
import RequestViewAccessModal from '../../components/viewAccess/RequestViewAccessModal.jsx';
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
  const queryClient = useQueryClient();
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [verificationError, setVerificationError] = useState('');
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [requestScope, setRequestScope] = useState('evidence');
  const [countdown, setCountdown] = useState('');

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
  const activePermission = evidence?.activePermission;
  const latestRequest = evidence?.latestRequest;
  const userAccessStatus = evidence?.userAccessStatus || (evidence?.canViewImage ? 'approved' : 'access_required');
  const isPrivilegedUser = user?.role === 'admin' || user?.role === 'super_admin';
  const canViewImage = Boolean(evidence?.canViewImage && evidence?.fileContent);

  useEffect(() => {
    if (!activePermission?.expiresAt) {
      setCountdown('');
      return undefined;
    }
    const updateCountdown = () => {
      const now = Date.now();
      const expires = new Date(activePermission.expiresAt).getTime();
      const diff = expires - now;
      if (diff <= 0) {
        setCountdown('Access Expired');
        queryClient.invalidateQueries({ queryKey: ['evidence', evidenceId] });
      } else {
        const hours = Math.floor(diff / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);
        if (hours > 0) {
          setCountdown(`${hours}h ${minutes}m ${seconds}s`);
        } else {
          setCountdown(`${minutes}m ${seconds}s`);
        }
      }
    };
    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, [activePermission?.expiresAt, evidenceId, queryClient]);

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
            userAccessStatus === 'pending' ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/30 bg-warn-soft px-3 py-1.5 text-[12px] font-medium text-warn">
                <Clock size={13} className="animate-pulse" />
                Request Pending Review
              </span>
            ) : (
              <button
                type="button"
                onClick={() => { setRequestScope('evidence'); setShowRequestModal(true); }}
                className="btn-primary"
              >
                <Eye size={15} />
                Request View Access
              </button>
            )
          }
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          {canViewImage && isPreviewable ? (
            <section className="panel overflow-hidden">
              {activePermission && !activePermission.isOwner && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-success/20 bg-success-soft px-4 py-2.5">
                  <div className="flex items-center gap-2 text-success text-[12.5px] font-medium">
                    <Unlock size={15} />
                    <span>Temporary View Access Active ({activePermission.scope?.toUpperCase()} Scope)</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[12px] font-semibold text-success">
                    <Clock size={13} />
                    <span>Expires in: {countdown || 'Active'}</span>
                  </div>
                </div>
              )}
              <div className="card-header">
                <div className="flex items-center gap-3">
                  <FileTypeIcon mimeType={evidence.mimeType} fileName={evidence.fileName} size="sm" />
                  <div>
                    <h2 className="section-title">Decrypted Preview</h2>
                    <p className="section-subtitle">Decrypted in-memory for your authorized session</p>
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
          ) : userAccessStatus === 'pending' ? (
            <section className="panel p-6 text-center border-l-4 border-l-warn">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-warn-soft text-warn mb-3">
                <Clock size={22} className="animate-pulse" />
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-warn-soft text-warn text-[12px] font-semibold mb-2">
                Request Pending
              </div>
              <h2 className="text-[16px] font-semibold text-ink">View Request Awaiting Approval</h2>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-muted">
                Your view access request <strong>{latestRequest?.requestId}</strong> for {latestRequest?.requestedDuration} is currently awaiting required administrative approval.
              </p>
              <div className="mt-4 rounded-[8px] border border-line bg-surface p-3 max-w-sm mx-auto text-left text-[12px] space-y-1 text-ink-muted">
                <div><span className="text-ink font-medium">Target file:</span> {evidence.fileName}</div>
                <div><span className="text-ink font-medium">Requested:</span> {formatDate(latestRequest?.createdAt)}</div>
                <div><span className="text-ink font-medium">Reason:</span> "{latestRequest?.reason}"</div>
              </div>
            </section>
          ) : userAccessStatus === 'rejected' ? (
            <section className="panel p-6 text-center border-l-4 border-l-danger">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger mb-3">
                <XCircle size={22} />
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-danger-soft text-danger text-[12px] font-semibold mb-2">
                Request Rejected
              </div>
              <h2 className="text-[16px] font-semibold text-ink">View Request Not Approved</h2>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-muted">
                Your previous request <strong>{latestRequest?.requestId}</strong> was rejected.
                {latestRequest?.rejectionReason && (
                  <span className="block mt-1 text-danger font-medium">"{latestRequest.rejectionReason}"</span>
                )}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => { setRequestScope('evidence'); setShowRequestModal(true); }}
                  className="btn-primary"
                >
                  <Eye size={14} />
                  Submit New Request
                </button>
              </div>
            </section>
          ) : userAccessStatus === 'expired' ? (
            <section className="panel p-6 text-center border-l-4 border-l-line">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface text-ink-muted mb-3">
                <Clock size={22} />
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-surface text-ink-muted text-[12px] font-semibold mb-2">
                Access Expired
              </div>
              <h2 className="text-[16px] font-semibold text-ink">View Access Has Expired</h2>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-muted">
                Your approved viewing period for this evidence has ended. Submit a new view access request if you require continued inspection.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => { setRequestScope('evidence'); setShowRequestModal(true); }}
                  className="btn-primary"
                >
                  <Eye size={14} />
                  Request View Access
                </button>
              </div>
            </section>
          ) : userAccessStatus === 'revoked' ? (
            <section className="panel p-6 text-center border-l-4 border-l-danger">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger mb-3">
                <Ban size={22} />
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-danger-soft text-danger text-[12px] font-semibold mb-2">
                Access Revoked
              </div>
              <h2 className="text-[16px] font-semibold text-ink">View Permission Revoked</h2>
              <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-ink-muted">
                Your active view permission for this file was revoked by an administrator
                {latestRequest?.revocationReason ? `: "${latestRequest.revocationReason}"` : '.'}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => { setRequestScope('evidence'); setShowRequestModal(true); }}
                  className="btn-primary"
                >
                  <Eye size={14} />
                  Request View Access
                </button>
              </div>
            </section>
          ) : (
            <section className="panel p-6 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand mb-3">
                <Lock size={22} />
              </div>
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-soft text-brand text-[12px] font-semibold mb-2">
                Access Required
              </div>
              <h2 className="text-[16px] font-semibold text-ink">Protected Evidence Content</h2>
              <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-ink-muted">
                Under DEMS Two-Way Authorization rules, viewing decrypted evidence requires prior approval. Request temporary access to inspect this file.
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => { setRequestScope('evidence'); setShowRequestModal(true); }}
                  className="btn-primary"
                >
                  <Eye size={14} />
                  Request View Access (Evidence)
                </button>
                {evidence.caseId && (
                  <button
                    type="button"
                    onClick={() => { setRequestScope('case'); setShowRequestModal(true); }}
                    className="btn-secondary"
                  >
                    <Archive size={14} />
                    Request Case Access ({evidence.caseId})
                  </button>
                )}
              </div>
              <p className="mt-4 border-t border-line pt-3 text-[12px] text-ink-faint">
                {user?.role === 'admin'
                  ? 'Request will be sent to Super Admin for authorization.'
                  : user?.role === 'super_admin'
                  ? 'Request will be sent to the relevant Organization Admin for authorization.'
                  : 'Request will be sent to your Organization Admin for review.'}
              </p>
            </section>
          )}

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

            </ul>
            <div className="mt-4">
              <VerificationStatusPanel item={evidence} />
            </div>
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
                {evidence.verification?.ipfsStorage === 'Verified' || evidence.storageStatus === 'ipfs' || evidence.ipfsCID ? (
                  <div className="flex items-center gap-2">
                    <Link2 size={13} className="shrink-0 text-ink-faint" />
                    <span className="text-[13px] text-ink">Stored on IPFS</span>
                  </div>
                ) : (
                  <p className="text-[12.5px] text-ink-muted">Not stored on IPFS.</p>
                )}
              </TechnicalSection>

              <TechnicalSection title="Blockchain transaction" description="On-chain integrity proof">
                {evidence.verification?.blockchainIntegrity === 'Verified' || evidence.blockchainStatus === 'confirmed' || evidence.blockchainTxHash ? (
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
              {evidence.verification?.blockchainIntegrity === 'Verified' || evidence.status === 'stored_on_chain' || evidence.blockchainTxHash ? (
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

      <RequestViewAccessModal
        open={showRequestModal}
        onClose={() => setShowRequestModal(false)}
        initialTargetType={requestScope}
        initialTargetId={requestScope === 'case' ? (evidence.caseId || '') : evidence._id}
        initialTargetName={requestScope === 'case' ? `Case ${evidence.caseId}` : evidence.fileName}
        initialOrgId={evidence.organizationId?._id || evidence.organizationId || ''}
        lockedTarget
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['evidence', evidenceId] });
        }}
      />
    </div>
  );
}

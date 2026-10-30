import React from 'react';
import {
  AlertCircle,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Database,
  Lock,
  MinusCircle,
  ShieldCheck,
  XCircle
} from 'lucide-react';

const BRAND = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#d5e2fb] bg-brand-soft px-2 py-0.5 text-[11.5px] font-medium leading-5 text-brand';
const SUCCESS = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#c7e9dd] bg-success-soft px-2 py-0.5 text-[11.5px] font-medium leading-5 text-success';
const WARN = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#f0dfbd] bg-warn-soft px-2 py-0.5 text-[11.5px] font-medium leading-5 text-warn';
const DANGER = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#f4caca] bg-danger-soft px-2 py-0.5 text-[11.5px] font-medium leading-5 text-danger';
const NEUTRAL = 'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-line bg-surface px-2 py-0.5 text-[11.5px] font-medium leading-5 text-ink-muted';

/**
 * One vocabulary for every status the API returns. Values map to the same
 * semantic tones used across the product: success = verified, warn = pending,
 * danger = failure, brand = active work, neutral = nothing requested.
 */
const STATUS_MAP = {
  stored_on_chain: { label: 'Blockchain verified', tone: SUCCESS, Icon: ShieldCheck },
  stored_ipfs: { label: 'Stored on IPFS', tone: SUCCESS, Icon: Database },
  encrypted: { label: 'Encrypted', tone: BRAND, Icon: Lock },
  confirmed: { label: 'Confirmed', tone: SUCCESS, Icon: CheckCircle2 },
  verified: { label: 'Verified', tone: SUCCESS, Icon: ShieldCheck },
  approved: { label: 'Approved', tone: SUCCESS, Icon: CheckCircle2 },
  active: { label: 'Active', tone: SUCCESS, Icon: CheckCircle2 },
  complete: { label: 'Complete', tone: SUCCESS, Icon: CheckCircle2 },
  ipfs: { label: 'IPFS stored', tone: SUCCESS, Icon: Database },
  ipfs_stored: { label: 'IPFS stored', tone: BRAND, Icon: Database },
  pending_blockchain: { label: 'Blockchain pending', tone: WARN, Icon: Clock },
  blockchain_pending: { label: 'Blockchain pending', tone: WARN, Icon: Clock },
  pending_review: { label: 'Pending review', tone: WARN, Icon: Clock },
  pending_approval: { label: 'Pending approval', tone: WARN, Icon: Clock },
  pending_org_admin_approval: { label: 'Pending admin review', tone: WARN, Icon: Clock },
  approved_processing: { label: 'Approved — Processing', tone: BRAND, Icon: Clock },
  finalized: { label: 'Finalized', tone: SUCCESS, Icon: CheckCircle2 },
  processing_failed: { label: 'Processing failed', tone: DANGER, Icon: AlertCircle },
  cleanup_pending: { label: 'Cleanup pending', tone: WARN, Icon: Clock },
  cleaned: { label: 'Cleaned', tone: NEUTRAL, Icon: CheckCircle2 },
  pending: { label: 'Pending', tone: WARN, Icon: Clock },
  processing: { label: 'Processing', tone: BRAND, Icon: Clock },
  quarantine: { label: 'In quarantine', tone: WARN, Icon: AlertTriangle },
  quarantined: { label: 'Quarantined', tone: WARN, Icon: AlertTriangle },
  rejected: { label: 'Rejected', tone: DANGER, Icon: XCircle },
  failed: { label: 'Failed', tone: DANGER, Icon: XCircle },
  error: { label: 'Error', tone: DANGER, Icon: AlertCircle },
  suspended: { label: 'Suspended', tone: DANGER, Icon: XCircle },
  none: { label: 'Not verified', tone: NEUTRAL, Icon: MinusCircle },
  not_required: { label: 'Not required', tone: NEUTRAL, Icon: MinusCircle },
  not_requested: { label: 'Not requested', tone: NEUTRAL, Icon: MinusCircle },
  not_stored: { label: 'Not stored', tone: NEUTRAL, Icon: MinusCircle },
  unverified: { label: 'Unverified', tone: NEUTRAL, Icon: MinusCircle }
};

export default function StatusBadge({ status = 'pending', label, className = '' }) {
  const key = String(status || 'pending').toLowerCase();
  const config = STATUS_MAP[key] || {
    label: String(status || 'Unknown').replaceAll('_', ' '),
    tone: NEUTRAL,
    Icon: BadgeCheck
  };
  const Icon = config.Icon;

  return (
    <span
      className={`${config.tone} ${className}`}
      title={label || config.label}
    >
      <Icon size={11} strokeWidth={2.2} aria-hidden="true" />
      <span className="capitalize">{label || config.label}</span>
    </span>
  );
}

export function toneForStatus(status = '') {
  const key = String(status).toLowerCase();
  const config = STATUS_MAP[key];
  if (!config) return 'neutral';
  if (config.tone === SUCCESS) return 'success';
  if (config.tone === WARN) return 'warn';
  if (config.tone === DANGER) return 'danger';
  if (config.tone === BRAND) return 'brand';
  return 'neutral';
}

import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import VerificationStatusBadge, { VerificationBanner } from './VerificationStatusBadge.jsx';
import VerificationComparisonTable from './VerificationComparisonTable.jsx';
import VerificationStatusPanel from './VerificationStatusPanel.jsx';
import { formatDate } from '../../utils/format.js';

function CheckCard({ label, matched }) {
  return (
    <div className={`rounded-[10px] border p-3.5 ${matched ? 'border-[#c7e9dd] bg-success-soft/60' : 'border-[#f4caca] bg-danger-soft/60'}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-medium text-ink-muted">{label}</p>
        {matched ? (
          <CheckCircle2 size={15} className="shrink-0 text-success" />
        ) : (
          <XCircle size={15} className="shrink-0 text-danger" />
        )}
      </div>
      <p className={`mt-1.5 text-[13px] font-semibold ${matched ? 'text-success' : 'text-danger'}`}>
        {matched ? 'Match' : 'Mismatch'}
      </p>
    </div>
  );
}

function Section({ title, description, children }) {
  return (
    <section>
      <h3 className="text-[13.5px] font-semibold text-ink">{title}</h3>
      {description ? <p className="mt-0.5 text-[12px] text-ink-muted">{description}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function VerificationResultCard({ result }) {
  if (!result) return null;

  const isVerified = result.verificationStatus === 'VERIFIED';
  const { blockchainData, comparisons, mismatches, checks, message, verifiedAt } = result;

  const checkList = checks?.length
    ? checks.map((check) => check.matched)
    : [
        comparisons?.hashesAligned ?? (comparisons?.hashMatched && comparisons?.generatedHashMatched),
        comparisons?.cidMatched,
        comparisons?.uploaderMatched,
        comparisons?.evidenceIdMatched
      ];
  const passed = checkList.filter(Boolean).length;
  const total = checkList.length || 1;
  const score = Math.round((passed / total) * 100);

  return (
    <div className="space-y-5">
      <VerificationBanner
        verified={isVerified}
        message={message}
        verifiedAt={verifiedAt}
        transactionHash={blockchainData?.transactionHash}
      />

      <VerificationStatusPanel item={{ ...result, status: isVerified ? 'stored_on_chain' : 'error', integrityVerified: isVerified, verifiedAt }} />

      <div className="section-card">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="section-title">Integrity score</h3>
            <p className="section-subtitle">
              {score === 100 ? 'All integrity checks passed' : `${total - passed} check${total - passed === 1 ? '' : 's'} failed`}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <VerificationStatusBadge status={result.verificationStatus} />
            <p className={`text-[28px] font-semibold leading-none ${score === 100 ? 'text-success' : 'text-danger'}`}>
              {score}
              <span className="ml-1 text-[12px] font-normal text-ink-faint">/ 100</span>
            </p>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-surface">
          <div
            className={`h-full rounded-full ${score === 100 ? 'bg-success' : 'bg-danger'}`}
            style={{ width: `${score}%` }}
          />
        </div>
      </div>

      <div className="section-card">
        <Section title="Integrity checks" description="Each source is compared independently">
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            <CheckCard label="Stored hash" matched={comparisons?.hashesAligned ?? comparisons?.hashMatched} />
            <CheckCard label="IPFS content hash" matched={comparisons?.hashesAligned ?? comparisons?.generatedHashMatched} />
            <CheckCard label="Blockchain hash" matched={comparisons?.hashesAligned ?? comparisons?.hashMatched} />
            <CheckCard label="IPFS CID" matched={comparisons?.cidMatched} />
            <CheckCard label="Uploader" matched={comparisons?.uploaderMatched} />
            <CheckCard label="File ID" matched={comparisons?.evidenceIdMatched} />
          </div>
        </Section>
      </div>

      <Section title="Source comparison" description="A field-by-field view of every source">
        <VerificationComparisonTable checks={checks} mismatches={mismatches} />
      </Section>

      {blockchainData ? (
        <div className="section-card">
          <Section title="Blockchain proof" description="Recorded on the connected network">
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="detail-label">Verification time</dt>
                <dd className="detail-value">{formatDate(verifiedAt)}</dd>
              </div>
              <div>
                <dt className="detail-label">On-chain timestamp</dt>
                <dd className="detail-value">{formatDate(blockchainData.uploadedAt)}</dd>
              </div>
              <div>
                <dt className="detail-label">Wallet address</dt>
                <dd className="mt-1"><span className="text-[13px] text-ink">Authorized uploader</span></dd>
              </div>
              <div>
                <dt className="detail-label">Transaction hash</dt>
                <dd className="mt-1"><span className="text-[13px] text-ink">Recorded on blockchain</span></dd>
              </div>
              <div>
                <dt className="detail-label">IPFS CID</dt>
                <dd className="mt-1"><span className="text-[13px] text-ink">Stored on IPFS</span></dd>
              </div>
            </dl>
          </Section>
        </div>
      ) : null}
    </div>
  );
}

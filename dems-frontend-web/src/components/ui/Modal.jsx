import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

export default function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md'
}) {
  const panelRef = useRef(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const handleKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const widths = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl'
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center p-0 sm:items-center sm:p-6">
      <button
        type="button"
        className="absolute inset-0 animate-fade-in bg-[#172033]/40 backdrop-blur-[2px]"
        onClick={onClose}
        aria-label="Close dialog"
        tabIndex={-1}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`relative w-full ${widths[size]} max-h-[90dvh] flex flex-col animate-slide-up rounded-t-[14px] border border-line bg-card shadow-pop outline-none sm:rounded-card`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4 shrink-0">
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold text-ink">{title}</h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-[13px] leading-5 text-ink-muted">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid h-7 w-7 shrink-0 place-items-center rounded text-ink-faint transition hover:bg-surface hover:text-ink"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto min-h-0">{children}</div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line bg-[#FBFCFD] px-5 py-3.5 shrink-0">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

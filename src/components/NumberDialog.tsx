"use client";

import { useEffect, useRef, useState } from "react";

type NumberDialogProps = {
  open: boolean;
  onClose: () => void;
  display: string;
  e164: string;
};

/**
 * The number popup. Uses a native <dialog> so Escape, focus handling, and the
 * backdrop come from the platform rather than being re-implemented.
 */
export default function NumberDialog({ open, onClose, display, e164 }: NumberDialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    if (!open && node.open) node.close();
    if (!open) setCopied(false);
  }, [open]);

  async function copyNumber() {
    try {
      await navigator.clipboard.writeText(e164);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <dialog
      ref={ref}
      className="number-dialog"
      aria-labelledby="number-dialog-title"
      onClose={onClose}
      onClick={(event) => {
        // A click that lands on the dialog element itself is the backdrop.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="nd-inner">
        <button className="nd-close" type="button" onClick={onClose} aria-label="Close">
          ×
        </button>

        <p className="eyebrow">Text Viand</p>
        <p className="nd-number" id="number-dialog-title">
          {display}
        </p>
        <p className="nd-note">
          Text it yourself, or drop the number into your group chat and say hey.
          No app, no signup.
        </p>

        <div className="nd-actions">
          <a className="btn btn-primary" href={`sms:${e164}?body=Hey Viand`}>
            Open in Messages
          </a>
          <button className="btn btn-ghost" type="button" onClick={() => void copyNumber()}>
            {copied ? "Copied" : "Copy number"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

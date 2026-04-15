import { useEffect } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ title, message, confirmLabel = "Delete", onConfirm, onCancel }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
        <h3 id="confirm-modal-title" style={{ color: "#dc2626", marginBottom: 12 }}>{title}</h3>
        <p style={{ color: "#374151", fontSize: 14, lineHeight: 1.5, marginBottom: 20 }}>{message}</p>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button
            className="btn"
            style={{ background: "#dc2626", color: "white", border: "none" }}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

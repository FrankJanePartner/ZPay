import { useRef, useState } from "react";

export function CopyButton({ value, label }: { value: string; label: string }) {
  const [message, setMessage] = useState("");
  const currentAttempt = useRef(0);

  async function copyValue() {
    const attempt = ++currentAttempt.current;
    setMessage("");
    try {
      if (!navigator.clipboard) {
        throw new Error("Clipboard is unavailable");
      }
      await navigator.clipboard.writeText(value);
      if (currentAttempt.current === attempt) {
        setMessage("Copied");
      }
    } catch {
      if (currentAttempt.current === attempt) {
        setMessage("Copy failed");
      }
    }
  }

  return (
    <>
      <button type="button" className="copy-button" aria-label={`Copy ${label}`} onClick={() => void copyValue()}>
        Copy
      </button>
      <span role="status" aria-label={`${label} copy status`} aria-live="polite" aria-atomic="true" className="copy-status">{message}</span>
    </>
  );
}

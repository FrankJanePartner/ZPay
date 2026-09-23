import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalDialogProps {
  children: ReactNode;
  labelledBy: string;
  describedBy?: string;
  role?: "dialog" | "alertdialog";
  dismissDisabled?: boolean;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  onDismiss: () => void;
}

interface SiblingState {
  element: Element;
  inert: boolean;
  ariaHidden: string | null;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hidden && element.getAttribute("aria-hidden") !== "true",
  );
}

export function ModalDialog({
  children,
  labelledBy,
  describedBy,
  role = "dialog",
  dismissDisabled = false,
  fallbackFocusRef,
  onDismiss,
}: ModalDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const backdrop = dialog.parentElement;
    const siblings: SiblingState[] = Array.from(document.body.children)
      .filter((element) => element !== backdrop)
      .map((element) => ({
        element,
        inert: element.hasAttribute("inert"),
        ariaHidden: element.getAttribute("aria-hidden"),
      }));

    for (const { element } of siblings) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }

    (focusableElements(dialog)[0] ?? dialog).focus();

    return () => {
      for (const { element, inert, ariaHidden } of siblings) {
        if (!inert) element.removeAttribute("inert");
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }

      const restoreTarget = opener?.isConnected ? opener : fallbackFocusRef?.current;
      restoreTarget?.focus();
    };
  }, [fallbackFocusRef]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (!dismissDisabled) onDismiss();
      return;
    }
    if (event.key !== "Tab") return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = focusableElements(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  return createPortal(
    <div className="dialog-backdrop">
      <div
        ref={dialogRef}
        className="secure-dialog"
        role={role}
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

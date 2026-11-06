import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Adds focus entry, Escape dismissal, focus containment and trigger restoration to a modal dialog. */
export function useAccessibleModal<T extends HTMLElement>(
  isOpen: boolean,
  onClose: () => void,
) {
  const dialogRef = useRef<T>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previousFocus =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const getFocusable = () =>
      Array.from(
        dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((element) => element.getClientRects().length > 0);
    const requestedInitialFocus = dialog.querySelector<HTMLElement>(
      "[data-dialog-initial-focus]",
    );
    (requestedInitialFocus ?? getFocusable()[0] ?? dialog).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      // Only the uppermost open dialog handles keys; nested dialogs must not fight their parent.
      const openDialogs = document.querySelectorAll<HTMLElement>(
        '[data-accessible-dialog="true"]',
      );
      if (openDialogs.item(openDialogs.length - 1) !== dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (
        event.shiftKey &&
        (document.activeElement === first ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last ||
          !dialog.contains(document.activeElement))
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen]);

  return dialogRef;
}

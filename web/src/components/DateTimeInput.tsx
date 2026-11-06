import { CalendarDays } from 'lucide-react';
import type { InputHTMLAttributes } from 'react';

function openPicker(input: HTMLInputElement) {
  if (input.disabled || input.readOnly || input.matches(':disabled') || !input.showPicker) return false;
  try { input.showPicker(); return true; }
  catch { return false; /* The native full-area indicator remains the fallback. */ }
}

/** The full field is the picker target, with native keyboard/date semantics. */
export function DateTimeInput({ style, className = '', onClick, onKeyDown, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <span className="date-time-input" style={style}>
    <input title="UTC" {...props} type="datetime-local" className={`date-time-input-control ${className}`}
      onClick={event => {
        onClick?.(event);
        // Prevent the full-area native indicator from toggling it closed again.
        if (!event.defaultPrevented && openPicker(event.currentTarget)) event.preventDefault();
      }}
      onKeyDown={event => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && (event.key === ' ' || (event.altKey && event.key === 'ArrowDown'))) {
          event.preventDefault(); openPicker(event.currentTarget);
        }
      }} />
    <CalendarDays size={18} className="date-time-input-icon" aria-hidden="true" />
  </span>;
}

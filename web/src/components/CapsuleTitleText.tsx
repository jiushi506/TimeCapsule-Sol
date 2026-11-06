import React, { useId, useLayoutEffect, useRef, useState } from 'react';
import { middleEllipsis } from '../services/publicTitle';

interface CapsuleTitleTextProps {
  text: string;
  className?: string;
  showFullTitleOnHover?: boolean;
}

/** Fit a title into two lines, shortening its middle while retaining both ends. */
export const CapsuleTitleText: React.FC<CapsuleTitleTextProps> = ({ text, className, showFullTitleOnHover = false }) => {
  const titleRef = useRef<HTMLSpanElement>(null);
  const tooltipId = useId();
  const [visibleCharacters, setVisibleCharacters] = useState<number | null>(null);

  useLayoutEffect(() => {
    const element = titleRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const characters = Array.from(text);
    let disposed = false;

    const measure = () => {
      if (disposed || !element.clientWidth) return;
      const computed = window.getComputedStyle(element);
      const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.35;
      const maxHeight = lineHeight * 2 + 1;
      const probe = document.createElement('span');
      Object.assign(probe.style, {
        position: 'fixed',
        left: '-100000px',
        top: '0',
        display: 'block',
        visibility: 'hidden',
        pointerEvents: 'none',
        boxSizing: 'border-box',
        width: `${element.clientWidth}px`,
        font: computed.font,
        letterSpacing: computed.letterSpacing,
        lineHeight: computed.lineHeight,
        whiteSpace: 'normal',
        wordBreak: computed.wordBreak,
        overflowWrap: computed.overflowWrap,
      });
      document.body.append(probe);

      const fits = (candidate: string) => {
        probe.textContent = candidate;
        return probe.getBoundingClientRect().height <= maxHeight;
      };

      let budget = characters.length;
      if (!fits(text)) {
        let low = 1;
        let high = characters.length - 1;
        let best = 1;
        while (low <= high) {
          const middle = Math.floor((low + high) / 2);
          if (fits(middleEllipsis(text, middle))) {
            best = middle;
            low = middle + 1;
          } else {
            high = middle - 1;
          }
        }
        budget = best;
      }
      probe.remove();
      if (!disposed) setVisibleCharacters((current) => current === budget ? current : budget);
    };

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      disposed = true;
      observer.disconnect();
    };
  }, [text]);

  const displayText = visibleCharacters === null ? text : middleEllipsis(text, visibleCharacters);
  const titleClassName = `capsule-title-text${className ? ` ${className}` : ''}`;

  if (showFullTitleOnHover) {
    return (
      <span className="capsule-title-tooltip-wrap">
        <span ref={titleRef} className={titleClassName} tabIndex={0} aria-describedby={tooltipId}>
          {displayText}
        </span>
        <span id={tooltipId} className="capsule-title-tooltip" role="tooltip">{text}</span>
      </span>
    );
  }

  return (
    <span ref={titleRef} className={titleClassName} title={text} aria-label={text}>
      {displayText}
    </span>
  );
};

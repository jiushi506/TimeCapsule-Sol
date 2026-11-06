import React from 'react';

interface LoadingTextProps {
  children: string;
  className?: string;
}

export const LoadingText: React.FC<LoadingTextProps> = ({ children, className }) => {
  const label = children.replace(/[.!…]+\s*$/u, '').trimEnd();

  return (
    <span className={`loading-text${className ? ` ${className}` : ''}`} aria-live="polite">
      {label}
      <span className="loading-text-dots" aria-hidden="true">
        <span>.</span><span>.</span><span>.</span><span>.</span><span>.</span>
      </span>
    </span>
  );
};

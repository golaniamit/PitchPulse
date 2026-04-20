import { useState, useRef, useEffect } from 'react';

/**
 * Small "?" tooltip used to explain trading jargon.
 * Click to open (mobile-friendly); closes on outside click or Escape.
 *
 * Usage:
 *   <InfoTooltip text="The highest someone is willing to pay for YES right now." />
 */
export default function InfoTooltip({ text, label = '?', className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    function onClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    function onKey(e)   { if (e.key === 'Escape') setOpen(false); }
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className={`relative inline-flex ${className}`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-600 text-gray-500 dark:text-gray-300 text-[10px] font-bold hover:bg-gray-300 dark:hover:bg-gray-500 transition-colors"
        aria-label="Explain"
      >
        {label}
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 bg-gray-900 dark:bg-gray-700 text-white text-xs leading-snug rounded-lg px-3 py-2 shadow-lg z-50 font-normal normal-case tracking-normal"
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-gray-900 dark:border-t-gray-700" />
        </span>
      )}
    </span>
  );
}

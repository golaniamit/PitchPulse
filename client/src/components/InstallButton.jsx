import { useEffect, useState } from 'react';

// Surfaces the browser's PWA install flow as an explicit nav button.
// Chrome's beforeinstallprompt event arrives once, sometime after page load
// (when the engagement heuristics are satisfied). We capture it and trigger
// it on click. iOS Safari won't fire that event — Apple doesn't allow
// programmatic install — so we fall back to a small instructional sheet.
export default function InstallButton() {
  const [promptEvent, setPromptEvent] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showIosSheet, setShowIosSheet] = useState(false);

  useEffect(() => {
    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    function onBeforeInstallPrompt(e) {
      e.preventDefault();
      setPromptEvent(e);
    }
    function onAppInstalled() {
      setInstalled(true);
      setPromptEvent(null);
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  const isIos =
    typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !window.MSStream;

  if (installed) return null;
  if (!promptEvent && !isIos) return null;

  async function handleClick() {
    if (promptEvent) {
      promptEvent.prompt();
      try {
        await promptEvent.userChoice;
      } catch { /* user dismissed */ }
      // Per spec the prompt event can only be used once.
      setPromptEvent(null);
      return;
    }
    if (isIos) setShowIosSheet(true);
  }

  return (
    <>
      <button
        onClick={handleClick}
        className="bg-green-500 hover:bg-green-600 active:bg-green-700 text-white text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap flex-shrink-0 transition-colors"
        title="Add PitchPulse to your home screen"
      >
        📲 Get app
      </button>
      {showIosSheet && <IosInstallSheet onClose={() => setShowIosSheet(false)} />}
    </>
  );
}

function IosInstallSheet({ onClose }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <h3 className="text-base font-bold text-gray-900 dark:text-white">
            Add PitchPulse to your home screen
          </h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none -mt-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <ol className="text-sm text-gray-700 dark:text-gray-300 space-y-3">
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-bold text-xs flex items-center justify-center">1</span>
            <span>Tap the <b>Share</b> button at the bottom of Safari (the box with an up-arrow ⬆️).</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-bold text-xs flex items-center justify-center">2</span>
            <span>Scroll down and tap <b>Add to Home Screen</b>.</span>
          </li>
          <li className="flex gap-3">
            <span className="flex-shrink-0 w-6 h-6 rounded-full bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-bold text-xs flex items-center justify-center">3</span>
            <span>Tap <b>Add</b> in the top-right.</span>
          </li>
        </ol>
        <button
          onClick={onClose}
          className="mt-5 w-full bg-navy-800 hover:bg-navy-700 text-white text-sm font-semibold py-2.5 rounded-lg transition-colors"
        >
          Got it
        </button>
      </div>
    </div>
  );
}

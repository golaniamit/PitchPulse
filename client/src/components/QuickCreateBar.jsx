import { useState } from 'react';

// Sentence-to-contract input. POSTs the typed sentence to the server's
// LLM-backed parser and pre-fills the ContractBuilder via onParsed when the
// model returns a valid draft. Errors render inline so the admin can
// rephrase without leaving the page.
export default function QuickCreateBar({ onParsed }) {
  const [sentence, setSentence] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e?.preventDefault();
    if (!sentence.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/admin/parse-contract', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sentence }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setError(d.error || `Parse failed (${r.status})`);
        return;
      }
      onParsed?.(d.draft);
      setSentence('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-base">🤖</span>
        <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Quick create</h3>
        <span className="text-[11px] text-gray-400">type a sentence — local LLM parses it into a draft</span>
      </div>
      <form onSubmit={submit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={sentence}
          onChange={e => setSentence(e.target.value)}
          placeholder='e.g. "Will MI score 50+ in the powerplay?"'
          disabled={busy}
          className="flex-1 text-sm px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-900 dark:text-gray-100 focus:outline-none focus:border-navy-800 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={busy || !sentence.trim()}
          className="text-sm font-semibold bg-navy-800 text-white px-4 py-2 rounded-lg hover:bg-navy-700 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          {busy ? 'Parsing…' : 'Parse'}
        </button>
      </form>
      {error && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">⚠ {error}</p>
      )}
      <p className="mt-2 text-[11px] text-gray-400">
        The parsed contract pre-fills the form below — review it, edit if needed, then click Make Live.
      </p>
    </div>
  );
}

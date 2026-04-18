import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';

// ─── Shared config ────────────────────────────────────────────────
const CATEGORIES = {
  general:  { label: 'General',  icon: '💬', color: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',      border: 'border-l-blue-400' },
  feature:  { label: 'Feature',  icon: '💡', color: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',   border: 'border-l-amber-400' },
  contract: { label: 'Contract', icon: '📋', color: 'bg-purple-50 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300', border: 'border-l-purple-400' },
  bug:      { label: 'Bug',      icon: '🐛', color: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',           border: 'border-l-red-400' },
};

const FORM_CATEGORIES = [
  { id: 'general',  label: 'General feedback', icon: '💬', placeholder: "What's working well? What feels off? Anything at all…" },
  { id: 'feature',  label: 'Feature idea',     icon: '💡', placeholder: 'Describe the feature and why it would be useful…' },
  { id: 'contract', label: 'Contract idea',    icon: '📋', placeholder: 'Suggest a question for the next match…' },
  { id: 'bug',      label: 'Something broke',  icon: '🐛', placeholder: 'What happened? What were you trying to do?' },
];

function relativeTime(ts) {
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}

// ─── Admin inbox view ─────────────────────────────────────────────
function FeedbackInbox() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetch('/api/feedback', { credentials: 'include' })
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, []);

  async function dismiss(id) {
    await fetch(`/api/feedback/${id}`, { method: 'DELETE', credentials: 'include' });
    setItems(f => f.filter(x => x.id !== id));
  }

  const countFor = cat => items.filter(x => x.category === cat).length;
  const filtered = filter === 'all' ? items : items.filter(x => x.category === filter);

  return (
    <div className="max-w-2xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Feedback Inbox</h1>
            {items.length > 0 && (
              <span className="text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 px-2 py-0.5 rounded-full">
                {items.length}
              </span>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Everything your users have sent in.</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetch('/api/feedback', { credentials: 'include' }).then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).finally(() => setLoading(false)); }}
          className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1.5"
        >
          ↻ Refresh
        </button>
      </div>

      {/* Filter tabs */}
      {!loading && items.length > 0 && (
        <div className="flex gap-1.5 mb-4 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${filter === 'all' ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
          >
            All ({items.length})
          </button>
          {Object.entries(CATEGORIES).map(([key, cat]) => {
            const count = countFor(key);
            if (!count) return null;
            return (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${filter === key ? 'bg-gray-900 dark:bg-white text-white dark:text-gray-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
              >
                {cat.icon} {cat.label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* Content */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="text-center py-16 text-sm text-gray-400">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">📭</p>
            <p className="text-sm text-gray-400">No feedback yet. Check back after your first match.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-sm text-gray-400">No {filter} feedback.</div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map(item => {
              const cat = CATEGORIES[item.category] || CATEGORIES.general;
              return (
                <div key={item.id} className={`flex gap-4 px-5 py-4 border-l-4 ${cat.border} hover:bg-gray-50 dark:hover:bg-gray-750 transition-colors`}>
                  {/* Avatar */}
                  <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-200 dark:bg-gray-600 flex items-center justify-center text-xs font-bold text-gray-600 dark:text-gray-300 mt-0.5">
                    {(item.username || '?').slice(0, 2).toUpperCase()}
                  </div>
                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{item.username}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cat.color}`}>{cat.icon} {cat.label}</span>
                      <span className="text-xs text-gray-400 ml-auto">{relativeTime(item.created_at)}</span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{item.message}</p>
                  </div>
                  {/* Dismiss */}
                  <button onClick={() => dismiss(item.id)} title="Dismiss" className="flex-shrink-0 text-gray-300 hover:text-red-400 dark:text-gray-600 dark:hover:text-red-400 transition-colors text-xl leading-none mt-0.5">×</button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── User form view ───────────────────────────────────────────────
function FeedbackForm() {
  const [category, setCategory] = useState('general');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);

  const selected = FORM_CATEGORIES.find(c => c.id === category);

  async function submit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    setStatus('sending');
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ category, message }),
      });
      if (!res.ok) throw new Error();
      setStatus('sent');
      setMessage('');
    } catch {
      setStatus('error');
    }
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-10">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-3">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Feedback & Suggestions</h1>
          <span className="text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400 px-2 py-0.5 rounded-full tracking-wide uppercase">Beta</span>
        </div>
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
          <p className="font-semibold mb-1">🚧 This app is a work in progress.</p>
          <p>You're among the first people using PitchPulse. Things might be rough around the edges — and that's exactly why your input matters. Whether it's a bug, a missing feature, or just an idea for an interesting contract during the next match, share it here. Everything gets read.</p>
        </div>
      </div>

      {status === 'sent' ? (
        <div className="text-center py-16">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Got it, thanks!</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">Your feedback has been sent.</p>
          <button onClick={() => setStatus(null)} className="px-5 py-2 bg-navy-800 text-white rounded-xl text-sm font-semibold hover:bg-navy-700 transition-colors">
            Send another
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">What kind of feedback?</label>
            <div className="grid grid-cols-2 gap-2">
              {FORM_CATEGORIES.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategory(c.id)}
                  className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium text-left transition-all ${
                    category === c.id
                      ? 'border-navy-800 bg-navy-800 text-white dark:border-indigo-500 dark:bg-indigo-600'
                      : 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500 bg-white dark:bg-gray-800'
                  }`}
                >
                  <span className="text-lg">{c.icon}</span>
                  <span className="leading-tight">{c.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">Your message</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={selected.placeholder}
              rows={5}
              className="w-full border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-800 placeholder-gray-400 dark:placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-navy-800 dark:focus:ring-indigo-500 resize-none transition-colors"
            />
            <p className="text-xs text-gray-400 dark:text-gray-600 mt-1 text-right">{message.length} chars</p>
          </div>

          {status === 'error' && <p className="text-red-600 dark:text-red-400 text-sm">Something went wrong. Try again.</p>}

          <button
            type="submit"
            disabled={!message.trim() || status === 'sending'}
            className="w-full bg-navy-800 hover:bg-navy-700 disabled:opacity-40 text-white font-bold py-3 rounded-xl text-sm transition-colors"
          >
            {status === 'sending' ? 'Sending…' : 'Send feedback'}
          </button>
        </form>
      )}
    </div>
  );
}

// ─── Page entry point ─────────────────────────────────────────────
export default function Feedback() {
  const { user } = useAuth();
  return user?.is_admin ? <FeedbackInbox /> : <FeedbackForm />;
}

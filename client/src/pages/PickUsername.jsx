import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import PitchPulseLogo from '../components/PitchPulseLogo';

// Shown to brand-new Google signups (user.needs_username === 1). Blocks the
// rest of the app until a username is chosen. After submit, AuthContext's
// setUsername updates the user and AppShell re-routes to the home feed.
export default function PickUsername() {
  const { user, setUsername, logout } = useAuth();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await setUsername(value.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const canSubmit = value.trim().length >= 2 && value.trim().length <= 20;

  return (
    <div className="min-h-screen bg-navy-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex justify-center mb-8">
          <PitchPulseLogo size={40} showWordmark={true} dark={true} />
        </div>
        <div className="bg-white rounded-2xl p-8 shadow-xl">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Pick your username</h2>
          <p className="text-gray-500 text-sm mb-5 leading-relaxed">
            Welcome{user?.display_name ? `, ${user.display_name.split(' ')[0]}` : ''}! Choose a handle — this is what everyone will see on the leaderboard and on your trades.
          </p>

          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Username</label>
              <input
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800 transition-colors"
                value={value}
                onChange={e => setValue(e.target.value)}
                placeholder="e.g. dhoni_fan"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                maxLength={20}
              />
              <p className="text-xs text-gray-400 mt-1">
                2–20 characters. Letters, numbers, underscores and dashes only.
              </p>
            </div>

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading || !canSubmit}
              className="w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-navy-700 transition-colors disabled:opacity-50"
            >
              {loading ? '…' : 'Continue'}
            </button>
          </form>

          <button
            onClick={logout}
            className="w-full mt-4 py-2 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            Cancel and sign out
          </button>
        </div>
      </div>
    </div>
  );
}

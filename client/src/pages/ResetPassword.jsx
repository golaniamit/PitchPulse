import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import PitchPulseLogo from '../components/PitchPulseLogo';

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState(token ? 'form' : 'error'); // form | loading | success | error
  const [error, setError] = useState(token ? '' : 'This reset link is invalid or missing. Please request a new one.');

  const mismatch = confirm && confirm !== password;
  const canSubmit = password.length >= 4 && confirm === password;

  async function submit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setStatus('loading');
    try {
      const r = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const d = await r.json();
      if (d.ok) {
        setStatus('success');
      } else {
        setError(d.error || 'Something went wrong');
        setStatus('error');
      }
    } catch {
      setError('Could not connect to the server.');
      setStatus('error');
    }
  }

  const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800 transition-colors";

  return (
    <div className="min-h-screen bg-navy-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <Link to="/" className="flex justify-center mb-8">
          <PitchPulseLogo size={40} showWordmark={true} dark={true} />
        </Link>

        <div className="bg-white rounded-2xl p-8 shadow-xl">

          {(status === 'form' || status === 'loading') && (
            <>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Set new password</h2>
              <p className="text-gray-400 text-sm mb-6">Choose a new password for your account.</p>

              <form onSubmit={submit} className="space-y-4">
                <div>
                  <label className="text-xs text-gray-500 font-medium block mb-1">New password</label>
                  <input
                    type="password"
                    className={inputCls}
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium block mb-1">Confirm password</label>
                  <input
                    type="password"
                    className={`${inputCls} ${mismatch ? 'border-red-300 ring-1 ring-red-300' : ''}`}
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    placeholder="••••••"
                  />
                  {mismatch && <p className="text-xs text-red-500 mt-1">Passwords don't match</p>}
                </div>

                <button
                  type="submit"
                  disabled={!canSubmit || status === 'loading'}
                  className="w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-navy-700 transition-colors disabled:opacity-50"
                >
                  {status === 'loading' ? '…' : 'Reset password'}
                </button>
              </form>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="text-5xl mb-4 text-center">✅</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">Password updated</h2>
              <p className="text-gray-500 text-sm text-center mb-6">
                Your password has been changed. You can now log in with your new password.
              </p>
              <Link
                to="/"
                className="block w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm text-center hover:bg-navy-700 transition-colors"
              >
                Go to login →
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="text-5xl mb-4 text-center">❌</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2 text-center">Link didn't work</h2>
              <p className="text-gray-500 text-sm text-center mb-6">{error}</p>
              <Link
                to="/"
                className="block w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm text-center hover:bg-navy-700 transition-colors"
              >
                Back to login
              </Link>
            </>
          )}

        </div>
      </div>
    </div>
  );
}

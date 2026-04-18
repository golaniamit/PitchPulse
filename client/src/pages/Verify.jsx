import { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import PitchPulseLogo from '../components/PitchPulseLogo';

export default function Verify() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [status, setStatus] = useState('loading'); // loading | success | error
  const [message, setMessage] = useState('');
  const [username, setUsername] = useState('');

  useEffect(() => {
    if (!token) { setStatus('error'); setMessage('No verification token found in this link.'); return; }

    fetch(`/api/auth/verify?token=${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.ok) { setStatus('success'); setUsername(d.username); }
        else { setStatus('error'); setMessage(d.error || 'Verification failed.'); }
      })
      .catch(() => { setStatus('error'); setMessage('Could not connect to the server.'); });
  }, [token]);

  return (
    <div className="min-h-screen bg-navy-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center mb-8">
          <PitchPulseLogo size={40} showWordmark={true} dark={true} />
        </div>

        <div className="bg-white rounded-2xl p-8 shadow-xl">
          {status === 'loading' && (
            <>
              <div className="text-4xl mb-4 animate-pulse">⏳</div>
              <p className="text-gray-500 text-sm">Verifying your account…</p>
            </>
          )}

          {status === 'success' && (
            <>
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">You're verified!</h2>
              <p className="text-gray-500 text-sm mb-6">
                Welcome to PitchPulse{username ? `, ${username}` : ''}. Your account is ready — go log in and start trading.
              </p>
              <Link
                to="/"
                className="block w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-navy-700 transition-colors"
              >
                Go to login →
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <div className="text-5xl mb-4">❌</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Link didn't work</h2>
              <p className="text-gray-500 text-sm mb-6">{message}</p>
              <Link
                to="/"
                className="block w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-navy-700 transition-colors"
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

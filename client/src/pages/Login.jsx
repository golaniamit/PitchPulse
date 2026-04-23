import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import PitchPulseLogo from '../components/PitchPulseLogo';

export default function Login() {
  const { login, register, resendVerification } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login');

  // Form fields
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI state
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Post-register: show "check your email" screen
  const [pendingEmail, setPendingEmail] = useState(null);
  const [resendStatus, setResendStatus] = useState(null); // null | 'sending' | 'sent' | 'error'

  // Unverified login: show resend prompt
  const [unverifiedEmail, setUnverifiedEmail] = useState(null);

  // Forgot password
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStatus, setForgotStatus] = useState(null); // null | 'loading' | 'sent'

  function switchMode(m) {
    setMode(m);
    setError('');
    setConfirmPassword('');
    setUnverifiedEmail(null);
    setForgotMode(false);
    setForgotStatus(null);
  }

  async function submitForgot(e) {
    e.preventDefault();
    setForgotStatus('loading');
    await fetch('/api/auth/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: forgotEmail.trim() }),
    });
    setForgotStatus('sent'); // always show sent — don't reveal if email exists
  }

  async function submit(e) {
    e.preventDefault();
    setError('');

    if (mode === 'register' && password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(username, password);
        navigate('/');
      } else {
        const result = await register(username, password, displayName.trim() || undefined, email.trim());
        if (result.requiresVerification) {
          setPendingEmail(result.email);
        }
      }
    } catch (err) {
      // Unverified account trying to log in
      if (err.requiresVerification || err.message?.includes('verify your email')) {
        setUnverifiedEmail(err.email || email.trim());
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend(emailAddr) {
    setResendStatus('sending');
    try {
      await resendVerification(emailAddr);
      setResendStatus('sent');
    } catch {
      setResendStatus('error');
    }
  }

  // Special handling: login returns 403 with extra fields
  async function loginWithVerificationCheck(username, password) {
    const r = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await r.json();
    if (!r.ok) {
      if (data.requiresVerification) {
        setUnverifiedEmail(data.email);
        setLoading(false);
        return;
      }
      throw new Error(data.error);
    }
  }

  const canSubmit = username && password && (mode === 'login' || (email && confirmPassword));
  const pwMismatch = mode === 'register' && confirmPassword && confirmPassword !== password;

  const inputCls = "w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy-800 transition-colors";

  // ── Forgot password screen ─────────────────────────────────────
  if (forgotMode) {
    return (
      <div className="min-h-screen bg-navy-800 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-8">
            <PitchPulseLogo size={40} showWordmark={true} dark={true} />
          </div>
          <div className="bg-white rounded-2xl p-8 shadow-xl">
            {forgotStatus === 'sent' ? (
              <div className="text-center">
                <div className="text-5xl mb-4">📬</div>
                <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
                <p className="text-gray-500 text-sm mb-6 leading-relaxed">
                  If an account exists for <strong>{forgotEmail}</strong>, a reset link is on its way. Check your spam folder too.
                </p>
                <button
                  onClick={() => { setForgotMode(false); setForgotStatus(null); }}
                  className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Back to login
                </button>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Forgot password?</h2>
                <p className="text-gray-400 text-sm mb-6">Enter your email and we'll send a reset link.</p>
                <form onSubmit={submitForgot} className="space-y-4">
                  <div>
                    <label className="text-xs text-gray-500 font-medium block mb-1">Email address</label>
                    <input
                      type="email"
                      className={inputCls}
                      value={forgotEmail}
                      onChange={e => setForgotEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!forgotEmail || forgotStatus === 'loading'}
                    className="w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-navy-700 transition-colors disabled:opacity-50"
                  >
                    {forgotStatus === 'loading' ? '…' : 'Send reset link'}
                  </button>
                </form>
                <button
                  onClick={() => setForgotMode(false)}
                  className="w-full mt-3 py-2 text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  ← Back to login
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── "Check your email" screen ──────────────────────────────────
  if (pendingEmail) {
    return (
      <div className="min-h-screen bg-navy-800 flex items-center justify-center p-4">
        <div className="w-full max-w-sm">
          <div className="flex justify-center mb-8">
            <PitchPulseLogo size={40} showWordmark={true} dark={true} />
          </div>
          <div className="bg-white rounded-2xl p-8 shadow-xl text-center">
            <div className="text-5xl mb-4">📬</div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Check your email</h2>
            <p className="text-gray-500 text-sm leading-relaxed mb-2">
              We've sent a verification link to
            </p>
            <p className="font-semibold text-gray-800 mb-4">{pendingEmail}</p>
            <p className="text-gray-400 text-xs mb-6">
              Click the link in the email to activate your account. Check your spam folder if you don't see it.
            </p>

            <div className="border-t border-gray-100 pt-5">
              <p className="text-xs text-gray-400 mb-3">Didn't get it?</p>
              {resendStatus === 'sent' ? (
                <p className="text-green-600 text-sm font-medium">✓ Resent! Check your inbox.</p>
              ) : (
                <button
                  onClick={() => handleResend(pendingEmail)}
                  disabled={resendStatus === 'sending'}
                  className="text-sm font-semibold text-navy-800 hover:underline disabled:opacity-50"
                >
                  {resendStatus === 'sending' ? 'Sending…' : 'Resend verification email'}
                </button>
              )}
              {resendStatus === 'error' && (
                <p className="text-red-500 text-xs mt-2">Failed to resend. Try again in a moment.</p>
              )}
            </div>

            <div className="border-t border-gray-100 mt-5 pt-5">
              <button
                onClick={() => { setPendingEmail(null); switchMode('login'); }}
                className="w-full py-2.5 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
              >
                Back to login
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Main login / register form ─────────────────────────────────
  return (
    <div className="min-h-screen bg-navy-800 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Logo + Wordmark */}
        <div className="flex flex-col items-center mb-3 sm:mb-5 gap-1.5 sm:gap-2">
          <div className="rounded-2xl p-2" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <PitchPulseLogo size={48} showWordmark={false} dark={true} />
          </div>
          <p style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: '1.875rem', letterSpacing: '-1.2px', lineHeight: 1 }}>
            <span style={{ fontWeight: 300, color: 'rgba(255,255,255,0.9)' }}>pitch</span>
            <span style={{ fontWeight: 800, color: '#00c896' }}>Pulse</span>
          </p>
          <p className="text-white/40 text-[10px] tracking-widest uppercase">Predict · Trade · Win</p>
        </div>

        {/* App description — one tight line on mobile, two on sm+ */}
        <div className="text-center mb-3 sm:mb-4 px-1">
          <p className="text-white/90 text-sm sm:text-base font-semibold leading-snug">
            Live prediction markets for IPL matches.
          </p>
          <p className="hidden sm:block text-white/60 text-sm leading-relaxed mt-2">
            Read the game. Back your instincts. Beat everyone else.
          </p>
        </div>

        {/* Play money — compact single-row banner on mobile */}
        <div className="mb-3 sm:mb-4 rounded-xl sm:rounded-2xl overflow-hidden" style={{ background: 'rgba(0,200,150,0.12)', border: '1.5px solid rgba(0,200,150,0.35)' }}>
          <div className="flex items-center justify-center gap-2 py-1.5 sm:py-2.5 px-3" style={{ background: 'rgba(0,200,150,0.18)' }}>
            <span className="text-base sm:text-xl">🪙</span>
            <span className="text-[#00c896] font-black text-xs sm:text-sm tracking-wide uppercase">Play coins only</span>
            <span className="text-base sm:text-xl">🪙</span>
          </div>
          <div className="text-center py-1.5 sm:py-2.5 px-3">
            <p className="text-white/80 text-xs sm:text-sm font-semibold">Zero real money · 10,000 free coins to start</p>
            <p className="hidden sm:block text-white/45 text-xs mt-0.5">Zero financial risk. Zero real money.</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl p-4 sm:p-6 shadow-xl">


          {/* Login / Register toggle */}
          <div className="flex rounded-xl overflow-hidden border border-gray-200 mb-4 sm:mb-6">
            <button
              className={`flex-1 py-2 text-sm font-semibold transition-colors ${mode === 'login' ? 'bg-navy-800 text-white' : 'text-gray-500'}`}
              onClick={() => switchMode('login')}
            >Login</button>
            <button
              className={`flex-1 py-2 text-sm font-semibold transition-colors ${mode === 'register' ? 'bg-navy-800 text-white' : 'text-gray-500'}`}
              onClick={() => switchMode('register')}
            >Register</button>
          </div>

          {/* Continue with Google — works for both login and register.
              It's a full-page navigation (not a fetch) because the OAuth flow
              requires the browser itself to follow redirects through Google. */}
          <a
            href="/api/auth/google"
            className="w-full flex items-center justify-center gap-2.5 border border-gray-200 rounded-xl py-2.5 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors mb-4"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
              <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"/>
              <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
              <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
              <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
            </svg>
            Continue with Google
          </a>

          {/* Divider */}
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200"></div>
            </div>
            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs text-gray-400 uppercase tracking-wider">or</span>
            </div>
          </div>

          {/* Unverified account warning */}
          {unverifiedEmail && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm">
              <p className="font-semibold text-amber-800 mb-1">Email not verified yet</p>
              <p className="text-amber-700 text-xs mb-3">
                Check your inbox at <strong>{unverifiedEmail}</strong> for the verification link.
              </p>
              {resendStatus === 'sent' ? (
                <p className="text-green-600 text-xs font-medium">✓ Resent successfully.</p>
              ) : (
                <button
                  onClick={() => handleResend(unverifiedEmail)}
                  disabled={resendStatus === 'sending'}
                  className="text-xs font-bold text-amber-800 underline disabled:opacity-50"
                >
                  {resendStatus === 'sending' ? 'Sending…' : 'Resend verification email'}
                </button>
              )}
            </div>
          )}

          <form onSubmit={submit} className="space-y-3">

            {/* Username */}
            <div>
              <label className="text-xs text-gray-500 font-medium block mb-1">Username</label>
              <input
                className={inputCls}
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="e.g. dhoni_fan"
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
              />
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs text-gray-500 font-medium">Password</label>
                {mode === 'login' && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => setForgotMode(true)}
                    className="text-xs text-navy-800 font-medium hover:underline"
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                type="password"
                className={inputCls}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••"
              />
            </div>

            {/* Confirm password — register only */}
            {mode === 'register' && (
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Confirm password</label>
                <input
                  type="password"
                  className={`${inputCls} ${pwMismatch ? 'border-red-300 ring-1 ring-red-300' : ''}`}
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  placeholder="••••••"
                />
                {pwMismatch && (
                  <p className="text-xs text-red-500 mt-1">Passwords don't match</p>
                )}
              </div>
            )}

            {/* Email — register only */}
            {mode === 'register' && (
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">Email address</label>
                <input
                  type="email"
                  className={inputCls}
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                />
                <p className="text-xs text-gray-400 mt-1">We'll send a verification link here</p>
              </div>
            )}

            {/* Display name — register only */}
            {mode === 'register' && (
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-1">
                  Display name <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  className={inputCls}
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="e.g. Rahul · shown on leaderboard"
                />
              </div>
            )}

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <button
              type="submit"
              disabled={loading || !canSubmit || pwMismatch}
              className="w-full bg-navy-800 text-white py-3 rounded-xl font-bold text-sm hover:bg-navy-700 transition-colors disabled:opacity-50 mt-1"
            >
              {loading ? '…' : mode === 'login' ? 'Login' : 'Create Account'}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}

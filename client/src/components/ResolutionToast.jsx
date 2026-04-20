import { useEffect, useState, useRef } from 'react';
import { useSocket } from '../context/SocketContext';
import { useAuth } from '../context/AuthContext';

/**
 * Shows a one-time toast when a contract the user held a position on resolves.
 * Win → green "You won 🪙 X" with confetti
 * Loss → grey "You lost 🪙 X" no confetti
 *
 * Mounted once in AppShell so it works on any page.
 */
export default function ResolutionToast() {
  const { on } = useSocket();
  const { user, updateBalance } = useAuth();
  const [toast, setToast] = useState(null);
  const [confetti, setConfetti] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    if (!user) return;
    const unsub = on('contract_resolved', async (msg) => {
      // Find user's position on this contract via portfolio endpoint.
      try {
        const r = await fetch('/api/users/portfolio', { credentials: 'include' });
        const d = await r.json();
        const pos = (d.positions || []).find(p => p.contract_id === msg.contractId);
        if (!pos) return; // user didn't hold this contract
        const won = pos.side === msg.resolution;
        const payout = won ? pos.quantity * 100 : 0;
        const staked = Math.round(pos.avg_price * pos.quantity);
        const pnl = payout - staked;
        setToast({
          title: pos.title || 'Your bet',
          side: pos.side,
          resolution: msg.resolution,
          won,
          pnl,
          payout,
        });
        if (won) setConfetti(true);
        clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          setToast(null);
          setConfetti(false);
        }, 6000);
      } catch { /* ignore */ }
    });
    return () => unsub?.();
  }, [on, user, updateBalance]);

  if (!toast) return null;

  return (
    <>
      {confetti && <Confetti />}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] w-[90vw] max-w-sm pointer-events-auto">
        <div
          className={`rounded-2xl shadow-2xl border p-4 flex items-center gap-3 animate-slide-in-up ${
            toast.won
              ? 'bg-green-50 border-green-200 dark:bg-green-900/80 dark:border-green-700'
              : 'bg-gray-100 border-gray-200 dark:bg-gray-800 dark:border-gray-700'
          }`}
        >
          <div className="text-3xl">{toast.won ? '🎉' : '😕'}</div>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-bold ${toast.won ? 'text-green-700 dark:text-green-300' : 'text-gray-700 dark:text-gray-200'}`}>
              {toast.won ? `You won 🪙 ${toast.pnl > 0 ? '+' : ''}${toast.pnl}` : `You lost 🪙 ${toast.pnl}`}
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400 truncate mt-0.5">
              "{toast.title}" settled {toast.resolution}
            </p>
          </div>
          <button
            onClick={() => { setToast(null); setConfetti(false); }}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-lg leading-none flex-shrink-0"
            aria-label="Dismiss"
          >✕</button>
        </div>
      </div>
    </>
  );
}

// --- Confetti burst ------------------------------------------------
// Pure-CSS/JS, no extra dependencies. ~40 particles with randomised
// trajectory and rotation; cleaned up automatically after 2.5s.
function Confetti() {
  const PIECES = 40;
  const COLORS = ['#16a34a', '#eab308', '#3b82f6', '#ec4899', '#f97316', '#14b8a6'];
  const pieces = Array.from({ length: PIECES }, (_, i) => {
    const left = Math.random() * 100;                 // vw
    const delay = Math.random() * 0.4;                // s
    const drift = (Math.random() - 0.5) * 200;        // px horizontal drift
    const rotate = Math.random() * 720 - 360;         // deg
    const color = COLORS[i % COLORS.length];
    const size = 6 + Math.random() * 6;               // px
    return { left, delay, drift, rotate, color, size, i };
  });

  return (
    <>
      <style>{`
        @keyframes confetti-fall {
          0%   { transform: translate(0, -20vh) rotate(0deg); opacity: 1; }
          100% { transform: translate(var(--drift), 100vh) rotate(var(--rotate)); opacity: 0; }
        }
      `}</style>
      <div className="fixed inset-0 pointer-events-none z-[9998] overflow-hidden">
        {pieces.map(p => (
          <span
            key={p.i}
            style={{
              position: 'absolute',
              top: 0,
              left: `${p.left}vw`,
              width: p.size,
              height: p.size,
              background: p.color,
              borderRadius: 2,
              animation: `confetti-fall 2.4s ease-out ${p.delay}s forwards`,
              '--drift': `${p.drift}px`,
              '--rotate': `${p.rotate}deg`,
            }}
          />
        ))}
      </div>
    </>
  );
}

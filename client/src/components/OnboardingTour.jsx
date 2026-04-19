import { useState, useEffect, useCallback } from 'react';

const storageKey = (username) => `pitchpulse_tour_done_${username}`;

// type: 'intro' | 'outro' | 'spotlight'
const STEPS = [
  {
    type: 'intro',
    title: 'Welcome to PitchPulse',
    body: "If you're unfamiliar with player-vs-player prediction games, here's a quick tour to get you started.",
  },
  {
    type: 'spotlight',
    target: '[data-tour="balance"]',
    title: '🪙 Your budget',
    body: 'Everyone starts with 1,000 coins. Play, win and top the leaderboard.',
    callout: '🚫 No real money, ever.',
  },
  {
    type: 'spotlight',
    target: '[data-tour="contract-card"]',
    title: '📋 The questions',
    body: 'Each card is a YES/NO question about what might happen in the match. New cards appear as the match progresses.',
  },
  {
    type: 'spotlight',
    target: '[data-tour="bet-buttons"]',
    title: '🎯 Placing your bet',
    body: "Tap YES if you think it'll happen, NO if you don't. Your bet only goes live when another player takes the other side at that price — always player vs player, never the house.",
  },
  {
    type: 'spotlight',
    target: '[data-tour="price-bar"]',
    title: '📊 Market sentiment',
    body: "The bar reflects current market sentiment based on other players' bets and fluctuates with every bet placed. It directly impacts the price available to you.",
  },
  {
    type: 'spotlight',
    target: '[data-tour="nav-portfolio"]',
    title: '📁 Your Portfolio',
    body: 'All your active bets live here. Check in any time to track how your predictions are playing out.',
  },
  {
    type: 'outro',
    title: "You're all set! 🏏",
    body: "Now sit back, watch the cricket and outpredict your friends. Back the right calls, stack your coins and climb to the top. May the sharpest mind win. 🏆",
  },
];

const PAD = 10;
const TT_WIDTH = 300;
const TT_H_EST = 185; // approximate tooltip height for positioning

function tooltipPos(rect) {
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const spaceBelow = vh - rect.bottom - PAD - 14;
  const placeAbove = spaceBelow < TT_H_EST && rect.top > TT_H_EST + 20;
  const top = placeAbove
    ? rect.top - PAD - 14 - TT_H_EST
    : rect.bottom + PAD + 14;
  const idealLeft = rect.left + rect.width / 2 - TT_WIDTH / 2;
  const left = Math.max(12, Math.min(idealLeft, vw - TT_WIDTH - 12));
  return { top, left };
}

/* ─── Progress dots ────────────────────────────────────────────────── */
function Dots({ current, total }) {
  return (
    <div className="flex items-center gap-1">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className="rounded-full transition-all duration-200"
          style={{
            width:      i === current ? 16 : 6,
            height:     6,
            background: i === current ? '#1a1a2e' : '#e5e7eb',
          }}
        />
      ))}
    </div>
  );
}

/* ─── useTour hook ─────────────────────────────────────────────────── */
export function useTour(username) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!username) return;
    if (!localStorage.getItem(storageKey(username))) {
      const t = setTimeout(() => setShow(true), 700);
      return () => clearTimeout(t);
    }
  }, [username]);

  return {
    show,
    openTour: () => {
      if (username) localStorage.removeItem(storageKey(username));
      setShow(true);
    },
    closeTour: () => setShow(false),
  };
}

/* ─── Tour component ───────────────────────────────────────────────── */
export default function OnboardingTour({ onClose, username }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState(null);
  const [visible, setVisible] = useState(false); // controls fade in/out

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const isSpotlight = current.type === 'spotlight';

  /* Measure the target element and fade in */
  const measureAndReveal = useCallback(() => {
    if (!isSpotlight) return;
    const el = document.querySelector(current.target);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => {
      setRect(el.getBoundingClientRect());
      requestAnimationFrame(() => setVisible(true));
    }, 350);
  }, [current.target, isSpotlight]);

  /* On step change: fade out → wait → measure new target → fade in */
  useEffect(() => {
    setVisible(false);
    setRect(null);
    const t = setTimeout(() => measureAndReveal(), 200);
    return () => clearTimeout(t);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isSpotlight) return;
    const onResize = () => {
      const el = document.querySelector(current.target);
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [current.target, isSpotlight]);

  function finish() {
    if (username) localStorage.setItem(storageKey(username), '1');
    onClose();
  }

  function next() {
    if (isLast) finish();
    else setStep(s => s + 1);
  }

  /* ── Intro / Outro — full overlay centered modal ─────────────────── */
  if (current.type === 'intro' || current.type === 'outro') {
    const isIntro = current.type === 'intro';
    return (
      <>
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.80)', zIndex: 9998 }} />
        <div
          style={{
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: Math.min(360, window.innerWidth - 32),
            zIndex: 10000,
          }}
          className="bg-white rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Hero area */}
          <div className="px-6 pt-8 pb-5 text-center">
            <div className="text-5xl mb-4">{isIntro ? '🏏' : '🎉'}</div>
            <h2 className="text-xl font-bold text-gray-900 mb-3 leading-snug">{current.title}</h2>
            <p className="text-gray-500 text-sm leading-relaxed">{current.body}</p>
          </div>

          {/* Footer */}
          <div className="px-6 pb-6 pt-1 flex items-center justify-between">
            <button onClick={finish} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
              Skip tour
            </button>
            <div className="flex items-center gap-3">
              <Dots current={step} total={STEPS.length} />
              <button
                onClick={next}
                className="px-5 py-2 text-sm font-bold text-white rounded-xl hover:opacity-90 transition-opacity"
                style={{ background: '#1a1a2e' }}
              >
                {isIntro ? 'Start tour →' : "Let's go! 🚀"}
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  /* ── Spotlight slide — wait for rect ─────────────────────────────── */
  if (!rect) return null;

  const hl = {
    top:    rect.top    - PAD,
    left:   rect.left   - PAD,
    width:  rect.width  + PAD * 2,
    height: rect.height + PAD * 2,
  };
  const { top: ttTop, left: ttLeft } = tooltipPos(rect);

  return (
    <>
      {/* Spotlight ring */}
      <div
        style={{
          position: 'fixed',
          top: hl.top,
          left: hl.left,
          width: hl.width,
          height: hl.height,
          borderRadius: 18,
          boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
          outline: '2.5px solid rgba(255,255,255,0.4)',
          pointerEvents: 'none',
          zIndex: 9999,
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.22s ease',
        }}
      />

      {/* Tooltip card */}
      <div
        style={{
          position: 'fixed',
          top: ttTop,
          left: ttLeft,
          width: TT_WIDTH,
          zIndex: 10000,
          opacity: visible ? 1 : 0,
          transform: visible ? 'translateY(0)' : 'translateY(10px)',
          transition: 'opacity 0.22s ease, transform 0.22s ease',
        }}
        className="bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="px-4 py-3 flex items-center justify-between" style={{ background: '#1a1a2e' }}>
          <span className="text-white font-bold text-sm">{current.title}</span>
          <button
            onClick={finish}
            className="text-white/40 hover:text-white/80 text-base leading-none transition-colors"
          >✕</button>
        </div>

        {/* Progress fill */}
        <div className="h-0.5 bg-gray-100">
          <div
            className="h-0.5 transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%`, background: '#00c896' }}
          />
        </div>

        {/* Body */}
        <div className="px-4 pt-3 pb-2 space-y-2">
          <p className="text-gray-600 text-sm leading-relaxed">{current.body}</p>
          {current.callout && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
              <span className="text-sm font-bold text-red-600">{current.callout}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex items-center justify-between">
          <button onClick={finish} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
            Skip tour
          </button>
          <div className="flex items-center gap-3">
            <Dots current={step} total={STEPS.length} />
            <button
              onClick={next}
              className="px-4 py-1.5 text-xs font-bold text-white rounded-xl hover:opacity-90 transition-opacity"
              style={{ background: '#1a1a2e' }}
            >
              {isLast ? "Let's go 🚀" : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

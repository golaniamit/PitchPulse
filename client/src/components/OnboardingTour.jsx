import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Joyride, STATUS, ACTIONS, EVENTS } from 'react-joyride';

const storageKey = (username) => `pitchpulse_tour_done_${username}`;

const steps = [
  {
    target: '[data-tour="balance"]',
    title: '🪙 Your play coins',
    content: 'This is your balance — everyone starts with 1000 free coins. There is zero real money involved, ever. Win or lose, it\'s all just play.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="contract-card"]',
    title: '📋 What is a contract?',
    content: 'Each card is a live YES/NO question about something that could happen in the match. The market is live — prices shift as people trade.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="price-bar"]',
    title: '📊 Reading the price',
    content: 'This bar shows crowd confidence. If it reads 70% YES, it means most people think YES will happen. The bar moves in real time as trades come in.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="stake-selector"]',
    title: '💰 Pick your stake',
    content: 'Choose how many coins you want to risk on this trade. Higher stake = bigger potential win, but more on the line.',
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tour="bet-buttons"]',
    title: '🎯 Place your trade',
    content: 'Every trade is against another player on the platform — not the house.',
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tour="bet-yes"]',
    title: '🎯 Place your trade',
    content: 'Tap YES if you believe the outcome will happen.',
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tour="bet-no"]',
    title: '🎯 Place your trade',
    content: 'Tap NO if you think it won\'t happen.',
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tour="bet-buttons"]',
    title: '🎯 Place your trade',
    content: 'The payout is always shown upfront before you confirm. The price is based on the current best price other players are ready to offer for it.',
    placement: 'top',
    disableBeacon: true,
  },
  {
    target: '[data-tour="nav-portfolio"]',
    title: '📁 Your Portfolio',
    content: 'All your open positions live here. You can sell any position at the current market price to cash out early.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="portfolio-summary"]',
    title: '📁 Your Portfolio',
    content: 'This shows your wallet balance, how much you\'d win if all your bets come through, and how many open bets you have running.',
    placement: 'bottom',
    disableBeacon: true,
  },
  {
    target: '[data-tour="nav-leaderboard"]',
    title: '🏆 Leaderboard',
    content: 'Rankings update live. Your position is based on your total coin balance — the more you win, the higher you climb.',
    placement: 'bottom',
    disableBeacon: true,
  },
];

// Index of the nav-portfolio step — after it, navigate to /portfolio
const PORTFOLIO_NAV_INDEX = steps.findIndex(s => s.target === '[data-tour="nav-portfolio"]');

function TooltipContent({ step, index, size, isLastStep, backProps, closeProps, primaryProps, tooltipProps }) {
  return (
    <div {...tooltipProps} className="bg-white rounded-2xl shadow-2xl w-72 overflow-hidden" style={{ zIndex: 9999 }}>
      {/* Header */}
      <div style={{ background: '#1a1a2e' }} className="px-4 py-3 flex items-center justify-between">
        <span className="text-white font-bold text-sm">{step.title}</span>
        <button {...closeProps} className="text-white/40 hover:text-white/80 text-base leading-none transition-colors">✕</button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-gray-100">
        <div
          className="h-0.5 transition-all duration-300"
          style={{ width: `${((index + 1) / size) * 100}%`, background: '#00c896' }}
        />
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        <p className="text-gray-600 text-sm leading-relaxed">{step.content}</p>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-xs text-gray-400">{index + 1} of {size}</span>
        <div className="flex gap-2">
          {index > 0 && (
            <button
              {...backProps}
              className="px-3 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors"
            >
              Back
            </button>
          )}
          <button
            {...primaryProps}
            className="px-4 py-1.5 text-xs font-bold text-white rounded-xl transition-colors"
            style={{ background: '#1a1a2e' }}
          >
            {isLastStep ? "Let's go 🚀" : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function OnboardingTour({ onClose, username }) {
  const navigate = useNavigate();
  const [run, setRun] = useState(true);

  // Use a ref for navigate/onClose/username so the stable callback can always read latest values
  const navRef = useRef({ navigate, onClose, username });
  useEffect(() => { navRef.current = { navigate, onClose, username }; });

  const handleCallback = useCallback(({ action, index, status, type }) => {
    const { navigate, onClose, username } = navRef.current;
    window.__tourEvents = window.__tourEvents || [];
    window.__tourEvents.push({ type, action, index, status, url: window.location.pathname });

    if ([STATUS.FINISHED, STATUS.SKIPPED].includes(status)) {
      localStorage.setItem(storageKey(username), '1');
      navigate('/');
      onClose();
      return;
    }

    if (type === EVENTS.STEP_AFTER && action === ACTIONS.NEXT) {
      if (index === PORTFOLIO_NAV_INDEX) {
        // Pause Joyride, navigate to /portfolio, then resume once the DOM has updated
        setRun(false);
        navigate('/portfolio');
        setTimeout(() => setRun(true), 400);
      }
    }

    if (type === EVENTS.STEP_AFTER && action === ACTIONS.PREV) {
      // When going back past portfolio-summary, return to home
      if (index === PORTFOLIO_NAV_INDEX + 1) {
        setRun(false);
        navigate('/');
        setTimeout(() => setRun(true), 400);
      }
    }

    if (type === EVENTS.STEP_AFTER && (action === ACTIONS.CLOSE || action === ACTIONS.SKIP)) {
      localStorage.setItem(storageKey(username), '1');
      navigate('/');
      onClose();
    }
  }, []); // stable — reads from ref

  return (
    <Joyride
      steps={steps}
      run={run}
      continuous
      showSkipButton
      disableScrolling={false}
      spotlightClicks={false}
      callback={handleCallback}
      styles={{
        options: {
          zIndex: 9998,
          arrowColor: '#ffffff',
          overlayColor: 'rgba(0, 0, 0, 0.55)',
        },
      }}
      locale={{
        skip: 'Skip tour',
        last: "Let's go 🚀",
      }}
      floaterProps={{
        disableAnimation: true,
      }}
    />
  );
}

export function useTour(username) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!username) return;
    if (!localStorage.getItem(storageKey(username))) {
      const t = setTimeout(() => setShow(true), 800);
      return () => clearTimeout(t);
    }
  }, [username]);

  return {
    show,
    openTour: () => setShow(true),
    closeTour: () => setShow(false),
  };
}

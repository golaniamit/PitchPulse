/**
 * PitchPulse logo — Concept A (bold P + ECG pulse exiting the stem area).
 *
 * Props:
 *   size          — icon square size in px (default 36)
 *   showWordmark  — show "pitchPulse" text beside icon (default true)
 *   iconBg        — add a subtle rounded-rect behind the icon (default false)
 *   dark          — force white wordmark text (default true)
 */
export default function PitchPulseLogo({ size = 36, showWordmark = true, iconBg = false, dark = true }) {
  const wordColor = dark ? 'white' : '#1a1a2e';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: Math.round(size * 0.33) }}>
      <svg width={size} height={size} viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
        {iconBg && <rect width="96" height="96" rx="24" fill="rgba(255,255,255,0.1)"/>}
        {/* Stem */}
        <rect x="18" y="18" width="11" height="60" rx="2" fill="white"/>
        {/* Bowl */}
        <path d="M 29 18 L 52 18 Q 70 18 70 36 Q 70 54 52 54 L 29 54"
              fill="none" stroke="white" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round"/>
        {/* Green ECG pulse line */}
        <polyline points="44,72 50,72 55,56 61,82 66,64 71,72 78,72"
          fill="none" stroke="#00c896" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>

      {showWordmark && (
        <span style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontSize: Math.round(size * 0.75),
          letterSpacing: '-0.5px',
          lineHeight: 1,
          userSelect: 'none',
        }}>
          <span style={{ fontWeight: 400, color: wordColor }}>pitch</span>
          <span style={{ fontWeight: 700, color: '#00c896' }}>Pulse</span>
        </span>
      )}
    </div>
  );
}

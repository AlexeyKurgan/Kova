import "./KovaAvatar.css";

export type KovaAvatarState =
  | "idle"
  | "thinking"
  | "coding"
  | "reading"
  | "searching"
  | "running"
  | "editing"
  | "success"
  | "error"
  | "sleeping";

type Props = {
  state?: KovaAvatarState;
  size?: number;
  active?: boolean;
  className?: string;
  title?: string;
};

export default function KovaAvatar({
  state = "idle",
  size = 144,
  active = true,
  className = "",
  title = "Kova",
}: Props) {
  return (
    <svg
      className={`kova-avatar ${className}`.trim()}
      data-state={state}
      data-active={active ? "true" : "false"}
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      shapeRendering="geometricPrecision"
    >
      <g className="kova-whole">
        <g className="kova-tail">
          <path d="M 94 128 C 115 128, 125 117, 122 103 C 120 94, 113 91, 108 94" stroke="var(--kova-outline)" strokeWidth="15.5" strokeLinecap="round" />
          <path d="M 94 128 C 115 128, 125 117, 122 103 C 120 94, 113 91, 108 94" stroke="var(--kova-fur)" strokeWidth="9.5" strokeLinecap="round" />
          <path d="M 121 101 C 119 94, 113 91, 108 94" stroke="var(--kova-gold)" strokeWidth="9.5" strokeLinecap="round" />
        </g>
        <path d="M 44 134 C 41 118, 46 101, 56 96 L 88 96 C 98 101, 103 118, 100 134 C 98 140, 46 140, 44 134 Z" fill="var(--kova-fur)" stroke="var(--kova-outline)" strokeWidth="3.2" strokeLinejoin="round" />
        <path d="M 46.5 133 C 44 118, 48.5 103, 57 98.5 L 62 98.5 C 54.5 104, 51.5 119, 53.5 134 Z" fill="var(--kova-fur-shadow)" />
        <path d="M 59 136.5 C 57 122, 60 107, 72 105 C 84 107, 87 122, 85 136.5 Z" fill="var(--kova-cream)" />
        <path d="M 52 97 Q 72 106 92 97 L 94 103 Q 72 112 50 103 Z" fill="var(--kova-gold)" stroke="var(--kova-outline)" strokeWidth="2.6" strokeLinejoin="round" />
        <g className="kova-pendant">
          <polygon points="72,104 79,112 72,120 65,112" fill="var(--kova-gold)" stroke="var(--kova-outline)" strokeWidth="2.6" strokeLinejoin="round" />
          <circle cx="72" cy="112" r="2" fill="var(--kova-white)" />
        </g>
        <ellipse className="kova-paw-l" cx="59" cy="134" rx="10" ry="6.5" fill="var(--kova-fur)" stroke="var(--kova-outline)" strokeWidth="3" />
        <ellipse className="kova-paw-r" cx="85" cy="134" rx="10" ry="6.5" fill="var(--kova-fur)" stroke="var(--kova-outline)" strokeWidth="3" />
        <g className="kova-head">
          <g className="kova-ear-l">
            <path d="M 44 58 L 38 24 C 37.5 21, 40.5 19.5, 43 21 L 64 42 Z" fill="var(--kova-fur)" stroke="var(--kova-outline)" strokeWidth="3.2" strokeLinejoin="round" />
            <path d="M 46 51 L 43 30 L 58 43 Z" fill="var(--kova-ear-inner)" />
          </g>
          <g className="kova-ear-r">
            <path d="M 100 58 L 106 24 C 106.5 21, 103.5 19.5, 101 21 L 80 42 Z" fill="var(--kova-fur)" stroke="var(--kova-outline)" strokeWidth="3.2" strokeLinejoin="round" />
            <path d="M 98 51 L 101 30 L 86 43 Z" fill="var(--kova-ear-inner)" />
          </g>
          <ellipse cx="72" cy="70" rx="31" ry="27" fill="var(--kova-fur)" stroke="var(--kova-outline)" strokeWidth="3.2" />
          <path d="M 45 77 C 50 92, 94 92, 99 77 C 91 87, 53 87, 45 77 Z" fill="var(--kova-fur-shadow)" />
          <path d="M 66 47 L 66 53 M 72 45.5 L 72 54 M 78 47 L 78 53" stroke="var(--kova-fur-shadow)" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M 45 73 L 26 70 M 45 79 L 27 83 M 99 73 L 118 70 M 99 79 L 117 83" stroke="var(--kova-fur)" strokeWidth="2.6" strokeLinecap="round" />
          <ellipse cx="72" cy="82" rx="13.5" ry="8.5" fill="var(--kova-cream)" />
          <path d="M 68.5 78.5 Q 72 77.2 75.5 78.5 L 72 82.2 Z" fill="var(--kova-gold)" />
          <path d="M 65.5 84 Q 68.7 87.5 72 83.8 Q 75.3 87.5 78.5 84" stroke="var(--kova-outline)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          <g className="kova-eyes-open">
            <circle cx="58" cy="69" r="6.8" fill="var(--kova-gold)" stroke="var(--kova-outline)" strokeWidth="2.2" />
            <circle cx="86" cy="69" r="6.8" fill="var(--kova-gold)" stroke="var(--kova-outline)" strokeWidth="2.2" />
            <g className="kova-pupils">
              <circle cx="58" cy="69" r="3.4" fill="var(--kova-outline)" />
              <circle cx="59.4" cy="67.5" r="1.3" fill="var(--kova-white)" />
              <circle cx="86" cy="69" r="3.4" fill="var(--kova-outline)" />
              <circle cx="87.4" cy="67.5" r="1.3" fill="var(--kova-white)" />
            </g>
          </g>
          <g className="kova-eyes-happy"><path d="M 52 70 Q 58 62 64 70 M 80 70 Q 86 62 92 70" stroke="var(--kova-gold)" strokeWidth="3.2" strokeLinecap="round" /></g>
          <g className="kova-eyes-sleep"><path d="M 52 69 Q 58 75 64 69 M 80 69 Q 86 75 92 69" stroke="var(--kova-gold)" strokeWidth="3" strokeLinecap="round" /></g>
          <g className="kova-eyes-error"><path d="M 54 65 L 62 73 M 62 65 L 54 73 M 82 65 L 90 73 M 90 65 L 82 73" stroke="var(--kova-error)" strokeWidth="3" strokeLinecap="round" /></g>
          <g className="kova-prop kova-prop-coding">
            <rect x="48" y="62" width="20" height="14" rx="4" fill="var(--kova-white)" fillOpacity="0.14" stroke="var(--kova-outline)" strokeWidth="2.4" />
            <rect x="76" y="62" width="20" height="14" rx="4" fill="var(--kova-white)" fillOpacity="0.14" stroke="var(--kova-outline)" strokeWidth="2.4" />
            <path d="M 68 68 L 76 68" stroke="var(--kova-outline)" strokeWidth="2.4" />
          </g>
        </g>
      </g>
      <g className="kova-prop kova-prop-thinking">
        <circle className="kova-dot-1" cx="111" cy="48" r="3.2" fill="var(--kova-cream)" stroke="var(--kova-outline)" strokeWidth="2" />
        <circle className="kova-dot-2" cx="120" cy="39" r="4.2" fill="var(--kova-gold)" stroke="var(--kova-outline)" strokeWidth="2" />
        <circle className="kova-dot-3" cx="132" cy="31" r="5.2" fill="var(--kova-cream)" stroke="var(--kova-outline)" strokeWidth="2" />
      </g>
      <g className="kova-prop kova-prop-coding">
        <g className="kova-code-badge">
          <rect x="108" y="34" width="28" height="19" rx="5" fill="var(--kova-fur)" stroke="var(--kova-outline)" strokeWidth="2.4" />
          <path d="M 116 40.5 L 113 43.5 L 116 46.5 M 128 40.5 L 131 43.5 L 128 46.5 M 123.5 39.5 L 120.5 47.5" stroke="var(--kova-gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      <g className="kova-prop kova-prop-reading">
        <g className="kova-book">
          <rect x="112" y="53" width="24" height="28" rx="4" fill="var(--kova-white)" stroke="var(--kova-outline)" strokeWidth="2.6" />
          <path d="M 117 61 L 131 61 M 117 67 L 129 67 M 117 73 L 126 73" stroke="var(--kova-fur)" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M 117 61 L 123 61" stroke="var(--kova-gold)" strokeWidth="2.2" strokeLinecap="round" />
        </g>
      </g>
      <g className="kova-prop kova-prop-searching">
        <g className="kova-loupe">
          <line x1="120" y1="70" x2="131" y2="81" stroke="var(--kova-outline)" strokeWidth="3.4" strokeLinecap="round" />
          <circle cx="112" cy="62" r="11" fill="var(--kova-white)" stroke="var(--kova-outline)" strokeWidth="3" />
          <circle cx="112" cy="62" r="8" fill="var(--kova-cream)" fillOpacity="0.45" />
          <path d="M 107.5 58.5 Q 111.5 55.5 115.5 58.5" stroke="var(--kova-gold)" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </g>
      <g className="kova-prop kova-prop-running">
        <rect x="108" y="36" width="28" height="20" rx="5" fill="var(--kova-outline)" stroke="var(--kova-fur)" strokeWidth="2" />
        <path d="M 114 43 L 118.5 46 L 114 49" stroke="var(--kova-gold)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <line className="kova-term-cursor" x1="122" y1="49" x2="129" y2="49" stroke="var(--kova-cream)" strokeWidth="2.2" strokeLinecap="round" />
      </g>
      <g className="kova-prop kova-prop-editing">
        <g className="kova-pencil">
          <path d="M 112 76 L 116 64 L 130 50 L 136 56 L 122 70 Z" fill="var(--kova-gold)" stroke="var(--kova-outline)" strokeWidth="2.6" strokeLinejoin="round" />
          <path d="M 112 76 L 116 64 L 122 70 Z" fill="var(--kova-cream)" stroke="var(--kova-outline)" strokeWidth="2.4" strokeLinejoin="round" />
          <circle cx="112.8" cy="75.2" r="1.6" fill="var(--kova-outline)" />
        </g>
      </g>
      <g className="kova-prop kova-prop-success">
        <g className="kova-badge-pop">
          <circle cx="120" cy="44" r="11" fill="var(--kova-success)" stroke="var(--kova-outline)" strokeWidth="2.6" />
          <path d="M 115 44.5 L 118.5 48 L 125.5 40.5" stroke="var(--kova-white)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </g>
      </g>
      <g className="kova-prop kova-prop-error">
        <g className="kova-badge-pop">
          <circle cx="120" cy="44" r="11" fill="var(--kova-error)" stroke="var(--kova-outline)" strokeWidth="2.6" />
          <path d="M 120 38.5 L 120 45.5" stroke="var(--kova-white)" strokeWidth="2.8" strokeLinecap="round" />
          <circle cx="120" cy="49.5" r="1.5" fill="var(--kova-white)" />
        </g>
      </g>
      <g className="kova-prop kova-prop-sleeping">
        <text className="kova-z1" x="108" y="50" fill="var(--kova-gold)" stroke="var(--kova-outline)" strokeWidth="3" paintOrder="stroke" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="800" fontSize="14">z</text>
        <text className="kova-z2" x="120" y="39" fill="var(--kova-gold)" stroke="var(--kova-outline)" strokeWidth="3.4" paintOrder="stroke" fontFamily="system-ui, -apple-system, sans-serif" fontWeight="800" fontSize="18">Z</text>
      </g>
    </svg>
  );
}

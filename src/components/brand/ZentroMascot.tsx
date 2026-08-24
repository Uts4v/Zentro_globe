interface ZentroMascotProps {
  className?: string;
  waving?: boolean;
  celebrate?: boolean;
}

/**
 * Zentro Mascot (100% Unclipped Full Viewport Rendering):
 * - Shifted Y coordinates and expanded viewBox (0 0 240 280) so top sprout hair is NEVER clipped!
 * - White soft 3D rounded marshmallow body
 * - Dark navy 3-leaf sprout hair on top of head
 * - Black left eye with specular shine highlight, right eye winking 😉
 * - Happy smile mouth & soft pink blush cheeks
 * - Holds dark purple circular coin badge with bold white "Z"
 * - Ambient gold star sparkles ✨ and accent lines around mascot
 */
export function ZentroMascot({ className = "" }: ZentroMascotProps) {
  return (
    <svg viewBox="0 0 240 280" className={className} role="img" aria-label="Zentro mascot">
      <defs>
        {/* Soft 3D White Marshmallow Body Gradient */}
        <linearGradient id="full-body-grad" x1="30%" y1="0%" x2="70%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="60%" stopColor="#FFFFFF" />
          <stop offset="85%" stopColor="#F6F1FD" />
          <stop offset="100%" stopColor="#EADBFF" />
        </linearGradient>

        {/* Specular Highlight for 3D depth */}
        <radialGradient id="full-specular" cx="30%" cy="20%" r="45%">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>

        {/* Dark Purple Coin Badge Gradient */}
        <linearGradient id="full-coin-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#25163E" />
          <stop offset="100%" stopColor="#110822" />
        </linearGradient>

        {/* Dark Sprout Hair Gradient */}
        <linearGradient id="full-sprout-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#22153B" />
          <stop offset="100%" stopColor="#100720" />
        </linearGradient>

        {/* Soft Drop Shadow */}
        <filter id="full-shadow" x="-30%" y="-20%" width="160%" height="160%">
          <feDropShadow dx="0" dy="10" stdDeviation="12" floodColor="#4B32C3" floodOpacity="0.18" />
        </filter>
      </defs>

      {/* Floating Ground Shadow */}
      <ellipse cx="120" cy="265" rx="50" ry="7" fill="#4B32C3" opacity="0.12" />

      {/* Main Mascot Group shifted down by +35px so hair y=35 is well inside the viewBox */}
      <g filter="url(#full-shadow)" transform="translate(0, 32)">
        <animateTransform
          attributeName="transform"
          type="translate"
          values="0 32; 0 26; 0 32"
          dur="3.2s"
          repeatCount="indefinite"
          calcMode="spline"
          keySplines="0.45 0 0.55 1; 0.45 0 0.55 1"
        />

        {/* ✦ 3-Leaf Dark Sprout Hair on Top of Head (Positioned safely at y=32) ✦ */}
        <g transform="translate(118, 30)">
          {/* Left leaf */}
          <path
            d="M 0 0 C -12 -12, -18 -24, -10 -28 C -2 -30, 4 -18, 0 0 Z"
            fill="url(#full-sprout-grad)"
          />
          {/* Middle leaf */}
          <path
            d="M 0 0 C -4 -14, 0 -30, 8 -30 C 16 -30, 12 -14, 0 0 Z"
            fill="url(#full-sprout-grad)"
          />
          {/* Right leaf */}
          <path
            d="M 0 0 C 12 -10, 22 -20, 18 -26 C 12 -30, 2 -16, 0 0 Z"
            fill="url(#full-sprout-grad)"
          />
        </g>

        {/* ✦ Main White Body ✦ */}
        <path
          d="
            M 120 32
            C 166 32, 198 62, 200 112
            C 202 152, 192 184, 180 204
            C 168 224, 146 230, 120 230
            C 94 230, 72 224, 60 204
            C 48 184, 38 152, 40 112
            C 42 62, 74 32, 120 32
            Z
          "
          fill="url(#full-body-grad)"
        />

        {/* 3D Highlight Layer */}
        <path
          d="
            M 120 32
            C 166 32, 198 62, 200 112
            C 202 152, 192 184, 180 204
            C 168 224, 146 230, 120 230
            C 94 230, 72 224, 60 204
            C 48 184, 38 152, 40 112
            C 42 62, 74 32, 120 32
            Z
          "
          fill="url(#full-specular)"
        />

        {/* Body Edge Contour */}
        <path
          d="
            M 120 32
            C 166 32, 198 62, 200 112
            C 202 152, 192 184, 180 204
            C 168 224, 146 230, 120 230
            C 94 230, 72 224, 60 204
            C 48 184, 38 152, 40 112
            C 42 62, 74 32, 120 32
            Z
          "
          fill="none"
          stroke="#E4D6F7"
          strokeWidth="1.2"
          opacity="0.6"
        />

        {/* ✦ Left Arm ✦ */}
        <ellipse cx="45" cy="148" rx="10" ry="14" fill="#FFFFFF" stroke="#E4D6F7" strokeWidth="1" />

        {/* ✦ Right Arm ✦ */}
        <ellipse
          cx="195"
          cy="148"
          rx="10"
          ry="14"
          fill="#FFFFFF"
          stroke="#E4D6F7"
          strokeWidth="1"
        />

        {/* ✦ Face Details ✦ */}
        <g>
          {/* Left Eye: Open glossy black circle */}
          <circle cx="98" cy="112" r="10" fill="#1C1033" />
          <circle cx="101" cy="108" r="3.5" fill="#FFFFFF" />

          {/* Right Eye: Winking curved arc */}
          <path
            d="M 134 114 C 140 104, 150 104, 156 114"
            fill="none"
            stroke="#1C1033"
            strokeWidth="4"
            strokeLinecap="round"
          />

          {/* Pink Blush Cheeks */}
          <ellipse cx="80" cy="124" rx="11" ry="6" fill="#FFA5C3" opacity="0.7" />
          <ellipse cx="160" cy="124" rx="11" ry="6" fill="#FFA5C3" opacity="0.7" />

          {/* Cute Smile Mouth */}
          <path
            d="M 112 126 Q 122 138, 132 126"
            fill="none"
            stroke="#1C1033"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
        </g>

        {/* ✦ Dark Purple Circular Coin Badge ("Z") held by Mascot ✦ */}
        <g transform="translate(148, 168)">
          <circle cx="0" cy="0" r="22" fill="url(#full-coin-grad)" />
          <circle
            cx="0"
            cy="0"
            r="22"
            fill="none"
            stroke="#FFFFFF"
            strokeWidth="1.5"
            opacity="0.4"
          />
          <text
            x="0"
            y="8"
            textAnchor="middle"
            fill="#FFFFFF"
            fontSize="22"
            fontWeight="800"
            fontFamily="'Manrope', Inter, system-ui, sans-serif"
          >
            Z
          </text>
        </g>

        {/* ✦ Feet ✦ */}
        <ellipse cx="94" cy="228" rx="12" ry="6" fill="#E4D6F7" />
        <ellipse cx="146" cy="228" rx="12" ry="6" fill="#E4D6F7" />

        {/* ✦ Ambient Sparkles & Accent Lines ✦ */}
        {/* Yellow 4-point star top right */}
        <path
          d="M 198 36 L 200 42 L 206 44 L 200 46 L 198 52 L 196 46 L 190 44 L 196 42 Z"
          fill="#FFC857"
          opacity="0.9"
        />
        {/* Yellow 4-point star top left */}
        <path
          d="M 36 72 L 38 76 L 42 78 L 38 80 L 36 84 L 34 80 L 30 78 L 34 76 Z"
          fill="#FFC857"
          opacity="0.8"
        />
        {/* 3 Purple Spark Lines top right of mascot */}
        <g stroke="#9C8AFF" strokeWidth="2.5" strokeLinecap="round" opacity="0.7">
          <line x1="212" y1="66" x2="224" y2="56" />
          <line x1="220" y1="78" x2="232" y2="76" />
          <line x1="210" y1="88" x2="220" y2="94" />
        </g>
      </g>
    </svg>
  );
}

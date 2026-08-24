// src/components/brand/ZentroSplashScreen.tsx
//
// Premium handwritten-calligraphy splash screen for Zentro.
//
// The letterform geometry below was TRACED FROM THE BRAND'S REAL LOGO
// (font-unit outlines, y-flipped via the group transform), split into 6
// ink strokes in natural writing order: Z, e, n, t, r, o.
//
// Technique: each letter's outline is drawn with an SVG
// stroke-dasharray/dashoffset "pen" animation, then crossfades from
// stroke to solid fill as its outline completes. After the last letter,
// the mark holds with a soft glow bloom, then the whole splash fades out.
//
// Usage:
//   const [showSplash, setShowSplash] = useState(true);
//   {showSplash && (
//     <ZentroSplashScreen onFinish={() => setShowSplash(false)} autoUnmount={false} />
//   )}

import { useEffect, useMemo, useRef, useState } from "react";

export interface ZentroSplashScreenProps {
  /** Called once the full reveal + hold + fade-out sequence completes. */
  onFinish?: () => void;
  /** If true (default), the component removes itself from the DOM after finishing. */
  autoUnmount?: boolean;
  /** Background color. Defaults to the brand cream. */
  backgroundColor?: string;
  /** Logo ink color. Defaults to the brand deep teal. */
  inkColor?: string;
}

const VIEW_BOX = "0 0 1266.145645 398.113386";
const GROUP_TRANSFORM = "translate(-220.243495,653.586048) scale(0.100000,-0.100000)";

interface Letter {
  id: string;
  start: number;
  end: number;
  d: string;
}

// ms — proportional to each stroke's real traced length, with slight
// overlap between letters so the reveal reads as one continuous gesture.
const LETTERS: Letter[] = [
  {
    id: "z",
    start: 0,
    end: 620,
    d: "M3251 6529 c-109 -12 -298 -55 -379 -85 -303 -114 -510 -317 -572 -560 -24 -93 -26 -244 -5 -324 51 -193 191 -331 381 -376 90 -21 265 -14 343 13 30 11 56 24 58 30 2 5 -16 18 -40 27 -102 39 -178 147 -199 283 -9 55 -8 88 5 163 22 132 74 234 173 339 128 136 275 218 479 266 226 54 455 52 855 -6 113 -16 242 -35 288 -41 45 -6 82 -14 82 -17 0 -8 -60 -80 -776 -926 -323 -382 -1168 -1380 -1477 -1744 -147 -174 -266 -323 -265 -331 5 -27 48 -22 131 13 117 50 304 105 435 128 140 23 392 26 532 4 293 -44 555 -144 945 -360 587 -325 881 -428 1319 -465 214 -18 479 12 675 77 104 34 268 113 354 170 96 63 234 197 296 288 82 118 60 155 -41 69 -198 -170 -443 -266 -725 -283 -359 -21 -655 54 -1168 299 -739 352 -1040 440 -1506 440 -82 0 -149 3 -149 6 0 12 150 192 515 619 94 110 297 349 450 530 154 182 405 479 560 660 154 182 357 422 450 535 93 113 209 252 258 309 79 92 87 105 74 119 -14 13 -28 13 -129 -4 -88 -15 -164 -19 -348 -18 -252 0 -322 7 -715 69 -439 70 -593 87 -845 90 -129 2 -273 -1 -319 -6z",
  },
  {
    id: "e",
    start: 480,
    end: 850,
    d: "M10150 6252 c-30 -14 -147 -65 -260 -113 l-205 -88 -3 -196 -2 -196 -43 5 c-528 65 -1028 22 -1315 -114 -45 -22 -85 -46 -88 -54 -10 -25 16 -57 64 -78 60 -27 117 -21 292 32 294 89 422 105 750 96 129 -4 258 -10 285 -14 l50 -7 6 -950 c6 -1024 4 -992 60 -1164 106 -331 350 -566 712 -686 313 -104 715 -105 1127 -5 69 17 231 60 360 95 387 106 565 135 821 135 247 0 443 -41 624 -130 112 -55 209 -130 269 -207 51 -64 72 -65 68 -3 -6 94 -70 238 -149 337 -195 244 -522 362 -915 332 -254 -19 -457 -77 -854 -245 -197 -83 -350 -138 -474 -170 -72 -19 -130 -27 -240 -31 -126 -5 -157 -2 -235 16 -111 27 -231 84 -309 148 -117 94 -220 261 -266 425 -47 172 -50 236 -50 1159 l0 866 213 -5 c165 -3 237 -1 327 12 184 27 350 90 430 163 33 29 40 42 40 73 0 73 -61 116 -155 108 -42 -4 -87 -21 -197 -76 -79 -39 -183 -83 -233 -98 -77 -23 -114 -27 -257 -32 l-168 -4 0 340 c0 263 -3 341 -12 344 -7 3 -38 -6 -68 -20z",
  },
  {
    id: "n",
    start: 760,
    end: 1080,
    d: "M6668 5674 c-15 -15 -7 -23 60 -59 136 -76 446 -292 539 -378 25 -23 54 -59 66 -82 l22 -40 3 -887 c2 -690 5 -887 15 -890 6 -1 128 -2 270 0 l257 3 0 648 c0 617 1 652 20 727 50 196 191 333 362 352 220 25 364 -85 434 -333 15 -52 18 -134 24 -605 7 -572 6 -564 54 -699 41 -114 153 -252 271 -331 134 -90 253 -137 421 -165 121 -20 197 -17 202 7 2 12 -17 27 -70 54 -140 70 -240 205 -290 389 -20 75 -22 111 -28 620 -5 331 -12 564 -19 602 -38 207 -131 379 -261 486 -65 53 -167 104 -257 129 -119 32 -309 30 -474 -5 -188 -39 -325 -50 -462 -38 -269 25 -432 95 -709 303 -204 154 -271 189 -372 196 -39 2 -74 1 -78 -4z m1298 -671 c-72 -98 -65 -96 -66 -20 l0 67 50 0 51 0 -35 -47z",
  },
  {
    id: "t",
    start: 1000,
    end: 1500,
    d: "M13685 5339 c-272 -25 -552 -160 -711 -343 -114 -132 -183 -265 -232 -445 -22 -83 -25 -117 -26 -256 0 -134 3 -175 22 -250 29 -114 115 -290 184 -376 74 -91 197 -199 284 -249 179 -103 328 -141 564 -148 141 -3 180 -1 270 18 209 43 402 142 533 273 120 119 220 297 269 475 18 65 22 105 22 257 0 156 -3 191 -22 263 -53 195 -157 377 -285 499 -88 83 -142 122 -245 173 -172 86 -415 128 -627 109z m252 -131 c240 -89 416 -432 440 -853 11 -208 -35 -437 -127 -622 -104 -211 -226 -322 -388 -353 -122 -24 -245 20 -351 127 -161 162 -264 434 -278 733 -15 338 94 675 278 859 129 130 273 167 426 109z",
  },
  {
    id: "r",
    start: 1400,
    end: 1750,
    d: "M5959 5330 c-158 -28 -338 -102 -456 -186 -185 -132 -332 -342 -397 -566 -111 -386 5 -796 297 -1049 93 -81 183 -135 302 -182 119 -47 224 -68 371 -74 317 -14 583 85 789 291 88 89 168 205 163 236 -7 35 -41 21 -103 -43 -85 -87 -154 -138 -255 -186 -201 -97 -441 -95 -637 5 -121 61 -212 150 -294 285 -134 224 -164 514 -83 819 66 253 195 450 341 522 54 26 77 32 132 32 113 0 214 -61 289 -174 52 -77 80 -152 93 -248 19 -139 -22 -265 -121 -363 -132 -133 -302 -166 -542 -107 -72 18 -90 19 -102 8 -9 -7 -16 -19 -16 -27 0 -20 135 -80 250 -111 85 -23 114 -26 275 -26 213 -1 281 12 423 81 115 56 196 132 244 231 32 64 33 71 33 187 0 99 -4 130 -22 179 -64 170 -217 319 -413 401 -129 55 -191 67 -360 71 -85 1 -176 -1 -201 -6z",
  },
  {
    id: "o",
    start: 1650,
    end: 1950,
    d: "M12010 5239 c-85 -9 -182 -35 -246 -65 -128 -60 -251 -172 -321 -292 l-28 -47 -5 190 c-4 166 -7 190 -21 189 -9 -1 -99 -26 -200 -57 -101 -31 -213 -64 -249 -74 l-65 -19 -3 -862 -2 -862 270 0 269 0 3 638 3 637 25 65 c31 80 89 168 137 211 54 47 146 87 219 94 167 18 322 -75 402 -243 35 -72 37 -83 39 -182 1 -98 2 -105 22 -108 36 -6 138 58 200 124 79 84 104 149 105 269 1 82 -2 96 -31 156 -71 144 -209 223 -418 242 -22 2 -69 0 -105 -4z",
  },
];

const HOLD_END = 2700; // logo fully drawn, held on screen
const TRANSITION_START = 3300;
const TRANSITION_END = 3800; // splash fully faded, safe to unmount
const REDUCED_TOTAL = 1900;

export function ZentroSplashScreen({
  onFinish,
  autoUnmount = true,
  backgroundColor = "#FAF9F5",
  inkColor = "#073F4B",
}: ZentroSplashScreenProps) {
  const [visible, setVisible] = useState(true);
  const finishedRef = useRef(false);

  const reducedMotion = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
    [],
  );

  useEffect(() => {
    const total = reducedMotion ? REDUCED_TOTAL : TRANSITION_END;
    const timer = setTimeout(() => {
      if (!finishedRef.current) {
        finishedRef.current = true;
        onFinish?.();
        if (autoUnmount) setVisible(false);
      }
    }, total);
    return () => clearTimeout(timer);
  }, [reducedMotion, onFinish, autoUnmount]);

  // Scoped stylesheet: per-letter draw + stroke→fill crossfade, glow, fade-out.
  const css = useMemo(() => {
    if (reducedMotion) {
      return `
        .zentro-stroke {
          fill: ${inkColor};
          stroke: none;
          stroke-dasharray: 1;
          stroke-dashoffset: 0;
        }
      `;
    }
    const perLetter = LETTERS.map(({ id, start, end }) => {
      const dur = end - start;
      return `
        #zentro-${id} {
          animation:
            zs-draw-${id} ${dur}ms cubic-bezier(.65,0,.35,1) ${start}ms forwards,
            zs-fill-${id} 380ms ease-out ${end - 160}ms forwards;
        }
        @keyframes zs-draw-${id} { to { stroke-dashoffset: 0; } }
        @keyframes zs-fill-${id} {
          0%   { fill-opacity: 0; stroke-opacity: 1; }
          70%  { stroke-opacity: 0.4; }
          100% { fill-opacity: 1; stroke-opacity: 0; }
        }
      `;
    }).join("\n");

    return `
      .zentro-stroke {
        fill: ${inkColor};
        fill-opacity: 0;
        stroke: ${inkColor};
        stroke-opacity: 1;
        stroke-width: 3.5;
        stroke-linecap: round;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
        stroke-dasharray: 1;
        stroke-dashoffset: 1;
        paint-order: stroke fill;
      }
      ${perLetter}
      @keyframes zs-glow {
        0%   { filter: drop-shadow(0 0 0 rgba(7,63,75,0)); }
        50%  { filter: drop-shadow(0 0 14px rgba(7,63,75,0.16)); }
        100% { filter: drop-shadow(0 0 0 rgba(7,63,75,0)); }
      }
      @keyframes zs-fadeout {
        to { opacity: 0; visibility: hidden; }
      }
    `;
  }, [reducedMotion, inkColor]);

  if (!visible) return null;

  return (
    <div
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: backgroundColor,
        zIndex: 9999,
        pointerEvents: "auto",
        animation: reducedMotion
          ? `zs-fadeout 400ms ease 1400ms forwards`
          : `zs-fadeout 500ms ease ${TRANSITION_START}ms forwards`,
      }}
    >
      <style>{css}</style>
      <div
        style={{
          width: "min(62vw, 620px)",
          maxWidth: 680,
          minWidth: 220,
          animation: reducedMotion ? "none" : `zs-glow 900ms ease-in-out ${HOLD_END}ms 1`,
        }}
      >
        <svg
          viewBox={VIEW_BOX}
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label="Zentro"
          style={{ width: "100%", height: "auto", display: "block", overflow: "visible" }}
        >
          <g transform={GROUP_TRANSFORM}>
            {LETTERS.map((l) => (
              <path
                key={l.id}
                id={`zentro-${l.id}`}
                className="zentro-stroke"
                pathLength={1}
                d={l.d}
              />
            ))}
          </g>
        </svg>
      </div>
    </div>
  );
}

export default ZentroSplashScreen;

import { Link } from "@tanstack/react-router";
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  QrCode,
  Gift,
  Sparkles,
  ArrowRight,
  Compass,
  Coffee,
  ChefHat,
  Wine,
  Printer,
  Receipt,
  WifiOff,
  Check,
  ChevronRight,
  Flame,
  CheckCircle2,
  Boxes,
  Users,
  BarChart3,
  ScanLine,
  Volume2,
  Tag,
  Home as HomeIcon,
  Map as MapIcon,
  Utensils,
  Trophy,
  User as UserIcon,
  type LucideIcon,
} from "lucide-react";
import { ZentroLogo } from "@/components/brand/ZentroLogo";

/* -------------------------------------------------------------------------- */
/*  Motion helpers (no extra dependencies)                                    */
/* -------------------------------------------------------------------------- */

const EASE = "cubic-bezier(.2,.7,.2,1)";

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** True once the element has scrolled into view (and stays true). */
function useInView<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion() || typeof IntersectionObserver === "undefined") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold, rootMargin: "0px 0px -6% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return { ref, inView };
}

function Reveal({
  children,
  delay = 0,
  y = 28,
  className = "",
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const { ref, inView } = useInView<HTMLDivElement>(0.12);
  return (
    <div ref={ref} className={`zt-reveal ${className}`} data-seen={inView}
      style={{ "--delay": `${delay}ms`, "--lift": `${y}px` } as CSSProperties}>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Animated hero backdrop: aurora blobs, drifting grid, cursor glow          */
/* -------------------------------------------------------------------------- */

function HeroShell({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || e.pointerType === "touch") return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  return (
    <div ref={ref} className="zt-hero-shell" onPointerMove={onMove}>
      <div className="zt-backdrop" aria-hidden="true">
        <span className="zt-blob zt-blob-a" />
        <span className="zt-blob zt-blob-b" />
        <span className="zt-blob zt-blob-c" />
        <span className="zt-backdrop-grid" />
        <span className="zt-spot" />
        <span className="zt-backdrop-fade" />
      </div>
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Device frames                                                             */
/* -------------------------------------------------------------------------- */

function Phone({ children, className = "", style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div
      className={`relative h-[540px] w-[260px] shrink-0 overflow-hidden rounded-[2.6rem] border-[7px] border-black bg-[#faf5ec] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.5)] ${className}`}
      style={style}
    >
      <div className="absolute left-1/2 top-2 z-30 h-5 w-20 -translate-x-1/2 rounded-full bg-black" />
      {children}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Diner app screens (modelled on the live Zentro app)                       */
/* -------------------------------------------------------------------------- */

function AppNav({ active = 0 }: { active?: number }) {
  const items: LucideIcon[] = [HomeIcon, MapIcon, Utensils, Gift, Trophy, UserIcon];
  const left = items.slice(0, 3);
  const right = items.slice(3);
  const cell = (Icon: LucideIcon, i: number) => (
    <span key={i} className={`grid h-8 w-8 place-items-center ${i === active ? "text-[#202239]" : "text-[#202239]/45"}`}>
      <Icon className="h-4 w-4" />
    </span>
  );
  return (
    <div className="absolute inset-x-3 bottom-3 z-20 flex items-center justify-between rounded-full bg-[#fffdf8] px-3 py-2 shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)]">
      {left.map((Icon, i) => cell(Icon, i))}
      <span className="-mt-6 grid h-12 w-12 place-items-center rounded-full bg-black text-white shadow-lg ring-4 ring-[#faf5ec]">
        <ScanLine className="h-5 w-5" />
      </span>
      {right.map((Icon, i) => cell(Icon, i + 3))}
    </div>
  );
}

function Mascot() {
  return (
    <div className="relative h-14 w-12 rounded-[50%_50%_46%_46%] bg-white shadow-[0_6px_14px_-4px_rgba(0,0,0,0.3)]">
      <span className="absolute left-3 top-5 h-1.5 w-1.5 rounded-full bg-[#202239]" />
      <span className="absolute right-3 top-5 h-1.5 w-1.5 rounded-full bg-[#202239]" />
      <span className="absolute left-1.5 top-7 h-1.5 w-2 rounded-full bg-pink-300/70" />
      <span className="absolute right-1.5 top-7 h-1.5 w-2 rounded-full bg-pink-300/70" />
      <span className="absolute bottom-2 left-1/2 grid h-4 w-4 -translate-x-1/2 place-items-center rounded-full bg-[#202239] text-[8px] font-bold text-white">z</span>
    </div>
  );
}

function HomeCardScreen() {
  return (
    <div className="relative h-full bg-[#faf5ec] px-4 pt-11 text-[#202239]">
      <div className="flex items-start justify-between">
        <div>
          <ZentroLogo className="h-4 w-auto text-[#202239]" title="Zentro" />
          <p className="mt-2 text-[10px] text-[#202239]/60">Good morning,</p>
          <p className="font-display text-xl font-extrabold leading-none">Alex 👋</p>
        </div>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-[#202239] text-[10px] font-bold text-white">A</span>
      </div>

      <div className="relative mt-4 overflow-hidden rounded-[1.6rem] bg-gradient-to-br from-[#824d50] to-[#472f48] p-3.5 pb-14 text-white">
        <div className="absolute -right-6 -top-10 h-32 w-32 rounded-full bg-white/10" />
        <div className="flex items-start justify-between">
          <div>
            <span className="rounded-full bg-gradient-to-r from-amber-300 to-orange-300 px-2 py-0.5 text-[8px] font-bold text-[#5a3a12]">BRONZE</span>
            <p className="mt-3 text-[8px] tracking-wide text-white/80">MEMBERSHIP</p>
            <p className="font-display text-lg font-extrabold leading-tight">Fir & Leaf</p>
            <span className="mt-2 grid h-11 w-11 place-items-center rounded-full bg-white font-display text-lg font-extrabold text-[#202239]">F</span>
          </div>
          <div className="text-right">
            <div className="mb-1 flex justify-end"><Mascot /></div>
            <p className="text-[8px] tracking-wide text-white/80">YOUR POINTS</p>
            <p className="font-display text-3xl font-extrabold leading-none">40<span className="ml-0.5 text-xs font-medium">pts</span></p>
          </div>
        </div>
        <div className="mt-3 h-2 rounded-full bg-white/90"><div className="h-full w-[6%] rounded-full bg-[#202239]" /></div>
        <div className="absolute inset-x-0 bottom-0 flex justify-around rounded-t-2xl bg-[#fffdf8] py-2 text-[#202239]">
          {[["2", "Day streak"], ["0", "Rewards"], ["3", "Orders"]].map(([n, l]) => (
            <div key={l} className="text-center">
              <p className="text-sm font-extrabold leading-none">{n}</p>
              <p className="mt-0.5 text-[8px] text-[#202239]/55">{l}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-[9px] font-bold tracking-widest text-[#202239]/60">ACTIVE MISSIONS</p>
      <div className="mt-1.5 rounded-2xl bg-[#fffdf8] p-3">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold">Order any drink</p>
          <span className="rounded-full bg-[#202239]/10 px-1.5 py-0.5 text-[8px] font-bold">+25 pts</span>
        </div>
        <div className="mt-2 h-1.5 rounded-full bg-[#202239]/10"><div className="h-full w-1/2 rounded-full bg-[#b44116]" /></div>
      </div>
      <AppNav active={0} />
    </div>
  );
}

function Voucher({ large = false, title = "Buy 1 flat white, get one free", sample = false }: { large?: boolean; title?: string; sample?: boolean }) {
  return (
    <div className="rounded-[1.6rem] bg-gradient-to-b from-[#d7a92c] to-[#e6c777] p-2.5 shadow-[0_24px_50px_-18px_rgba(120,80,0,0.6)]">
      <div className="flex gap-2">
        <div
          className="relative flex-1 overflow-hidden rounded-2xl bg-[#fbf3dc] p-3 text-[#202239]"
          style={{ backgroundImage: "repeating-conic-gradient(from 0deg at 62% 55%, rgba(214,170,44,.18) 0 6deg, transparent 6deg 12deg)" }}
        >
          <div className="flex items-center gap-1.5">
            <span className={`grid place-items-center rounded-full bg-[#efe6d3] ${large ? "h-9 w-9" : "h-6 w-6"}`}>
              <Coffee className={large ? "h-4 w-4" : "h-3 w-3"} />
            </span>
            <div>
              <p className={`font-bold leading-none ${large ? "text-sm" : "text-[9px]"}`}>Fir & Leaf</p>
              <p className={`text-[#202239]/60 ${large ? "text-xs" : "text-[7px]"}`}>Zentro partner</p>
            </div>
          </div>
          <p className={`font-serif leading-[1.05] tracking-tight ${large ? "mt-5 text-4xl sm:text-5xl" : "mt-3 text-[19px]"}`}>
            {title}
          </p>
          <div className={`flex justify-between border-t border-[#202239]/15 pt-2 ${large ? "mt-6 text-xs" : "mt-3 text-[8px]"}`}>
            <span><span className="block text-[#202239]/55">{sample ? "PREVIEW" : "VALIDITY"}</span><b>{sample ? "Example offer" : "No expiry"}</b></span>
            <span className="text-right"><span className="block text-[#202239]/55">STATUS</span><b>In wallet</b></span>
          </div>
        </div>
        <div className={`flex flex-col items-center justify-between rounded-2xl bg-[#efe9d8] p-2 ${large ? "w-20 sm:w-32" : "w-[64px]"}`}>
          <span className={`text-[#202239]/55 ${large ? "text-[10px]" : "text-[6px]"}`}>SCAN AT COUNTER</span>
          <span className={`grid place-items-center rounded-lg bg-white ${large ? "h-14 w-14 sm:h-24 sm:w-24" : "h-11 w-11"}`}>
            <QrCode className={large ? "h-12 w-12 sm:h-20 sm:w-20" : "h-9 w-9"} strokeWidth={1.4} />
          </span>
          <span className={`font-mono text-[#202239]/60 ${large ? "text-[10px]" : "text-[6px]"}`}>BAX3-A9E8T</span>
        </div>
      </div>
    </div>
  );
}

function VoucherScreen() {
  return (
    <div className="relative h-full bg-[#4c4859] px-3 pt-11">
      <p className="mb-2 text-sm font-extrabold text-white">Fir & Leaf</p>
      <Voucher />
      <div className="mt-3 rounded-3xl bg-[#fffdf8] p-3">
        <div className="rounded-full bg-[#202239] py-2.5 text-center text-[11px] font-bold text-white">Copy code ZNT-BAX3-A9E8T</div>
        <div className="mt-2.5 rounded-2xl bg-[#efe9d8] p-3 text-[#202239]">
          <p className="text-[8px] font-bold tracking-widest text-[#202239]/55">HOW TO USE</p>
          <p className="mt-1 text-[11px] font-bold leading-snug">Show it at the counter, or apply it when you order in the app.</p>
        </div>
      </div>
    </div>
  );
}

function ScanScreen() {
  return (
    <div className="flex h-full flex-col bg-[#181a2c] px-5 pb-6 pt-12 text-white">
      <p className="text-center text-xs text-white/60">Point your camera at the table code</p>
      <div className="relative mx-auto mt-8 grid aspect-square w-full place-items-center rounded-3xl bg-white/5">
        {(["left-3 top-3 border-l-2 border-t-2 rounded-tl-xl", "right-3 top-3 border-r-2 border-t-2 rounded-tr-xl", "left-3 bottom-3 border-l-2 border-b-2 rounded-bl-xl", "right-3 bottom-3 border-r-2 border-b-2 rounded-br-xl"] as const).map((c) => (
          <span key={c} className={`absolute h-7 w-7 border-[#c35128] ${c}`} />
        ))}
        <QrCode className="h-24 w-24 text-white/90" strokeWidth={1.2} />
        <span className="zt-scan absolute inset-x-6 h-0.5 rounded-full bg-ember shadow-[0_0_18px_3px_rgba(255,106,0,0.7)]" />
      </div>
      <div className="mt-auto rounded-2xl bg-white/10 p-4 text-center backdrop-blur">
        <p className="text-[11px] text-white/60">Table detected</p>
        <p className="mt-0.5 font-display text-lg font-bold">Table 12 · Opening menu</p>
      </div>
    </div>
  );
}

function MenuScreen() {
  const items = [
    { n: "Flat white", d: "Double shot, silky milk", p: "4.20" },
    { n: "Cardamom bun", d: "Baked this morning", p: "3.60" },
    { n: "Halloumi toastie", d: "Chilli honey, sourdough", p: "8.90" },
    { n: "Iced hibiscus tea", d: "Lime, mint", p: "4.80" },
  ];
  return (
    <div className="flex h-full flex-col bg-[#faf5ec] px-4 pb-4 pt-12 text-[#202239]">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] text-[#202239]/60">Table 12</p>
          <p className="font-display text-base font-bold">Morning menu</p>
        </div>
        <span className="grid h-8 w-8 place-items-center rounded-full bg-ember/10 text-ember"><Coffee className="h-4 w-4" /></span>
      </div>
      <div className="mt-4 flex gap-1.5 text-[10px] font-semibold">
        <span className="rounded-full bg-[#202239] px-3 py-1 text-white">All</span>
        <span className="rounded-full bg-[#202239]/10 px-3 py-1">Coffee</span>
        <span className="rounded-full bg-[#202239]/10 px-3 py-1">Bakery</span>
      </div>
      <div className="mt-4 space-y-2.5">
        {items.map((i) => (
          <div key={i.n} className="flex items-center gap-3 rounded-2xl bg-[#fffdf8] p-2.5">
            <div className="h-12 w-12 shrink-0 rounded-xl bg-gradient-to-br from-[#c35128]/30 to-amber-400/30" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold">{i.n}</p>
              <p className="truncate text-[10px] text-[#202239]/60">{i.d}</p>
              <p className="mt-0.5 text-[11px] font-bold">${i.p}</p>
            </div>
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#202239] text-sm leading-none text-white">+</span>
          </div>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between rounded-full bg-[#202239] px-4 py-3 text-white">
        <span className="text-xs font-semibold">2 items</span>
        <span className="text-xs font-bold">Place order · $7.80</span>
      </div>
    </div>
  );
}

function TrackScreen() {
  const steps = [
    { l: "Received", t: "12:04", done: true },
    { l: "Cooking", t: "12:06", done: true },
    { l: "Ready", t: "~3 min", done: false },
  ];
  return (
    <div className="flex h-full flex-col bg-[#faf5ec] px-5 pb-6 pt-12 text-[#202239]">
      <p className="text-[10px] text-[#202239]/60">Order #204 · Table 12</p>
      <p className="mt-1 font-display text-2xl font-extrabold leading-tight">Your food is on the pan.</p>
      <div className="relative mx-auto mt-8 grid h-32 w-32 place-items-center">
        <span className="zt-ring absolute inset-0 rounded-full border-2 border-[#c35128]/40" />
        <span className="zt-ring absolute inset-0 rounded-full border-2 border-[#c35128]/40" style={{ animationDelay: "1s" }} />
        <span className="grid h-20 w-20 place-items-center rounded-full bg-ember text-white shadow-lg"><Flame className="h-9 w-9" /></span>
      </div>
      <ol className="mt-8 space-y-4">
        {steps.map((s) => (
          <li key={s.l} className="flex items-center gap-3">
            <span className={`grid h-7 w-7 place-items-center rounded-full ${s.done ? "bg-ember text-white" : "border border-[#202239]/20 bg-[#202239]/5"}`}>
              {s.done ? <Check className="h-4 w-4" /> : null}
            </span>
            <span className={`flex-1 text-sm font-semibold ${s.done ? "" : "text-[#202239]/50"}`}>{s.l}</span>
            <span className="text-[11px] text-[#202239]/55">{s.t}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  POS terminal mock                                                         */
/* -------------------------------------------------------------------------- */

function PosTerminal() {
  const tiles = ["Flat white", "Cappuccino", "Masala chai", "Cardamom bun", "Croissant", "Toastie", "Iced tea", "Lemonade", "Brownie"];
  const lines: [string, string][] = [["2× Flat white", "8.40"], ["1× Toastie", "8.90"], ["1× Iced tea", "4.80"]];
  return (
    <div className="h-[370px] w-[580px] overflow-hidden rounded-[1.8rem] border-[9px] border-black bg-[#faf5ec] text-[#202239] shadow-[0_40px_80px_-20px_rgba(0,0,0,0.55)]">
      <div className="flex h-9 items-center justify-between bg-[#202239] px-4 text-[10px] text-white">
        <span className="font-semibold">Zentro POS · Counter 1</span>
        <span className="flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5"><WifiOff className="h-3 w-3" /> Offline · will sync</span>
      </div>
      <div className="flex h-[calc(100%-2.25rem)]">
        <div className="flex-1 p-3">
          <div className="flex gap-1.5 text-[9px] font-semibold">
            {["All", "Coffee", "Tea", "Bakery", "Cold"].map((c, i) => (
              <span key={c} className={`rounded-full px-2.5 py-1 ${i === 0 ? "bg-[#202239] text-white" : "bg-[#202239]/10"}`}>{c}</span>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {tiles.map((t, i) => (
              <div key={t} className={`rounded-xl p-2.5 ${i === 0 || i === 5 || i === 6 ? "bg-[#c35128]/15 ring-1 ring-[#c35128]/40" : "bg-[#fffdf8]"}`}>
                <div className="mb-2 h-8 rounded-lg bg-gradient-to-br from-[#c35128]/25 to-amber-300/30" />
                <p className="text-[10px] font-semibold">{t}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="flex w-[190px] flex-col border-l border-[#202239]/10 bg-[#fffdf8] p-3">
          <p className="text-[11px] font-bold">Table 12 · Dine in</p>
          <div className="mt-3 space-y-2 text-[10px]">
            {lines.map(([n, p]) => (
              <div key={n} className="flex justify-between"><span>{n}</span><span className="text-[#202239]/60">${p}</span></div>
            ))}
          </div>
          <div className="mt-auto">
            <div className="flex items-end justify-between border-t border-dashed border-[#202239]/20 pt-2">
              <span className="text-[10px] text-[#202239]/60">Total</span>
              <span className="font-display text-xl font-extrabold">$22.10</span>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1.5 text-center text-[9px] font-bold">
              <span className="rounded-lg bg-[#202239]/10 py-2">Send KOT</span>
              <span className="rounded-lg bg-[#202239]/10 py-2">Print bill</span>
            </div>
            <div className="mt-1.5 rounded-lg bg-ember py-2.5 text-center text-[11px] font-bold text-white">Charge $22.10</div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Pinned scroll story (diner journey)                                       */
/* -------------------------------------------------------------------------- */

const STORY = [
  { icon: QrCode, title: "Scan at the table", body: "Customers point their camera at the code on the table. Your live menu opens in the browser. No app, no sign-in." },
  { icon: Coffee, title: "Order from your live menu", body: "Photos, sizes and toppings, sent straight to the right station. Prices are always confirmed by the server." },
  { icon: Flame, title: "Track it in the kitchen", body: "Guests see their order go from Received to Cooking to Ready, live from your kitchen screen." },
  { icon: Sparkles, title: "Points, streaks and missions", body: "One tap to join. Every visit earns points and keeps guests coming back for the next reward." },
  { icon: Gift, title: "Redeem offers at the counter", body: "Vouchers carry a QR and a one-time code. Staff scan it, and it can only be used once." },
] as const;

const STORY_SCREENS = [ScanScreen, MenuScreen, TrackScreen, HomeCardScreen, VoucherScreen];

function ScrollStory() {
  const chapters = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState(0);

  useEffect(() => {
    const list = chapters.current;
    if (!list) return;
    const desktop = window.matchMedia("(min-width: 800px) and (min-height: 620px)");
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!desktop.matches) return;
      const center = window.innerHeight * .54;
      let closest = 0;
      let distance = Infinity;
      Array.from(list.children).forEach((chapter, i) => {
        const bounds = chapter.getBoundingClientRect();
        const delta = Math.abs(bounds.top + bounds.height / 2 - center);
        if (delta < distance) { closest = i; distance = delta; }
      });
      setStep(closest);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section className="zt-journey" aria-labelledby="zt-journey-title">
      <div className="zt-wrap">
        <p className="zt-label">03 / Guest experience</p>
        <h2 id="zt-journey-title" className="zt-heading">From the first scan<br />to the next visit.</h2>
        <div className="zt-chapters">
          <ol ref={chapters} className="zt-chapter-list">
            {STORY.map(({ title, body, icon: Icon }, i) => {
              const Screen = STORY_SCREENS[i];
              return (
                <li key={title} data-current={step === i}>
                  <span className="zt-chapter-no">0{i + 1} / 05</span>
                  <Icon size={24} aria-hidden />
                  <h3>{title}</h3><p>{body}</p>
                  <div className="zt-small-screen" aria-hidden="true"><Phone><Screen /></Phone></div>
                </li>
              );
            })}
          </ol>
          <div className="zt-story-device" aria-hidden="true">
            <div className="zt-device-halo" />
            <Phone>{STORY_SCREENS.map((Screen, i) => (
              <div className="zt-screen-layer" key={i} data-current={i === step}><Screen /></div>
            ))}</Phone>
            <span className="zt-caption">GUEST VIEW <b>0{step + 1} / 05</b></span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/*  Merchant feature visuals                                                  */
/* -------------------------------------------------------------------------- */

function TileShell({ children, className = "", dark = false }: { children: ReactNode; className?: string; dark?: boolean }) {
  return (
    <div className={`zt-tile h-full overflow-hidden rounded-[2rem] p-6 sm:p-8 ${dark ? "zt-tile-dark" : "zt-tile-light"} ${className}`}>
      {children}
    </div>
  );
}

function TileTitle({ icon: Icon, title, body, dark = false }: { icon: LucideIcon; title: string; body: string; dark?: boolean }) {
  return (
    <div>
      <span className={`grid h-11 w-11 place-items-center rounded-2xl ${dark ? "bg-ember/20 text-ember" : "bg-ember/10 text-ember"}`}>
        <Icon className="h-5 w-5" />
      </span>
      <h3 className="mt-4 font-display text-xl font-bold sm:text-2xl">{title}</h3>
      <p className={`mt-2 max-w-md text-sm leading-relaxed ${dark ? "text-white/70" : "text-muted-foreground"}`}>{body}</p>
    </div>
  );
}

function AiScannerTile() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const found: [string, string][] = [["Masala chai", "3.20"], ["Veg momo (8 pcs)", "6.50"], ["Chicken lolipop", "9.00"], ["Cold coffee", "4.80"]];
  return (
    <TileShell dark>
      <TileTitle
        dark
        icon={ScanLine}
        title="AI menu scanner"
        body="Photograph your printed menu. Zentro reads it and builds your items, prices and categories, so you never enter them one by one."
      />
      <div ref={ref} className="mt-7 grid items-center gap-4 sm:grid-cols-[1fr_auto_1fr]">
        <div className="relative mx-auto h-44 w-36 overflow-hidden rounded-xl bg-[#f3ead6] p-3 text-[#202239] shadow-lg">
          <p className="text-center font-serif text-sm font-bold">MENU</p>
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="mt-2 flex justify-between gap-2">
              <span className="h-1.5 rounded bg-[#202239]/40" style={{ width: `${40 + ((i * 17) % 35)}%` }} />
              <span className="h-1.5 w-5 rounded bg-[#202239]/40" />
            </div>
          ))}
          {inView && <span className="zt-beam absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-transparent via-[#ff7838]/50 to-transparent" />}
        </div>
        <ChevronRight className="mx-auto hidden h-6 w-6 text-ember sm:block" />
        <div className="space-y-2">
          {found.map(([n, p], i) => (
            <div
              key={n}
              className={`flex items-center justify-between rounded-xl bg-white/10 px-3 py-2 text-xs ${inView ? "zt-pop" : ""}`}
              style={{ animationDelay: `${600 + i * 450}ms` }}
            >
              <span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-[#ffbb91]" />{n}</span>
              <span className="text-white/60">${p}</span>
            </div>
          ))}
        </div>
      </div>
    </TileShell>
  );
}

function VoiceTile() {
  return (
    <TileShell dark className="zt-voice">
      <TileTitle icon={Volume2} title="Hear every new order" body="Zentro speaks each new order aloud, so a busy counter never misses a ticket." dark />
      <div className="mt-6 rounded-2xl bg-black/15 p-4">
        <div className="flex h-12 items-center justify-center gap-[3px]">
          {Array.from({ length: 28 }).map((_, i) => (
            <span key={i} className="zt-wave w-1 rounded-full bg-white" style={{ height: "100%", animationDelay: `${(i % 9) * 110}ms` }} />
          ))}
        </div>
        <p className="mt-3 text-center text-sm font-semibold">“New order. Table 12.”</p>
      </div>
    </TileShell>
  );
}

function KotTile() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const ticket = (title: string, Icon: LucideIcon, rows: string[], delay: number) => (
    <div className={`rounded-2xl bg-white/10 p-3 text-xs ${inView ? "zt-pop" : ""}`} style={{ animationDelay: `${delay}ms` }}>
      <p className="flex items-center gap-1.5 font-bold"><Icon className="h-3.5 w-3.5 text-ember" />{title}</p>
      <ul className="mt-2 space-y-1 text-white/70">{rows.map((r) => <li key={r}>{r}</li>)}</ul>
    </div>
  );
  return (
    <TileShell dark>
      <TileTitle dark icon={ChefHat} title="KOTs that reach the right station" body="One order, split automatically. Kitchen to kitchen, bar to bar, each station prints only its own items." />
      <div ref={ref} className="mt-6 grid items-center gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <div className={`rounded-2xl bg-white p-3 text-xs text-[#202239] ${inView ? "zt-pop" : ""}`}>
          <p className="font-bold">Order #204 · Table 12</p>
          <ul className="mt-2 space-y-1 text-[#202239]/70"><li>Halloumi toastie</li><li>Chicken lolipop</li><li>Flat white</li><li>Iced hibiscus tea</li></ul>
        </div>
        <ArrowRight className="mx-auto hidden h-5 w-5 text-ember sm:block" />
        <div className="space-y-2">
          {ticket("Kitchen KOT", ChefHat, ["Halloumi toastie", "Chicken lolipop"], 500)}
          {ticket("Bar KOT", Wine, ["Flat white", "Iced hibiscus tea"], 900)}
        </div>
      </div>
    </TileShell>
  );
}

function AnalyticsTile() {
  const { ref, inView } = useInView<HTMLDivElement>(0.3);
  const bars = [38, 52, 44, 68, 60, 92, 78];
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <TileShell>
      <TileTitle icon={BarChart3} title="Full analytics and store reports" body="See sales, best sellers and busy hours across every store, with daily reports ready when you close." />
      <div ref={ref} className="mt-6">
        <div className="flex h-32 items-end gap-2.5">
          {bars.map((h, i) => (
            <div key={days[i]} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
              <div
                className={`w-full rounded-t-lg ${i === 5 ? "bg-ember" : "bg-ink/80"}`}
                style={{ height: inView ? `${h}%` : "4%", transition: `height 1s ${EASE} ${i * 90}ms` }}
              />
              <span className="text-[10px] text-muted-foreground">{days[i]}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[10px] text-muted-foreground">Sample data</p>
      </div>
    </TileShell>
  );
}

const SMALL: { icon: LucideIcon; t: string; d: string }[] = [
  { icon: Receipt, t: "POS terminal", d: "A fast counter screen for dine-in, takeaway and cash." },
  { icon: Printer, t: "Bill printing", d: "Print bills and kitchen tickets on thermal printers." },
  { icon: WifiOff, t: "Offline POS", d: "Keep billing when the internet drops. Everything syncs when it returns." },
  { icon: Boxes, t: "Stock management", d: "Know what you have and what is running low." },
  { icon: Users, t: "Staff accounts", d: "Give cashiers, waiters and kitchen their own logins." },
  { icon: Tag, t: "Offers and vouchers", d: "Launch buy-one-get-one, discount and birthday offers in minutes." },
];

/* -------------------------------------------------------------------------- */
/*  Page                                                                      */
/* -------------------------------------------------------------------------- */

const SERVICES = [
  {
    venue: "Café", time: "08:15", title: "The takeaway queue is building.",
    body: "A regular wants their usual flat white. The next guest orders breakfast to go. The cashier can ring up both orders while the bar and kitchen work from their own tickets.",
    label: "Takeaway · Order 018", lines: [["Bar", "2 flat whites"], ["Kitchen", "1 toasted bun"]],
    close: "At pickup, the regular can redeem a saved coffee voucher at the counter.",
  },
  {
    venue: "Restaurant", time: "12:40", title: "Table eight is ready to order.",
    body: "Guests open the table menu on their phones and choose lunch. The kitchen sees the food ticket, the bar sees the drinks, and guests can check how their order is coming along.",
    label: "Dine in · Table 08", lines: [["Kitchen", "2 plates of steamed momo"], ["Bar", "1 iced hibiscus tea"]],
    close: "When lunch wraps up, the cashier can print the bill for the table.",
  },
  {
    venue: "Bar", time: "19:30", title: "Dinner and drinks share a table.",
    body: "A group orders drinks and a plate to share. The bartender can start pouring while the kitchen prepares the food. Each station sees just the items it needs to make.",
    label: "Dine in · Table 12", lines: [["Bar", "2 ginger spritzes"], ["Kitchen", "1 sharing plate"]],
    close: "At the end of service, the manager can check which drinks sold and when the bar was busiest.",
  },
] as const;

function VenueExamples() {
  const [active, setActive] = useState(0);
  const service = SERVICES[active];
  return (
    <section id="zt-venues" className="zt-wrap zt-band" aria-labelledby="zt-venues-title">
      <Reveal>
        <p className="zt-label">01 / Service examples</p>
        <h2 className="zt-heading" id="zt-venues-title">What does a shift look like<br />at your place?</h2>
        <p className="zt-deck">Pick a venue to follow a sample order from the floor to the team preparing it.</p>
      </Reveal>
      <div className="zt-picker" role="group" aria-label="Choose a venue">
        {SERVICES.map(({ venue }, i) => (
          <button key={venue} type="button" aria-pressed={active === i} aria-controls="zt-service-example"
            onClick={() => setActive(i)}>{venue}</button>
        ))}
      </div>
      <div id="zt-service-example" className="zt-service" aria-live="polite">
        <div key={service.venue} className="zt-service-copy">
          <p className="zt-label">{service.venue} / {service.time}</p>
          <h3>{service.title}</h3><p>{service.body}</p><p>{service.close}</p>
        </div>
        <div className="zt-ticket">
          <p className="zt-ticket-label">Sample station ticket</p><h4>{service.label}</h4>
          <dl>{service.lines.map(([station, item]) => (
            <div key={station}><dt>{station}</dt><dd>{item}</dd></div>
          ))}</dl>
        </div>
      </div>
    </section>
  );
}

const REWARDS = [
  { name: "Bring a friend", title: "Buy 1 flat white, get one free", use: "Give a regular a reason to bring someone along for coffee." },
  { name: "Birthday treat", title: "A pastry for your birthday", use: "Offer members a small treat they can show the cashier when they visit." },
  { name: "Member perk", title: "10% off a member’s lunch", use: "Give members a lunch offer they can keep in their wallet for their next visit." },
] as const;

function RewardExamples() {
  const [active, setActive] = useState(0);
  const reward = REWARDS[active];
  return (
    <div className="zt-reward-demo">
      <p className="zt-label">Sample offers</p>
      <div className="zt-picker" role="group" aria-label="Choose a sample offer">
        {REWARDS.map(({ name }, i) => <button key={name} type="button" aria-pressed={active === i}
          aria-controls="zt-voucher-example" onClick={() => setActive(i)}>{name}</button>)}
      </div>
      <div id="zt-voucher-example" aria-live="polite">
        <Voucher large title={reward.title} sample />
        <p className="zt-demo-note">{reward.use}</p>
      </div>
    </div>
  );
}

const LAUNCH_STEPS = [
  { title: "Check the menu", body: "Photograph your printed menu. Review the items Zentro reads, then check prices, sizes, and toppings against the menu your guests see." },
  { title: "Run a test order", body: "Scan a table code and order one drink and one dish. Ask the bar and kitchen to check their tickets, then follow the order from received to ready." },
  { title: "Try the return visit", body: "Choose a reward your team can explain in one sentence. Open the voucher in a guest wallet and walk the cashier through redeeming it once." },
] as const;

const MERCHANT_FAQ = [
  ["Do guests need an account to order?", "Guests can scan the table QR code and open the menu in their browser without signing in. They can join the loyalty program if they want to earn points and keep rewards."],
  ["What happens if the internet drops during a shift?", "The counter POS can keep billing offline and sync when the connection returns. For an offline shift, plan around counter billing. Live guest order updates depend on connectivity."],
  ["Can one table send items to both the kitchen and bar?", "Yes. Zentro splits an order into kitchen and bar tickets. A toastie goes to the kitchen and a flat white goes to the bar, even when the guest orders both together."],
  ["How does a cashier redeem a reward?", "The guest opens their voucher and presents its QR code or one-time code. Staff confirm redemption at the counter. The same voucher cannot be redeemed twice."],
  ["What can I review after closing?", "Store reports show sales, best sellers, and busy hours. Check which items moved during the rush and use that information when planning the next shift."],
] as const;

function LaunchGuide() {
  return (
    <section id="zt-launch" className="zt-wrap zt-band" aria-labelledby="zt-launch-title">
      <Reveal><p className="zt-label">05 / Opening checklist</p>
        <h2 className="zt-heading" id="zt-launch-title">Before your first service</h2>
        <p className="zt-deck">Use a quiet moment before opening to walk your team through one order and one reward.</p>
      </Reveal>
      <ol className="zt-launch-steps">{LAUNCH_STEPS.map(({ title, body }, i) => (
        <li key={title}><Reveal delay={i * 70}><span className="zt-step-number">0{i + 1}</span>
          <h3>{title}</h3><p>{body}</p></Reveal></li>
      ))}</ol>
    </section>
  );
}

function MerchantQuestions() {
  return (
    <section id="zt-faq" className="zt-faq" aria-labelledby="zt-faq-title">
      <div className="zt-wrap zt-faq-layout">
        <Reveal><p className="zt-label">06 / Merchant FAQ</p>
          <h2 className="zt-heading" id="zt-faq-title">Questions from<br />the counter</h2>
        </Reveal>
        <div>{MERCHANT_FAQ.map(([question, answer]) => (
          <details key={question}><summary>{question}<ChevronRight size={17} aria-hidden /></summary>
            <p>{answer}</p></details>
        ))}</div>
      </div>
    </section>
  );
}


export function PublicLandingScreen() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      el.style.setProperty("--drift", `${Math.min(20, Math.max(0, y * .035))}px`);
      el.style.setProperty("--page", String(max > 0 ? Math.min(1, Math.max(0, y / max)) : 0));
      setScrolled(y > 12);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  const rise = (i: number): CSSProperties => ({ animationDelay: `${120 + i * 110}ms` });
  return (
    <div ref={rootRef} className="zt-site flex min-h-dvh flex-col">
      <style>{`
        @keyframes zt-rise { from { transform: translateY(110%); } to { transform: translateY(0); } }
        @keyframes zt-fade { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
        @keyframes zt-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        @keyframes zt-scan { 0%,100% { transform: translateY(-80px); } 50% { transform: translateY(80px); } }
        @keyframes zt-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
        @keyframes zt-ring { from { transform: scale(.8); opacity: .9; } to { transform: scale(1.7); opacity: 0; } }
        @keyframes zt-wave { 0%,100% { transform: scaleY(.18); } 50% { transform: scaleY(1); } }
        @keyframes zt-beam { 0% { transform: translateY(-100%); } 100% { transform: translateY(460%); } }
        @keyframes zt-pop { from { opacity: 0; transform: translateY(10px) scale(.96); } to { opacity: 1; transform: none; } }
        @keyframes zt-drift-a { 0% { transform: translate(0,0) scale(1); } 50% { transform: translate(120px,60px) scale(1.15); } 100% { transform: translate(40px,140px) scale(.95); } }
        @keyframes zt-drift-b { 0% { transform: translate(0,0) scale(1.1); } 50% { transform: translate(-140px,90px) scale(.9); } 100% { transform: translate(-60px,-50px) scale(1.2); } }
        @keyframes zt-drift-c { 0% { transform: translate(0,0) scale(1); } 50% { transform: translate(-90px,-80px) scale(1.2); } 100% { transform: translate(110px,-30px) scale(1); } }
        @keyframes zt-grid-pan { from { background-position: 0 0; } to { background-position: 44px 44px; } }
        .zt-line { display: block; overflow: hidden; padding-bottom: .08em; }
        .zt-line > span { display: block; animation: zt-rise 1s ${EASE} both; }
        .zt-fade { animation: zt-fade .9s ${EASE} both; }
        .zt-marquee { animation: zt-marquee 45s linear infinite; }
        .zt-scan { animation: zt-scan 2.6s ease-in-out infinite; }
        .zt-float { animation: zt-float 6s ease-in-out infinite; }
        .zt-ring { animation: zt-ring 2s ease-out infinite; }
        .zt-wave { animation: zt-wave 1.1s ease-in-out infinite; transform-origin: center; }
        .zt-beam { animation: zt-beam 2.4s ease-in-out infinite; }
        .zt-pop { animation: zt-pop .6s ${EASE} both; }
        @media (prefers-reduced-motion: reduce) {
          .zt-line > span, .zt-fade, .zt-marquee, .zt-scan, .zt-float, .zt-ring, .zt-wave, .zt-beam, .zt-pop { animation: none !important; }
        }

        .zt-site { --zt-paper:#fff9f3; --zt-ink:#202239; --zt-muted:#615a65; --zt-ember:#a03b15; --zt-apricot:#ffbb91; --zt-rule:#e2d6d0; color:var(--zt-ink); background:var(--zt-paper); font-family:ui-sans-serif,system-ui,sans-serif; }
        .zt-site :is(a,button):focus-visible { outline:3px solid #b5441d; outline-offset:4px; }
        .zt-wrap { width:min(92%,1240px); margin-inline:auto; }
        .zt-header { position:sticky; top:0; z-index:40; background:var(--zt-paper); border-bottom:1px solid var(--zt-rule); transition:box-shadow .24s; }
        .zt-header[data-scrolled="true"] { box-shadow:0 5px 22px #20223910; }
        .zt-nav,.zt-actions,.zt-nav-links,.zt-button,.zt-note { display:flex; align-items:center; }
        .zt-nav { min-height:70px; justify-content:space-between; gap:12px; }
        .zt-actions { flex-wrap:wrap; gap:12px; }
        .zt-nav-links { gap:24px; }
        .zt-nav-links,.zt-login { font-size:.85rem; font-weight:600; }
        .zt-nav a:hover,.zt-index a:hover { color:var(--zt-ember); }
        .zt-button { justify-content:center; gap:10px; min-height:46px; padding:0 20px; border-radius:12px; font-weight:650; font-size:.875rem; transition:background .2s,transform .2s; }
        .zt-primary,.zt-nav a.zt-primary { background:var(--zt-ember); color:white; }
        .zt-primary:hover,.zt-nav a.zt-primary:hover { background:#7d2b11; color:white; }
        .zt-secondary { border:1px solid #c7b9b4; }
        .zt-secondary:hover { background:#f9ebe2; }
        .zt-nav-button { min-height:39px; }
        .zt-progress { background:#e66a32; }
        .zt-hero { display:grid; grid-template-columns:.9fr 1.1fr; gap:clamp(30px,4vw,70px); align-items:center; padding-block:clamp(46px,5.8vw,88px); }

        /* Animated hero backdrop */
        .zt-hero-shell { position:relative; isolation:isolate; overflow:hidden; }
        .zt-backdrop { position:absolute; inset:0; z-index:-1; pointer-events:none; }
        .zt-blob { position:absolute; border-radius:50%; filter:blur(80px); will-change:transform; }
        .zt-blob-a { width:min(560px,70vw); height:min(560px,70vw); left:-8%; top:-25%; background:radial-gradient(circle,#ffbb91 0%,#ffbb9100 70%); opacity:.85; animation:zt-drift-a 18s ease-in-out infinite alternate; }
        .zt-blob-b { width:min(520px,65vw); height:min(520px,65vw); right:-6%; top:5%; background:radial-gradient(circle,#ff8a50 0%,#ff8a5000 70%); opacity:.45; animation:zt-drift-b 22s ease-in-out infinite alternate; }
        .zt-blob-c { width:min(540px,70vw); height:min(540px,70vw); left:35%; bottom:-40%; background:radial-gradient(circle,#c5a4dc 0%,#c5a4dc00 70%); opacity:.5; animation:zt-drift-c 26s ease-in-out infinite alternate; }
        .zt-backdrop-grid { position:absolute; inset:0;
          background-image:linear-gradient(#20223912 1px,transparent 1px),linear-gradient(90deg,#20223912 1px,transparent 1px);
          background-size:44px 44px; animation:zt-grid-pan 14s linear infinite;
          -webkit-mask-image:radial-gradient(ellipse 70% 80% at 50% 40%,#000 20%,transparent 75%);
          mask-image:radial-gradient(ellipse 70% 80% at 50% 40%,#000 20%,transparent 75%); }
        .zt-spot { position:absolute; inset:0; background:radial-gradient(circle 340px at var(--mx,72%) var(--my,28%),#ff783830,transparent 70%); transition:background .15s linear; }
        .zt-backdrop-fade { position:absolute; inset:auto 0 0 0; height:140px; background:linear-gradient(to bottom,transparent,var(--zt-paper)); }
        @media (max-width:600px) { .zt-blob { filter:blur(60px); } .zt-backdrop-grid { background-size:32px 32px; } }

        .zt-label,.zt-stage-head,.zt-stage-foot,.zt-chapter-no,.zt-caption,.zt-index a { font:600 .69rem/1.5 ui-monospace,SFMono-Regular,Consolas,monospace; letter-spacing:.11em; }
        .zt-label { color:var(--zt-ember); text-transform:uppercase; display:flex; align-items:center; gap:10px; margin-bottom:20px; }
        .zt-label i,.zt-stage-head i { background:#ff7838; width:8px; height:8px; border-radius:50%; display:inline-block; }
        .zt-intro h1 { font-size:clamp(3.6rem,6.1vw,6.1rem); line-height:.99; letter-spacing:-.065em; font-weight:630; }
        .zt-line { padding:0 0 .09em; margin-bottom:-.05em; }
        .zt-serif { font:italic 1em/1 Georgia,"Times New Roman",serif; letter-spacing:-.06em; color:var(--zt-ember); padding-right:.14em; }
        .zt-deck { color:var(--zt-muted); line-height:1.65; font-size:clamp(1rem,1.15vw,1.125rem); max-width:44ch; margin:24px 0; }
        .zt-note { margin-top:22px; gap:9px; font-size:.78rem; color:var(--zt-muted); }
        .zt-stage { position:relative; isolation:isolate; border-radius:26px; overflow:hidden; min-height:450px; aspect-ratio:1.16; display:flex; flex-direction:column; justify-content:space-between; color:#fff8f1; background:radial-gradient(ellipse at 72% 60%,#96523f 0%,#493648 48%,#202239 90%); }
        .zt-stage::before { content:""; position:absolute; inset:0; z-index:-1; background-image:linear-gradient(#ffd2b80f 1px,transparent 1px),linear-gradient(90deg,#ffd2b80f 1px,transparent 1px); background-size:32px 32px; }
        .zt-stage-head,.zt-stage-foot { display:flex; justify-content:space-between; align-items:center; padding:18px 22px; color:#fbe1d2; font-size:.625rem; }
        .zt-stage-head span:first-child { display:flex; gap:8px; align-items:center; }
        .zt-stage-foot { border-top:1px solid #ffd1bc2e; }
        .zt-stage-art { position:relative; flex:1; width:100%; container-type:inline-size; overflow:hidden; }
        .zt-scene { position:absolute; width:740px; height:470px; left:50%; top:50%; margin:-235px 0 0 -370px; transform:scale(.67); }
        @container (min-width:560px) { .zt-scene {transform:scale(.74);} }
        @container (min-width:630px) { .zt-scene {transform:scale(.82);} }
        @container (max-width:490px) { .zt-scene {transform:scale(.54);} }
        @container (max-width:415px) { .zt-scene {transform:scale(.46);} }
        @container (max-width:345px) { .zt-scene {transform:scale(.39);} }
        .zt-hero-pos { position:absolute; left:10px; top:52px; transform:translateY(calc(-1 * var(--drift,0px))) rotate(-3deg); }
        .zt-hero-phone { position:absolute; left:508px; top:16px; transform-origin:top left; transform:translateY(var(--drift,0px)) rotate(5deg) scale(.79); }
        .zt-order-slip { position:absolute; left:105px; bottom:4px; display:flex; align-items:center; gap:14px; background:#ffe4d2; color:#53291e; padding:14px 22px; border-radius:12px; box-shadow:0 10px 30px #18192733; }
        .zt-order-slip b,.zt-order-slip small {display:block;}
        .zt-index { border-block:1px solid var(--zt-rule); }
        .zt-index > div { display:flex; align-items:center; flex-wrap:wrap; gap:12px clamp(20px,4vw,56px); padding-block:17px; }
        .zt-index span { margin-right:auto; font:italic 1.1rem Georgia,serif; }
        .zt-index a { color:var(--zt-muted); letter-spacing:.035em; }
        .zt-index b {font:600 .85rem system-ui,sans-serif; color:var(--zt-ink); margin-left:6px;}
        .zt-heading { font-size:clamp(2.35rem,4.4vw,4rem); font-weight:610; letter-spacing:-.055em; line-height:1.05; text-wrap:balance; }
        .zt-section-intro { max-width:800px; }
        .zt-section-intro > p:last-child,.zt-offers .text-muted-foreground { color:var(--zt-muted); }
        .zt-tile { border-radius:22px; border:1px solid var(--zt-rule); transition:box-shadow .24s,border-color .24s; }
        .zt-tile-light { background:#fffefa; color:var(--zt-ink); }
        .zt-tile-light .text-muted-foreground,.zt-site footer .text-muted-foreground { color:var(--zt-muted); }
        .zt-tile-dark { background:#24263c; color:#fff; border-color:#414159; }
        .zt-tile.zt-voice { background:#643c42; }
        .zt-tile .text-ember { color:#a03b15; }
        .zt-tile-dark .text-ember { color:var(--zt-apricot); }
        .zt-site .bg-ember { background-color:#ab4019; }
        .zt-site [class~="bg-ink/80"] { background-color:#53516a; }
        .zt-site [class~="bg-ember/10"],.zt-site .bg-mist { background-color:#ffebde; }
        .zt-site [class~="bg-ember/20"] { background-color:#ffbb9120; }
        .zt-journey { background:#1d1e32; color:#fff7f0; padding-block:clamp(54px,7vw,100px); }
        .zt-journey .zt-label,.zt-chapter-no,.zt-caption { color:var(--zt-apricot); }
        #zt-journey-title,#zt-offers { scroll-margin-top:88px; }
        .zt-chapters { display:grid; grid-template-columns:1fr 1fr; gap:8%; margin-top:48px; align-items:start; }
        .zt-chapter-list { list-style:none; padding:0; }
        .zt-chapter-list li { display:flex; flex-direction:column; align-items:start; justify-content:center; gap:14px; min-height:51vh; padding:32px 0; border-top:1px solid #d4c7da42; }
        .zt-chapter-list li > svg { color:#ffb58e; }
        .zt-chapter-list h3 { font-size:clamp(1.45rem,2.8vw,2.5rem); font-weight:600; letter-spacing:-.045em; line-height:1.12; }
        .zt-chapter-list p { max-width:40ch; line-height:1.65; color:#d8d3e2; }
        .zt-story-device { position:sticky; top:max(78px,calc(50vh - 270px)); min-height:540px; display:grid; place-items:center; isolation:isolate; }
        .zt-device-halo { position:absolute; inset:0; z-index:-1; background:radial-gradient(ellipse,#b86a4d66,transparent 70%); }
        .zt-screen-layer { position:absolute; inset:0; opacity:0; transform:translateY(12px); transition:opacity .38s,transform .45s; pointer-events:none; }
        .zt-screen-layer[data-current="true"] {opacity:1;transform:none;}
        .zt-caption { display:flex; gap:32px; margin-top:12px; }
        .zt-small-screen { display:none; }
        .zt-offers { background:#f9ebe2; }
        .zt-offers .bg-ink { background:var(--zt-ink); color:white; }
        .zt-signup { background:radial-gradient(ellipse at 80% 0,#874d40,transparent 60%),#24263c; }
        .zt-signup a.bg-white { color:var(--zt-ink); }
        .zt-site footer {background:var(--zt-paper);color:var(--zt-ink);}
        @keyframes zt-arrive { from {opacity:0;transform:translateY(var(--lift,18px));} to {opacity:1;transform:none;} }
        @media (prefers-reduced-motion:no-preference) {
          .zt-reveal[data-seen="true"] { animation:zt-arrive .58s cubic-bezier(.2,.7,.2,1) var(--delay,0ms) backwards; }
          .zt-stage-head i { animation:zt-ring 1.6s ease-out 2; }
        }
        @media (hover:hover) {
          .zt-tile:hover { border-color:#c48266; box-shadow:0 10px 32px #20223910; }
          .zt-button:hover { transform:translateY(-2px); }
        }
        @media (max-width:940px) {
          .zt-nav-links { display:none; }
          .zt-hero { grid-template-columns:1fr; gap:32px; }
          .zt-intro { max-width:650px; }
          .zt-stage { min-height:0; height:clamp(295px,66vw,465px); aspect-ratio:auto; }
        }
        @media (max-width:799px),(max-height:619px) {
          .zt-chapters { display:block; }
          .zt-story-device { display:none; }
          .zt-chapter-list { display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr)); }
          .zt-chapter-list li { min-height:0; justify-content:flex-start; padding:22px; border:1px solid #d4c7da42; border-radius:18px; background:#2c2c43; }
          .zt-small-screen { display:flex; align-self:center; justify-content:center; width:170px; height:328px; margin:12px 0 0; }
          .zt-small-screen > div { transform:scale(.60); transform-origin:top center; }
        }
        @media (max-width:600px) {
          .zt-nav {min-height:60px;}
          .zt-nav .zt-actions {gap:9px;}
          .zt-nav-button {font-size:.75rem;padding:0 11px;}
          .zt-intro h1 {font-size:clamp(3.15rem,12vw,4.5rem);}
          .zt-index > div {gap:8px 20px;}
          .zt-index > div > span {width:100%;}
          .zt-index a {font-size:.6rem;}
          .zt-index b {font-size:.72rem;}
          .zt-stage-head,.zt-stage-foot {padding:13px 16px;font-size:.57rem;}
          .zt-hero {padding-block:36px;}
        }
        .zt-band {padding-block:clamp(50px,7vw,92px);}
        #zt-venues,#zt-launch,#zt-faq {scroll-margin-top:80px;}
        .zt-picker {display:flex; gap:6px; flex-wrap:wrap; margin:0 0 18px;}
        .zt-picker button {background:#fffefa; border:1px solid var(--zt-rule); padding:9px 15px; min-height:42px; border-radius:99px; font-size:.84rem; font-weight:600; color:var(--zt-ink); cursor:pointer; transition:background .18s,color .18s;}
        .zt-picker button:hover {background:#f9e7d9;}
        .zt-picker button[aria-pressed="true"] {background:var(--zt-ink); color:white; border-color:var(--zt-ink);}
        .zt-service {background:#f9efe8; border:1px solid var(--zt-rule); border-radius:22px; display:grid; grid-template-columns:1.25fr 1fr; align-items:center; gap:clamp(22px,5vw,70px); padding:clamp(22px,4vw,54px);}
        .zt-service-copy {max-width:58ch;animation:zt-fade .3s ease-out both;}
        .zt-service-copy h3,.zt-launch-steps h3 {font-size:clamp(1.35rem,2.4vw,2.1rem); letter-spacing:-.035em; line-height:1.15; font-weight:650;}
        .zt-service-copy > p:not(.zt-label),.zt-launch-steps p,.zt-demo-note,.zt-faq details p {color:var(--zt-muted); line-height:1.65; margin-top:13px;}
        .zt-ticket {background:#fffefa; border:1px solid var(--zt-rule); border-top:5px solid #c35128; padding:clamp(20px,3vw,36px); border-radius:6px; box-shadow:0 8px 24px #2022390e;}
        .zt-ticket-label,.zt-step-number {font:600 .73rem/1.5 ui-monospace,monospace; color:var(--zt-ember); text-transform:uppercase; letter-spacing:.09em;}
        .zt-ticket h4 {font:1.45rem Georgia,serif; margin:8px 0 18px;}
        .zt-ticket dl > div {border-top:1px dashed #d1c2b9; display:flex; justify-content:space-between; gap:16px; padding-top:12px; margin-top:12px; font-size:.88rem;}
        .zt-ticket dt {color:var(--zt-muted);}
        .zt-ticket dd {text-align:right;}
        .zt-reward-demo {width:100%; max-width:29rem; margin:auto;}
        .zt-reward-demo .zt-picker button {font-size:.78rem; padding-inline:12px;}
        .zt-reward-demo .zt-demo-note {min-height:3.3em;}
        .zt-launch-steps {list-style:none; display:grid; grid-template-columns:repeat(3,1fr); gap:clamp(20px,4vw,52px); margin-top:34px; padding:0;}
        .zt-launch-steps li {border-top:1px solid #bba7a1; padding-top:16px;}
        .zt-step-number {display:block;margin-bottom:22px;}
        .zt-faq {background:#f5f1f5; padding-block:clamp(48px,6vw,84px);}
        .zt-faq-layout {display:grid; grid-template-columns:1fr 1.35fr; gap:clamp(24px,6vw,80px);}
        .zt-faq details {border-top:1px solid #d5cbd2;}
        .zt-faq details:last-child {border-bottom:1px solid #d5cbd2;}
        .zt-faq summary {display:flex; justify-content:space-between; gap:16px; align-items:center; padding:20px 0; font-weight:650; cursor:pointer; list-style:none;}
        .zt-faq summary::-webkit-details-marker {display:none;}
        .zt-faq summary:focus-visible {outline:2px solid var(--zt-ember);outline-offset:3px;}
        .zt-faq summary svg {flex:none;transition:transform .2s;}
        .zt-faq details[open] summary svg {transform:rotate(90deg);}
        .zt-faq details p {margin:0 0 20px;max-width:60ch;}
        .zt-index > div {column-gap:clamp(12px,2vw,30px);}
        @media (max-width:740px) {
          .zt-service,.zt-faq-layout,.zt-launch-steps {grid-template-columns:1fr;}
          .zt-launch-steps {gap:22px;}
          .zt-step-number {margin-bottom:10px;}
        }
        @media (prefers-reduced-motion:reduce) {
          .zt-site *, .zt-site *::before,.zt-site *::after { animation:none!important; transition:none!important; scroll-behavior:auto!important; }
          .zt-site { --drift:0px!important; }
          .zt-button:hover {transform:none;}
        }
      `}</style>

      <div aria-hidden className="zt-progress fixed inset-x-0 top-0 z-50 h-0.5 origin-left" style={{ transform: "scaleX(var(--page, 0))" }} />

      {/* Navigation */}
      <header className="zt-header" data-scrolled={scrolled}>
        <div className="zt-wrap zt-nav">
          <Link to="/" aria-label="Zentro home"><ZentroLogo className="h-7 w-auto" title="Zentro" /></Link>
          <nav className="zt-nav-links" aria-label="Main navigation">
            <a href="#features">Features</a><Link to="/stores">Explore cafés</Link>
            <Link to="/offers">Deals &amp; offers</Link><Link to="/auth/merchant">For merchants</Link>
          </nav>
          <div className="zt-actions"><Link className="zt-login" to="/auth/login" search={{ redirect: undefined }}>Sign in</Link>
            <Link className="zt-button zt-primary zt-nav-button" to="/auth/merchant/signup" search={{ redirect: undefined }}>Launch your store</Link></div>
        </div>
      </header>

      <main className="flex-1">
        {/* ------------------- Hero banner: for merchants ------------------- */}
        <HeroShell>
          <section className="zt-hero zt-wrap">
            <div className="zt-intro">
              <p className="zt-label zt-fade" style={rise(0)}><i /> Hospitality software</p>
              <h1><span className="zt-line"><span style={rise(1)}>Run your</span></span>
                <span className="zt-line"><span style={rise(2)}>whole café</span></span>
                <span className="zt-line"><span className="zt-serif" style={rise(3)}>from one app.</span></span></h1>
              <p className="zt-deck zt-fade" style={rise(4)}>Take orders, print kitchen tickets, and reward returning guests. One workspace for your floor, kitchen, and counter.</p>
              <div className="zt-actions zt-fade" style={rise(5)}>
                <Link className="zt-button zt-primary" to="/auth/merchant/signup" search={{ redirect: undefined }}>Launch your store free <ArrowRight size={16} /></Link>
                <Link className="zt-button zt-secondary" to="/auth/merchant/login" search={{ redirect: undefined }}>Merchant sign in</Link>
              </div>
              <p className="zt-note zt-fade" style={rise(6)}><WifiOff size={15} /> Offline POS <span>·</span> No guest app required</p>
            </div>
            <div className="zt-stage zt-fade" style={rise(3)}>
              <div className="zt-stage-head"><span><i /> SERVICE PREVIEW</span><span>FIG. 01</span></div>
              <div className="zt-stage-art" aria-hidden="true">
                <div className="zt-scene">
                  <div className="zt-hero-pos"><PosTerminal /></div>
                  <div className="zt-hero-phone"><Phone><HomeCardScreen /></Phone></div>
                  <div className="zt-order-slip"><Printer size={18} /><div><b>Bar ticket printed</b><small>Table 12 · Two drinks</small></div></div>
                </div>
              </div>
              <div className="zt-stage-foot"><span>01 / COUNTER</span><span>02 / GUEST WALLET</span></div>
            </div>
          </section>
        </HeroShell>
        <div className="zt-index"><div className="zt-wrap"><span>Inside Zentro</span>
          <a href="#zt-venues">01 <b>Venues</b></a>
          <a href="#features">02 <b>Tools</b></a>
          <a href="#zt-journey-title">03 <b>Guest experience</b></a>
          <a href="#zt-offers">04 <b>Rewards</b></a>
          <a href="#zt-launch">05 <b>Setup</b></a>
          <a href="#zt-faq">06 <b>FAQ</b></a>
        </div></div>
        <VenueExamples />

        {/* ----------------------------- Features --------------------------- */}
        <section id="features" className="scroll-mt-20 px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto max-w-6xl">
            <Reveal className="zt-section-intro"><p className="zt-label">02 / Merchant tools</p>
              <h2 className="zt-heading">Everything your floor, kitchen and bar need</h2>
              <p className="mt-4 text-muted-foreground">One app replaces the billing software, order pads, stock sheets and loyalty cards.</p>
            </Reveal>

            <div className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-6">
              <Reveal className="md:col-span-4"><AiScannerTile /></Reveal>
              <Reveal delay={100} className="md:col-span-2"><VoiceTile /></Reveal>
              <Reveal className="md:col-span-3"><KotTile /></Reveal>
              <Reveal delay={100} className="md:col-span-3"><AnalyticsTile /></Reveal>
              {SMALL.map(({ icon: Icon, t, d }, i) => (
                <Reveal key={t} delay={(i % 3) * 90} className="md:col-span-2">
                  <TileShell className="!p-6">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-mist text-ember"><Icon className="h-5 w-5" /></span>
                    <h3 className="mt-4 font-display text-lg font-bold">{t}</h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
                  </TileShell>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------- Diner journey (pinned) ------------------- */}
        <ScrollStory />

        {/* ------------------------------ Offers ---------------------------- */}
        <section id="zt-offers" className="zt-offers px-4 py-20 sm:px-6 sm:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 md:grid-cols-2">
            <Reveal>
              <p className="zt-label">04 / Loyalty &amp; offers</p>
              <h2 className="zt-heading">Offers your guests will actually use</h2>
              <p className="mt-4 max-w-md text-muted-foreground">
                Create a voucher in a few taps. Guests keep it in their wallet, show a QR at the counter, and your staff confirm it once.
              </p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {["Buy one, get one free", "Percentage and amount discounts", "Birthday and member-only treats", "One-time codes that cannot be reused"].map((t) => (
                  <li key={t} className="flex items-center gap-2.5"><CheckCircle2 className="h-4 w-4 text-[#a03b15]" />{t}</li>
                ))}
              </ul>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to="/offers" className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-sm font-semibold text-white shadow-soft transition-transform active:scale-95">
                  <Gift className="h-4 w-4" /> Browse special offers
                </Link>
                <Link to="/stores" className="inline-flex h-12 items-center gap-2 rounded-full border border-[#e2d6d0] bg-[#fffefa] px-6 text-sm font-semibold text-[#202239] transition-colors hover:bg-[#f9ebe2]">
                  <Compass className="h-4 w-4 text-ember" /> Explore cafés
                </Link>
              </div>
            </Reveal>
            <Reveal delay={150} y={50}>
              <RewardExamples />
            </Reveal>
          </div>
        </section>

        <LaunchGuide />
        <MerchantQuestions />

        {/* ------------------------------ Final CTA ------------------------- */}
        <section className="px-4 py-20 sm:px-6 sm:py-28">
          <Reveal>
            <div className="relative mx-auto max-w-5xl overflow-hidden rounded-[2.5rem] zt-signup px-6 py-16 text-center text-white sm:px-12 sm:py-20">
              <Sparkles aria-hidden className="absolute -left-6 -top-6 h-40 w-40 text-white/10" />
              <Coffee aria-hidden className="absolute -bottom-8 -right-4 h-48 w-48 text-white/10" />
              <h2 className="relative font-display text-3xl font-extrabold tracking-tight sm:text-5xl">Ready to run your place on Zentro?</h2>
              <p className="relative mx-auto mt-4 max-w-md text-white/90">Set up your store, scan your menu, and take your first order today.</p>
              <div className="relative mt-8 flex flex-wrap items-center justify-center gap-3">
                <Link to="/auth/merchant/signup" search={{ redirect: undefined }} className="inline-flex h-12 items-center gap-2 rounded-full bg-white px-7 text-sm font-semibold text-[#202239] transition-transform active:scale-95">
                  Launch your store free <ArrowRight className="h-4 w-4" />
                </Link>
                <Link to="/auth/signup" search={{ redirect: undefined }} className="inline-flex h-12 items-center rounded-full border border-white/50 px-7 text-sm font-semibold text-white transition-colors hover:bg-white/10">
                  I'm a diner: join free
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>

      <footer className="border-t border-[#e2d6d0]/40 bg-background px-4 py-10 sm:px-6">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-2">
            <ZentroLogo className="h-6 w-auto text-[#202239]" title="Zentro" />
            <span className="text-xs text-muted-foreground">© {new Date().getFullYear()} Zentro Globe. All rights reserved.</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-6 text-xs text-muted-foreground">
            <Link to="/stores" className="transition-colors hover:text-[#202239]">Discover Cafés</Link>
            <Link to="/offers" className="transition-colors hover:text-[#202239]">Special Offers</Link>
            <Link to="/auth/signup" search={{ redirect: undefined }} className="transition-colors hover:text-[#202239]">Customer Sign Up</Link>
            <Link to="/auth/merchant/signup" search={{ redirect: undefined }} className="transition-colors hover:text-[#202239]">Merchant Partner</Link>
            <Link to="/offline" className="transition-colors hover:text-[#202239]">Offline Status</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

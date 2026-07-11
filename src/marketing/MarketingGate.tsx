import { useState } from "react";
import { X, Smartphone, ArrowRight } from "lucide-react";
// Self-hosted Archivo (the design's typeface). These live in this web-only lazy
// chunk, so the font never ships in the native APK, and they're served from our
// own origin — no Google Fonts request, so nothing to add to the CSP.
import "@fontsource/archivo/500.css";
import "@fontsource/archivo/600.css";
import "@fontsource/archivo/700.css";
import "@fontsource/archivo/800.css";
import "@fontsource/archivo/900.css";
import LoginScreen from "../LoginScreen";
import { BottomNav } from "../components/BottomNav";
import { PRIVACY_URL, DISCLAIMER_URL, PLAY_STORE_BETA_URL } from "../constants";
// Brand + hero headline are shared with the OG-image generator (scripts/og-image)
// via this single source of truth, so the social card can't drift from the page.
import copy from "./copy.json";
// Real app screenshots, imported so Vite bundles them into this web-only chunk
// (dropped from the APK along with the rest of the marketing code).
import homeShot from "./assets/01-home.png";
import planShot from "./assets/02-plan.png";
import coachShot from "./assets/03-coach-chat.png";
import racesShot from "./assets/05b-races-find-a-race.png";
import badgesShot from "./assets/08-progress-badges.png";

// Web-only marketing landing shown at the root path to signed-out visitors.
// The native (Capacitor) shell never renders this — it goes straight to
// LoginScreen — and the build-time VITE_NATIVE_BUILD flag drops this whole
// chunk from the APK (see App.tsx). Every CTA opens the existing LoginScreen in
// a full-screen modal, so all auth flows stay in one place.

const FONT_STACK = "'Archivo', ui-sans-serif, system-ui, sans-serif";

function Logo({ width = 38, height = 23 }: { width?: number; height?: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 220 120" fill="none" aria-hidden="true">
      <polyline
        points="10,80 60,80 78,44 96,96 114,60 132,80 160,80 200,28"
        stroke="#F97316"
        strokeWidth="16"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="200" cy="28" r="12" fill="#F97316" />
    </svg>
  );
}

// A phone frame showing a real app screenshot, with the *real* BottomNav
// overlaid at the base (rendered decoratively). The screenshot is cropped above
// its own nav so the live nav component is the only one shown — always the
// current design, no hand-drawn copy to keep in sync.
function PhoneMock({ src, alt, active }: { src: string; alt: string; active: string }) {
  return (
    <div className="w-[288px] sm:w-[330px]">
      <div className="rounded-[36px] border-[10px] border-[#1B2740] bg-[#0B1220] overflow-hidden shadow-[0_40px_80px_rgba(0,0,0,0.55)]">
        <div className="relative h-[520px] sm:h-[560px]">
          <img src={src} alt={alt} className="absolute top-0 left-0 w-full" />
          <div className="absolute bottom-0 inset-x-0 pointer-events-none" aria-hidden="true">
            <BottomNav active={active} />
          </div>
        </div>
      </div>
    </div>
  );
}

const STATS = [
  { value: "5K → Marathon", label: "plans built to your race date" },
  { value: "Adapts to you", label: "the plan flexes when life happens" },
  { value: "Web + Android", label: "your plan on every device" },
];

export default function MarketingGate() {
  const [showLogin, setShowLogin] = useState(false);
  const login = () => setShowLogin(true);

  return (
    <div className="min-h-screen bg-[#0B1220] text-[#F1F5F9]" style={{ fontFamily: FONT_STACK }}>
      <div className="max-w-[1200px] mx-auto px-5 sm:px-8">
        {/* Header */}
        <header className="flex items-center justify-between py-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span className="font-extrabold text-[20px] tracking-[-0.3px]">{copy.brand}</span>
          </div>
          <nav className="flex items-center gap-4 sm:gap-7 text-[15px] font-semibold">
            <a href="#features" className="hidden md:inline text-[#8B98AC] hover:text-[#FDBA74] transition-colors">
              Features
            </a>
            <a href="#races" className="hidden md:inline text-[#8B98AC] hover:text-[#FDBA74] transition-colors">
              Races
            </a>
            <button type="button" onClick={login} className="text-[#8B98AC] hover:text-[#F1F5F9] transition-colors">
              Log in
            </button>
            <button
              type="button"
              onClick={login}
              className="bg-[#F97316] text-[#0B1220] px-5 py-2.5 rounded-full font-bold hover:bg-[#FDBA74] transition-colors"
            >
              Get started
            </button>
          </nav>
        </header>

        {/* Hero */}
        <section className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-10 lg:gap-12 items-center pt-4 pb-16 lg:pb-20">
          <div className="flex flex-col gap-5">
            <span className="text-[#F97316] font-bold text-[13px] tracking-[2px] uppercase">
              Train for the race, not just the run
            </span>
            <h1 className="text-4xl sm:text-5xl lg:text-[52px] font-black leading-[1.08] tracking-[-1.5px]">
              {copy.heroLine1}
              <br />
              <span className="text-[#F97316]">{copy.heroLine2}</span>
            </h1>
            <p className="text-[17px] sm:text-[19px] leading-relaxed text-[#B7C2D2] max-w-[52ch]">
              Pick your race, set your goal time, and get a week-by-week training plan that adapts when life
              happens — with a coach you can talk to whenever it doesn't go to plan.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 sm:items-center mt-2">
              <button
                type="button"
                onClick={login}
                className="bg-[#F97316] text-[#0B1220] px-8 py-4 rounded-full font-extrabold text-[17px] hover:bg-[#FDBA74] transition-colors"
              >
                Get started — it's free
              </button>
              <button
                type="button"
                onClick={login}
                className="border border-[#2A3A55] text-[#F1F5F9] px-6 py-[15px] rounded-full font-bold text-[15px] hover:border-[#3B4E6B] hover:bg-[#0F1826] transition-colors"
              >
                I already have an account
              </button>
            </div>
            {/* Secondary CTA: private Android closed-beta opt-in. */}
            <a
              href={PLAY_STORE_BETA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#8B98AC] hover:text-[#FDBA74] transition-colors"
            >
              <Smartphone size={16} />
              Also on Android — join the closed beta
              <ArrowRight size={15} />
            </a>
            <div className="flex flex-wrap gap-x-9 gap-y-4 mt-3">
              {STATS.map((s) => (
                <div key={s.value} className="flex flex-col gap-0.5">
                  <span className="font-extrabold text-[22px] sm:text-[24px] text-[#F97316]">{s.value}</span>
                  <span className="text-[#8B98AC] text-[14px]">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="flex justify-center lg:justify-end">
            <PhoneMock src={homeShot} alt="Running Coach home screen" active="dash" />
          </div>
        </section>

        {/* Features */}
        <section id="features" className="flex flex-col gap-12 sm:gap-14 pb-20 sm:pb-24">
          <div className="flex flex-col gap-3 max-w-[60ch]">
            <h2 className="text-3xl sm:text-[38px] font-black tracking-[-1px]">
              Everything between today and the start line.
            </h2>
            <p className="text-[#B7C2D2] text-[17px] leading-relaxed">
              Not another feed of other people's runs — a plan, a coach, and the tools to follow through.
            </p>
          </div>

          {/* Three primary feature cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              img={planShot}
              imgAlt="Training plan"
              title="A real training plan"
              body="Base, build, peak, taper — structured around your race date, goal time, and the days you can actually train."
            />
            <FeatureCard
              img={coachShot}
              imgAlt="Coach chat"
              title="An AI coach that adapts"
              body="Missed a week? Knee acting up? Chat with a coach that adjusts your plan safely — it edits the schedule, it never hands you a risky one."
            />
            {/* Third card uses a purpose-built live-tracking mock instead of a screenshot. */}
            <div className="bg-[#0F1826] border border-[#1E2A3D] rounded-[20px] overflow-hidden flex flex-col gap-5 pb-6">
              <LiveTrackerMock />
              <div className="px-6 flex flex-col gap-2">
                <h3 className="text-[20px] font-extrabold">Track every run</h3>
                <p className="text-[#8B98AC] text-[15px] leading-relaxed">
                  Live GPS with pace, distance, and elevation on a map. Pair heart rate on Android and every
                  run is classified into training zones — so you know if you went too hard.
                </p>
              </div>
            </div>
          </div>

          {/* Two wide cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <WideCard
              id="races"
              img={racesShot}
              imgAlt="Race catalogue"
              title="Find your race"
              body="A community race catalogue — from the Berlin Marathon to the Great North Run. Pick one, and your countdown and plan lock onto it. Don't see yours? Add it for everyone."
            />
            <WideCard
              img={badgesShot}
              imgAlt="Progress badges"
              title="Watch it add up"
              body="History, stats, and trends in one place, with gentle badges as your training weeks add up — from your first 5K to the 1000 km club."
            />
          </div>
        </section>

        {/* Closing CTA band */}
        <section className="bg-gradient-to-b from-[#F97316] to-[#EA580C] rounded-[24px] px-6 py-14 sm:px-16 sm:py-16 flex flex-col items-center gap-5 text-center mb-20 sm:mb-24">
          <h2 className="text-[#0B1220] text-3xl sm:text-[40px] font-black tracking-[-1px]">
            Ready to run your best race?
          </h2>
          <p className="text-[#3B2107] text-[16px] sm:text-[18px] font-semibold max-w-[46ch]">
            Create a free account and get your training plan in minutes. Android app in closed beta.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4 mt-2">
            <button
              type="button"
              onClick={login}
              className="bg-[#0B1220] text-[#F1F5F9] px-8 py-4 rounded-full font-extrabold text-[17px] hover:bg-[#131c2b] transition-colors"
            >
              Get started — it's free
            </button>
            <a
              href={PLAY_STORE_BETA_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-[15px] font-bold text-[#3B2107] hover:text-[#0B1220] transition-colors"
            >
              <Smartphone size={16} />
              Join the Android beta
              <ArrowRight size={15} />
            </a>
          </div>
        </section>

        {/* Footer */}
        <footer className="flex flex-col sm:flex-row items-center justify-between gap-4 pb-10 text-[14px] text-[#8B98AC]">
          <div className="flex items-center gap-2.5">
            <Logo width={26} height={16} />
            <span className="font-bold text-[#B7C2D2]">{copy.brand}</span>
          </div>
          <div className="flex gap-6">
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#FDBA74] transition-colors">
              Privacy policy
            </a>
            <a href={DISCLAIMER_URL} target="_blank" rel="noopener noreferrer" className="hover:text-[#FDBA74] transition-colors">
              Safety note
            </a>
          </div>
        </footer>
      </div>

      {/* Login modal — reuses the full LoginScreen over a backdrop. */}
      {showLogin && (
        <div className="fixed inset-0 z-50">
          <div className="relative min-h-screen">
            <button
              type="button"
              onClick={() => setShowLogin(false)}
              aria-label="Close sign in"
              className="absolute top-4 right-4 z-10 p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
            >
              <X size={22} />
            </button>
            <LoginScreen />
          </div>
        </div>
      )}
    </div>
  );
}

function FeatureCard({ img, imgAlt, title, body }: { img: string; imgAlt: string; title: string; body: string }) {
  return (
    <div className="bg-[#0F1826] border border-[#1E2A3D] rounded-[20px] overflow-hidden flex flex-col gap-5 pb-6">
      <div className="h-[280px] sm:h-[300px] overflow-hidden border-b border-[#1E2A3D]">
        <img src={img} alt={imgAlt} className="w-full" />
      </div>
      <div className="px-6 flex flex-col gap-2">
        <h3 className="text-[20px] font-extrabold">{title}</h3>
        <p className="text-[#8B98AC] text-[15px] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

function WideCard({
  id,
  img,
  imgAlt,
  title,
  body,
}: {
  id?: string;
  img: string;
  imgAlt: string;
  title: string;
  body: string;
}) {
  return (
    <div id={id} className="bg-[#0F1826] border border-[#1E2A3D] rounded-[20px] p-6 sm:p-8 flex gap-6 sm:gap-7 items-center">
      <div className="w-[120px] sm:w-[150px] h-[230px] sm:h-[280px] flex-shrink-0 rounded-[16px] overflow-hidden border border-[#1E2A3D]">
        <img src={img} alt={imgAlt} className="w-full" />
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="text-[20px] font-extrabold">{title}</h3>
        <p className="text-[#8B98AC] text-[15px] leading-relaxed">{body}</p>
      </div>
    </div>
  );
}

// Purpose-built "live tracking" illustration for the third feature card — stat
// tiles plus a stylised route with a LIVE badge. Intentionally not a screenshot.
function LiveTrackerMock() {
  const tiles = [
    { v: "3.42", l: "KM", c: "#F1F5F9" },
    { v: "21:08", l: "TIME", c: "#F1F5F9" },
    { v: "6:11", l: "PACE", c: "#F1F5F9" },
    { v: "148", l: "BPM · Z2", c: "#F87171" },
  ];
  return (
    <div className="h-[280px] sm:h-[300px] overflow-hidden border-b border-[#1E2A3D] bg-[#0B1220]">
      <div className="grid grid-cols-4 gap-2 px-4 pt-4 pb-3">
        {tiles.map((t) => (
          <div key={t.l} className="bg-[#131C2B] rounded-[12px] py-2.5 flex flex-col items-center gap-0.5">
            <span className="font-extrabold text-[17px]" style={{ color: t.c }}>
              {t.v}
            </span>
            <span className="text-[#8B98AC] text-[9px] font-bold tracking-[1px]">{t.l}</span>
          </div>
        ))}
      </div>
      <div className="relative mx-4 h-[200px] rounded-[14px] overflow-hidden bg-[#10192A]">
        <svg width="100%" height="100%" viewBox="0 0 360 200" fill="none" preserveAspectRatio="xMidYMid slice">
          <line x1="60" y1="0" x2="60" y2="200" stroke="#1B2740" strokeWidth="6" />
          <line x1="150" y1="0" x2="150" y2="200" stroke="#1B2740" strokeWidth="4" />
          <line x1="260" y1="0" x2="260" y2="200" stroke="#1B2740" strokeWidth="6" />
          <line x1="0" y1="50" x2="360" y2="50" stroke="#1B2740" strokeWidth="4" />
          <line x1="0" y1="130" x2="360" y2="130" stroke="#1B2740" strokeWidth="6" />
          <rect x="290" y="60" width="70" height="55" rx="4" fill="#14243A" opacity="0.6" />
          <rect x="10" y="145" width="120" height="55" rx="4" fill="#12301F" opacity="0.35" />
          <polyline
            points="40,170 60,130 110,130 150,90 210,90 260,50 300,50 322,78"
            stroke="#F97316"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="40" cy="170" r="6" fill="#34D399" />
        </svg>
        <div
          className="absolute w-3.5 h-3.5 rounded-full bg-[#F97316] border-[3px] border-[#FDBA74]"
          style={{ left: `${(322 / 360) * 100}%`, top: 78, margin: "-7px 0 0 -7px", boxShadow: "0 0 0 6px rgba(249,115,22,0.25)" }}
        />
        <div className="absolute right-2.5 bottom-2.5 bg-[rgba(11,18,32,0.85)] border border-[#2A3A55] text-[#B7C2D2] text-[10px] font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-[#F97316]" />
          LIVE
        </div>
      </div>
    </div>
  );
}

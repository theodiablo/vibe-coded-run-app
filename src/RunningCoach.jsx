import { useState, useEffect, useRef } from "react";
import { Activity, Calendar, TrendingUp, MessageSquare, Plus, Check, Download, Upload, Loader, ChevronRight, Award, Zap, RotateCcw, Heart, Key, LogOut, Settings, History, Trash2, Pencil } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, CartesianGrid, ReferenceLine } from "recharts";
import { db } from "./db";

// ── utils ──────────────────────────────────────────────────────────
const p2 = n => String(n).padStart(2, "0");
const fmt = {
  pace: s => (!s || s <= 0) ? "--:--" : Math.floor(s/60) + ":" + p2(Math.round(s%60)),
  dur: s => {
    if (!s) return "--";
    const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sc = Math.round(s%60);
    return h ? (h + ":" + p2(m) + ":" + p2(sc)) : (m + ":" + p2(sc));
  },
  date: s => s ? new Date(s+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"}) : "",
  sht:  s => s ? new Date(s+"T12:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short"}) : "",
};

// Local YYYY-MM-DD. Using toISOString() here would convert to UTC and shift the
// calendar day for anyone east of GMT (e.g. a Monday at local midnight becomes
// the Sunday before), so we read the date parts in local time instead.
const ymd = d => d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate());
// Estimated session duration (rounded minutes) for the prescribed distance/pace.
const estMin = (km, pace) => (km && pace) ? Math.round(km * pace / 60) + " min" : "";

// ── race prediction maths ──────────────────────────────────────────
// Peter Riegel's endurance race-time formula: project a known time t1 over
// distance d1 to a target distance d2. The 1.06 exponent is the standard
// "fatigue factor" — going further costs slightly more than linear time.
const riegel = (t1, d1, d2, k = 1.06) => t1 * Math.pow(d2 / d1, k);

// Grade-adjusted (flat-equivalent) distance. A hilly run is slower than its flat
// twin at the same effort, so we credit the climb by treating each metre ascended
// as ~VERT_COST extra metres of flat running. We only log total gain (no descent
// or profile), so this is an average-cost approximation — but it stops hilly runs
// from looking unfit, which sharpens both the best-effort pick and the HR fit.
// At ~+10% grade this counts a km as ~1.8 flat km, in line with GAP rules of thumb.
const VERT_COST = 8;
const flatEqKm = r => r.km + (r.elevation > 0 ? VERT_COST * r.elevation / 1000 : 0);

// Pick the runner's strongest logged effort. We don't just take the lowest raw
// pace — a fast 1 km blip shouldn't outrank a strong 12 km run — so each
// qualifying run (≥3 km, with a duration) is normalised to its Riegel-equivalent
// 10 km time and the best (smallest) one wins. Distances are flat-equivalent so a
// strong hilly run can win. Returns {km, durationSec, raw} or null (km is flat-eq).
const bestEffortAnchor = runs => runs
  .filter(r => r.km >= 3 && r.durationSec)
  .reduce((best, r) => {
    const eqKm = flatEqKm(r);
    const eq = riegel(r.durationSec, eqKm, 10);
    return (!best || eq < best.eq) ? {km: eqKm, durationSec: r.durationSec, eq, raw: r} : best;
  }, null);

// Least-squares linear fit y = a + b·x, plus R² so callers can judge the fit.
const linReg = pts => {
  const n = pts.length;
  if (n < 2) return null;
  const mx = pts.reduce((s, p) => s + p.x, 0) / n;
  const my = pts.reduce((s, p) => s + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  pts.forEach(p => { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; });
  if (sxx === 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  const r2 = syy === 0 ? 0 : (sxy * sxy) / (sxx * syy);
  return {a, b, r2};
};

// Heart-rate model. Across all runs that recorded an avg HR, fit pace (sec/km)
// against HR — easy low-HR runs anchor the slow end, hard high-HR runs the fast
// end — then extrapolate the pace the runner could hold at their threshold HR
// (top of Z4). Threshold effort is roughly a 1-hour race, so we anchor it as
// {km covered in 3600 s, 3600 s} for Riegel to project from. A fast pace held at
// a low HR therefore pulls the predicted threshold pace faster ("handled well"),
// and vice-versa. Returns the anchor plus fit stats so the caller can gate it.
const hrModelAnchor = (runs, effMax, restHR, method) => {
  if (!effMax) return null;
  // y is grade-adjusted pace: a hilly run's slow pace at high HR becomes a fast
  // flat-equivalent pace at high HR, consistent with the rest of the data.
  const pts = runs
    .filter(r => r.km >= 2 && r.durationSec && r.hr)
    .map(r => ({x: r.hr, y: r.durationSec / flatEqKm(r)}));
  const fit = linReg(pts);
  if (!fit) return null;
  const hrs = pts.map(p => p.x);
  const spread = Math.max(...hrs) - Math.min(...hrs);
  const thr = hrZoneBpm(0.88, 0.90, effMax, restHR, method);
  if (!thr) return null;
  const thrPace = fit.a + fit.b * thr.lo;
  if (thrPace <= 0) return null;
  return {km: 3600 / thrPace, durationSec: 3600, r2: fit.r2, slope: fit.b, n: pts.length, spread, thrHR: thr.lo, thrPace};
};

// Strip any stale "· N min" slot label baked into older stored descriptions —
// the real estimate is shown alongside km/pace instead.
const cleanDesc = d => (d || "").replace(/\s*·\s*~?\d+\s*min\s*$/, "");

// ── storage ────────────────────────────────────────────────────────
// `db` is the cloud-backed per-user store (see src/db.js). Same async
// get/set interface as before; the Anthropic API key stays local-only.

// ── constants ──────────────────────────────────────────────────────
// AI Coach chat + Claude API key are temporarily disabled — flip this back
// on to restore the "Coach" tab and the header's API key control.
const AI_FEATURES_ENABLED = false;
const DAYS = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
const TCLR = {EASY:"text-emerald-400",TEMPO:"text-yellow-400",INTERVALS:"text-orange-400",LONG:"text-sky-400",RACE:"text-red-400",WALK:"text-cyan-400",OTHER:"text-violet-400"};
const TBG  = {EASY:"border-emerald-500/30 bg-emerald-500/5",TEMPO:"border-yellow-500/30 bg-yellow-500/5",INTERVALS:"border-orange-500/30 bg-orange-500/5",LONG:"border-sky-500/30 bg-sky-500/5",RACE:"border-red-500/30 bg-red-500/5",WALK:"border-cyan-500/30 bg-cyan-500/5",OTHER:"border-violet-500/30 bg-violet-500/5"};
const HR_ZONES = [
  {n:1,name:"Recovery",     lo:0.50,hi:0.60,clr:"#60a5fa",type:"Aerobic",   desc:"Very easy — active recovery, warm-up/cool-down"},
  {n:2,name:"Aerobic Base", lo:0.60,hi:0.70,clr:"#34d399",type:"Aerobic",   desc:"Easy runs, fat burning, building endurance base"},
  {n:3,name:"Aerobic Tempo",lo:0.70,hi:0.80,clr:"#facc15",type:"Aerobic",   desc:"Moderate effort — marathon and long-run pace"},
  {n:4,name:"Threshold",    lo:0.80,hi:0.90,clr:"#fb923c",type:"Anaerobic", desc:"Comfortably hard — lactate threshold, tempo runs"},
  {n:5,name:"VO2 Max",      lo:0.90,hi:1.00,clr:"#f87171",type:"Anaerobic", desc:"Maximum effort — short intervals, race pace"},
];

// ── HR zone bpm calc ───────────────────────────────────────────────
// Shared by the HR Zones settings screen and the per-session targets on
// the plan, so a zone's bpm range is computed identically everywhere.
function hrZoneBpm(loPct, hiPct, maxHR, restHR, method) {
  if (!maxHR) return null;
  if (method === "pct") {
    return {lo: Math.round(maxHR * loPct), hi: Math.round(maxHR * hiPct)};
  }
  const hrr = maxHR - restHR;
  if (hrr <= 0) return null;
  return {lo: Math.round(hrr * loPct + restHR), hi: Math.round(hrr * hiPct + restHR)};
}

// ── session HR targets ─────────────────────────────────────────────
// Each session type maps onto one (or a span of) HR_ZONES — the bpm
// range shown is derived from those zones' percentages via hrZoneBpm,
// using the same MaxHR/RestHR/method as the HR Zones settings screen.
const SESSION_ZONES = {
  EASY:      {zones:[2],   label:"Z2 · Aerobic Base",        clr:"#34d399"},
  LONG:      {zones:[2],   label:"Z2 · Aerobic Base",        clr:"#34d399"},
  TEMPO:     {zones:[3,4], label:"Z3-4 · Lactate Threshold", clr:"#fb923c"},
  INTERVALS: {zones:[4,5], label:"Z4-5 · Max effort (reps)", clr:"#f87171"},
  RACE:      {zones:[3,4], label:"Z3-4 · Race effort",       clr:"#fb923c"},
  WALK:      {zones:[1],   label:"Z1 · Recovery",            clr:"#60a5fa"},
};
function sessionHR(type, settings) {
  const cfg    = SESSION_ZONES[type] || SESSION_ZONES.EASY;
  const loZone = HR_ZONES[cfg.zones[0] - 1];
  const hiZone = HR_ZONES[cfg.zones[cfg.zones.length - 1] - 1];
  const r = hrZoneBpm(loZone.lo, hiZone.hi, settings.maxHR || 0, settings.restHR || 60, settings.hrMethod || "karvonen");
  if (!r) return null;
  return {lo:r.lo, hi:r.hi, label:cfg.label, clr:cfg.clr};
}
function HRTarget({type, settings, openSettings}) {
  if (!settings.maxHR) {
    return (
      <button type="button" onClick={openSettings}
        className="text-xs mt-1 flex items-center gap-1.5 text-amber-300 hover:text-amber-200 transition-colors">
        <Heart size={12}/>Add your HR profile in Settings to see a target zone
      </button>
    );
  }
  const hr = sessionHR(type, settings);
  if (!hr) return null;
  return (
    <p className="text-xs mt-1 flex items-center gap-1.5 flex-wrap">
      <span className="font-semibold" style={{color:hr.clr}}>{"❤️ " + hr.lo + "–" + hr.hi + " bpm"}</span>
      <span className="text-slate-600">{"· " + hr.label}</span>
    </p>
  );
}

// ── plan builder ───────────────────────────────────────────────────
function buildPlan(raceDate, goalSec, planSessions, distanceKm) {
  if (!goalSec) goalSec = 7200;
  if (!distanceKm) distanceKm = 20;
  if (!planSessions) planSessions = [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}];
  const today = new Date(); today.setHours(0,0,0,0);
  const race  = new Date(raceDate + "T00:00:00");
  const dow   = today.getDay();
  const toMon = dow === 1 ? 0 : dow === 0 ? 1 : (8 - dow) % 7;
  const w0    = new Date(today); w0.setDate(today.getDate() + toMon);
  const N     = Math.max(4, Math.min(24, Math.floor((race - w0) / 86400000 / 7)));
  const tgt   = Math.round(goalSec / distanceKm);
  const easy  = Math.round(tgt * 1.25);
  const tmpo  = Math.round(tgt * 1.05);
  const sorted = planSessions.slice().sort((a, b) => b.minutes - a.minutes);
  const longSess = sorted[0];
  const qualSessions = sorted.slice(1);
  const weeks = [];

  for (let w = 0; w < N; w++) {
    const wS = new Date(w0); wS.setDate(w0.getDate() + w * 7);
    const isTaper = w >= N - 3;
    const isPeak  = w >= N - 7 && !isTaper;
    const isBase  = w < 4;
    const phase   = isTaper ? "TAPER" : isPeak ? "PEAK" : isBase ? "BASE" : "BUILD";
    const ss = [];

    const addS = (dOff, type, km, desc, pace) => {
      const d = new Date(wS); d.setDate(wS.getDate() + dOff);
      if (d >= race) return;
      ss.push({
        id: "w" + (w+1) + "d" + dOff,
        date: ymd(d),
        type, desc,
        km: Math.round(Math.max(1.5, km) * 10) / 10,
        pace, done: false, runId: null,
      });
    };

    const maxLong = longSess.minutes * 60 / easy;
    let longKm;
    if (isTaper) {
      const taperIdx = w - (N - 3);
      const taperMults = [0.85, 0.65, 0.45];
      longKm = maxLong * (taperMults[taperIdx] !== undefined ? taperMults[taperIdx] : 0.45);
    } else if (isPeak) {
      longKm = Math.min(maxLong * 0.95, 9 + (w - (N - 7)) * 0.4);
    } else if (isBase) {
      longKm = Math.min(maxLong * 0.75, 4.5 + w * 0.5);
    } else {
      longKm = Math.min(maxLong * 0.9, 6.5 + (w - 4) * 0.3);
    }
    addS(longSess.dayOffset, "LONG", longKm,
      "Long run — easy effort at " + fmt.pace(easy) + "/km", easy);

    qualSessions.forEach(q => {
      const maxQ = q.minutes * 60 / easy;
      let type, desc, pace, km;
      if (isBase || isTaper) {
        const easyKm = isBase ? 2.5 + w * 0.2 : Math.max(2, 4 - (w - (N - 3)) * 0.5);
        type = "EASY"; pace = easy;
        km   = Math.min(maxQ, easyKm);
        desc = "Easy run — relaxed aerobic effort";
      } else {
        const buildW = w - 4;
        if (buildW % 2 === 0) {
          type = "TEMPO"; pace = tmpo;
          km   = Math.min(maxQ * 0.85, q.minutes * 60 / tmpo * 0.8);
          desc = "Tempo run — " + fmt.pace(tmpo) + "/km, comfortably hard";
        } else {
          const reps = q.minutes <= 30 ? 3 : 5;
          type = "INTERVALS"; pace = tgt;
          km   = Math.min(maxQ * 0.85, reps * 0.8 + 1.5);
          desc = "Intervals — " + reps + "x800m at " + fmt.pace(tgt) + "/km + 90s recovery";
        }
      }
      addS(q.dayOffset, type, km, desc, pace);
    });

    ss.sort((a, b) => a.date.localeCompare(b.date));
    weeks.push({weekNumber: w+1, startDate: ymd(wS), phase, sessions: ss});
  }

  const rWS = new Date(w0); rWS.setDate(w0.getDate() + N * 7);
  weeks.push({
    weekNumber: N + 1,
    startDate: ymd(rWS),
    phase: "RACE",
    sessions: [{
      id: "race", date: raceDate, type: "RACE",
      desc: "Race Day — " + distanceKm + "km! Everything you trained for.",
      km: distanceKm, pace: tgt, done: false, runId: null,
    }],
  });
  return {raceDate, goalSec, distanceKm, targetPace: tgt, planSessions, weeks};
}

// ── session configurator ───────────────────────────────────────────
function SessionConfigurator({sessions, onChange}) {
  const toggle = dOff => {
    const has = sessions.find(s => s.dayOffset === dOff);
    if (has) {
      if (sessions.length <= 1) return;
      onChange(sessions.filter(s => s.dayOffset !== dOff));
    } else {
      onChange(sessions.concat({dayOffset: dOff, minutes: 45}).sort((a, b) => a.dayOffset - b.dayOffset));
    }
  };
  const setMins = (dOff, m) => onChange(sessions.map(s => s.dayOffset === dOff ? Object.assign({}, s, {minutes: m}) : s));

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-7 gap-1">
        {DAYS.map((d, i) => {
          const sel = sessions.find(s => s.dayOffset === i);
          return (
            <button key={i} onClick={() => toggle(i)}
              className={"py-2 rounded-lg text-xs font-semibold transition-colors " + (sel ? "bg-orange-500 text-white" : "bg-slate-700 text-slate-400 hover:text-white hover:bg-slate-600")}>
              {d}
            </button>
          );
        })}
      </div>
      <div className="space-y-2">
        {sessions.slice().sort((a, b) => a.dayOffset - b.dayOffset).map(s => (
          <div key={s.dayOffset} className="flex items-center gap-3 bg-slate-700/60 rounded-xl px-3 py-2.5">
            <span className="text-sm font-bold text-orange-300 w-8 flex-shrink-0">{DAYS[s.dayOffset]}</span>
            <div className="flex flex-1 gap-1">
              {[20, 30, 45, 60, 75, 90].map(m => (
                <button key={m} onClick={() => setMins(s.dayOffset, m)}
                  className={"flex-1 py-1 rounded-md text-xs transition-colors " + (s.minutes === m ? "bg-orange-500 text-white" : "bg-slate-600 text-slate-400 hover:text-white")}>
                  {m < 60 ? m + "m" : (m / 60) + "h"}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500 text-center">The longest session automatically becomes your long run.</p>
    </div>
  );
}

// ── Toast ──────────────────────────────────────────────────────────
// Presentational only; the auto-dismiss timer lives in the parent so this
// stays a pure component.
function Toast({msg, type}) {
  return (
    <div className="fixed left-4 right-4 max-w-md mx-auto z-50" style={{top:52}}>
      <div className={"py-2.5 px-4 rounded-xl text-sm font-medium text-center shadow-lg text-white " + (type === "err" ? "bg-red-500" : "bg-emerald-500")}>
        {msg}
      </div>
    </div>
  );
}

// ── BackupModal ────────────────────────────────────────────────────
function BackupModal({data, onClose}) {
  const [copied, setCopied] = useState(false);
  const taRef = useRef();
  const json  = JSON.stringify(data, null, 2);

  const tryDownload = () => {
    const url   = URL.createObjectURL(new Blob([json], {type:"application/json"}));
    const fname = "running-coach-" + ymd(new Date()) + ".json";
    const a     = Object.assign(document.createElement("a"), {href: url, download: fname});
    document.body.appendChild(a); a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
  };

  const copyJSON = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(json).then(done).catch(() => {
        if (taRef.current) { taRef.current.select(); document.execCommand("copy"); done(); }
      });
    } else {
      if (taRef.current) { taRef.current.select(); document.execCommand("copy"); done(); }
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700">
          <div>
            <p className="font-semibold text-sm">Backup Data</p>
            <p className="text-xs text-slate-400">{(data.runs ? data.runs.length : 0) + " run(s) · " + (data.plan ? "plan saved" : "no plan")}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-400">Copy or download — save it to Notes, email, etc. Use Restore to reload it after any update.</p>
          <textarea ref={taRef} readOnly value={json} rows={6}
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 font-mono resize-none focus:outline-none"
            onFocus={e => e.target.select()}/>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={tryDownload}
              className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
              <Download size={15}/>Download
            </button>
            <button onClick={copyJSON}
              className={"py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-colors text-white " + (copied ? "bg-emerald-500" : "bg-orange-500 hover:bg-orange-600")}>
              {copied ? "Copied!" : "Copy JSON"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── RestoreModal ───────────────────────────────────────────────────
function RestoreModal({onRestore, onClose}) {
  const [text, setText] = useState("");
  const [err,  setErr]  = useState("");
  const attempt = () => {
    try {
      const d = JSON.parse(text.trim());
      if (!d.runs && !d.plan) { setErr("Doesn't look like a valid backup."); return; }
      onRestore(d); onClose();
    } catch { setErr("Invalid JSON — make sure you copied the entire backup."); }
  };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700">
          <p className="font-semibold text-sm">Restore from Backup</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-400">Paste your backup JSON below.</p>
          <textarea value={text} onChange={e => { setText(e.target.value); setErr(""); }} rows={6}
            placeholder="Paste your backup JSON here..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-xs text-slate-300 font-mono resize-none focus:outline-none focus:border-orange-400"/>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <button onClick={attempt} disabled={!text.trim()}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
            Restore Data
          </button>
        </div>
      </div>
    </div>
  );
}

// ── SettingsModal ──────────────────────────────────────────────────
// Full-screen settings: editable profile name, heart-rate zones, and the
// less-frequently-used data actions (Backup / Restore) tucked away here so
// they don't clutter the header.
function SettingsModal({settings, saveSettings, runs, onBackup, onRestore, onClose, showToast}) {
  const [name,  setName]  = useState(settings.name || "");
  const [saved, setSaved] = useState(false);
  const saveName = () => {
    const n = name.trim();
    if (!n) return;
    saveSettings(Object.assign({}, settings, {name: n}));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (showToast) showToast("Name updated.");
  };
  const I = "w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500";

  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex flex-col">
      <header className="flex items-center justify-between px-4 border-b border-slate-800 shrink-0" style={{height:44}}>
        <span className="text-sm font-semibold">Settings</span>
        <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
      </header>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-lg mx-auto p-4 space-y-5">
          {/* Profile */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200">Profile</p>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Your name</label>
              <input type="text" maxLength={40} value={name} placeholder="Your name"
                onChange={e => setName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveName(); }} className={I}/>
            </div>
            <button onClick={saveName} disabled={!name.trim()}
              className={"w-full text-white py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-40 " + (saved ? "bg-emerald-500" : "bg-orange-500 hover:bg-orange-600")}>
              {saved ? <><Check size={16}/>Saved</> : "Save name"}
            </button>
          </div>

          {/* Heart rate */}
          <HRZones settings={settings} saveSettings={saveSettings} runs={runs} showToast={showToast}/>

          {/* Data */}
          <div className="bg-slate-800 rounded-2xl p-4 space-y-3">
            <p className="text-sm font-semibold text-slate-200">Data</p>
            <p className="text-xs text-slate-400">Save a copy of your runs &amp; plan, or reload from a previous backup.</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={onBackup}
                className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
                <Download size={15}/>Backup
              </button>
              <button onClick={onRestore}
                className="py-2.5 rounded-xl text-sm font-semibold bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center justify-center gap-2 transition-colors">
                <Upload size={15}/>Restore
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ApiKeyModal ────────────────────────────────────────────────────
function ApiKeyModal({apiKey, onSave, onClose}) {
  const [val, setVal] = useState(apiKey || "");
  const save = () => { onSave(val.trim()); onClose(); };
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700">
          <p className="font-semibold text-sm">Claude API Key</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-400">
            The Coach tab talks directly to Anthropic's API from your browser. Paste your own API key
            (created at <span className="text-slate-300">console.anthropic.com</span>) — it's stored only in this
            browser's local storage and never leaves your device except in requests to api.anthropic.com.
          </p>
          <input type="password" value={val} onChange={e => setVal(e.target.value)}
            placeholder="sk-ant-..."
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-slate-200 font-mono focus:outline-none focus:border-orange-400"/>
          <button onClick={save}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
            Save Key
          </button>
        </div>
      </div>
    </div>
  );
}

// ── NameSetupModal (first-run onboarding) ──────────────────────────
function NameSetupModal({onSave}) {
  const [val, setVal] = useState("");
  const save = () => { const n = val.trim(); if (n) onSave(n); };
  return (
    <div className="fixed inset-0 bg-slate-900 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl w-full max-w-sm border border-slate-700 overflow-hidden shadow-xl">
        <div className="px-5 pt-6 pb-4 text-center">
          <div className="w-12 h-12 rounded-full bg-orange-500/15 flex items-center justify-center mx-auto mb-3">
            <Activity size={22} className="text-orange-400"/>
          </div>
          <p className="font-bold text-lg">Welcome to Running Coach</p>
          <p className="text-sm text-slate-400 mt-1">What should we call you?</p>
        </div>
        <div className="px-5 pb-5 space-y-3">
          <input autoFocus type="text" value={val} maxLength={40}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") save(); }}
            placeholder="Your name"
            className="w-full bg-slate-900 border border-slate-700 rounded-xl p-3 text-sm text-white text-center focus:outline-none focus:border-orange-400 placeholder-slate-500"/>
          <button onClick={save} disabled={!val.trim()}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
            Let's go
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  ROOT
// ══════════════════════════════════════════════════════════════════
export default function RunningCoach({ onSignOut }) {
  const [loading,     setLoading]     = useState(true);
  const [tab,         setTab]         = useState("dash");
  const [runs,        setRuns]        = useState([]);
  const [plan,        setPlan]        = useState(null);
  const [settings,    setSettings]    = useState({
    raceDate:"2026-11-01", goalSec:7200, distanceKm:20, name:"",
    age:0, maxHR:0, restHR:60, hrMethod:"karvonen",
    planSessions:[{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}],
  });
  const [apiKey,      setApiKey]      = useState("");
  const [toast,       setToast]       = useState(null);
  const [showBackup,  setShowBackup]  = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [showApiKey,  setShowApiKey]  = useState(false);
  const [showSettings,setShowSettings]= useState(false);
  const [needsName,   setNeedsName]   = useState(false);

  useEffect(() => {
    (async () => {
      const r = await db.get("rc_runs");
      const p = await db.get("rc_plan");
      const s = await db.get("rc_settings");
      const k = await db.get("rc_api_key");
      if (r) setRuns(r);
      if (p) setPlan(p);
      if (s) setSettings(prev => Object.assign({}, prev, s));
      if (k) setApiKey(k);
      // First-time user: no saved settings, or saved settings without a name.
      if (!s || !s.name) setNeedsName(true);
      setLoading(false);
    })();
  }, []);

  const showToast    = (msg, type) => setToast({msg, type: type || "ok"});

  // Auto-dismiss the toast. setState here runs from a timer callback (not
  // synchronously in the effect body), and clears on unmount / re-show.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);
  const savePlan     = p => { setPlan(p); db.set("rc_plan", p); };
  const saveSettings = s => { setSettings(s); db.set("rc_settings", s); };
  const saveApiKey   = k => { setApiKey(k); db.set("rc_api_key", k); };

  const addRuns = rs => {
    setRuns(prev => {
      const next = rs.map((r, i) => Object.assign({}, r, {id: r.id || ("r" + Date.now() + i)}))
        .concat(prev)
        .sort((a, b) => b.date.localeCompare(a.date));
      db.set("rc_runs", next);
      return next;
    });
  };

  const toggleSess = (wNum, sId) => {
    setPlan(prev => {
      const p = Object.assign({}, prev, {
        weeks: prev.weeks.map(w => {
          if (w.weekNumber !== wNum) return w;
          return Object.assign({}, w, {
            sessions: w.sessions.map(s => s.id !== sId ? s : Object.assign({}, s, {done: !s.done})),
          });
        }),
      });
      db.set("rc_plan", p);
      return p;
    });
  };

  const deleteRun = id => {
    setRuns(prev => {
      const next = prev.filter(r => r.id !== id);
      db.set("rc_runs", next);
      return next;
    });
    showToast("Run deleted.");
  };

  const updateRun = (id, patch) => {
    setRuns(prev => {
      // The date may have changed, so re-sort to keep the list newest-first.
      const next = prev.map(r => r.id === id ? Object.assign({}, r, patch) : r)
        .sort((a, b) => b.date.localeCompare(a.date));
      db.set("rc_runs", next);
      return next;
    });
    showToast("Run updated.");
  };

  const exportData    = () => setShowBackup(true);
  const handleRestore = d => {
    if (d.runs)     { setRuns(d.runs);         db.set("rc_runs", d.runs); }
    if (d.plan)     { setPlan(d.plan);          db.set("rc_plan", d.plan); }
    if (d.settings) { setSettings(d.settings);  db.set("rc_settings", d.settings); }
    showToast("Restored — " + (d.runs ? d.runs.length : 0) + " run(s) imported.");
  };

  if (loading) return (
    <div className="h-screen bg-slate-900 flex items-center justify-center">
      <Loader className="text-orange-400 animate-spin" size={32}/>
    </div>
  );

  const shared = {runs, plan, settings, apiKey, addRuns, savePlan, saveSettings, toggleSess, buildPlan, exportData, deleteRun, updateRun, showToast, goTab: setTab, openApiKey: () => setShowApiKey(true), openSettings: () => setShowSettings(true)};
  const TABS   = [
    {id:"dash",    label:"Home",    Icon:Activity},
    {id:"plan",    label:"Plan",    Icon:Calendar},
    {id:"log",     label:"Log",     Icon:Plus},
    {id:"history", label:"History", Icon:History},
    {id:"stats",   label:"Stats",   Icon:TrendingUp},
    ...(AI_FEATURES_ENABLED ? [{id:"coach", label:"Coach", Icon:MessageSquare}] : []),
  ];

  return (
    <div className="bg-slate-900 text-white min-h-screen" style={{fontFamily:"system-ui,-apple-system,sans-serif"}}>
      {toast       && <Toast {...toast}/>}
      {needsName   && <NameSetupModal onSave={name => { saveSettings(Object.assign({}, settings, {name})); setNeedsName(false); }}/>}
      {showBackup  && <BackupModal  data={{runs, plan, settings}} onClose={() => setShowBackup(false)}/>}
      {showRestore && <RestoreModal onRestore={handleRestore}     onClose={() => setShowRestore(false)}/>}
      {showApiKey  && <ApiKeyModal  apiKey={apiKey} onSave={saveApiKey} onClose={() => setShowApiKey(false)}/>}
      {showSettings && <SettingsModal
        settings={settings} saveSettings={saveSettings} runs={runs} showToast={showToast}
        onBackup={()  => { setShowSettings(false); setShowBackup(true); }}
        onRestore={() => { setShowSettings(false); setShowRestore(true); }}
        onClose={()   => setShowSettings(false)}/>}

      <header className="fixed top-0 inset-x-0 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 z-20" style={{height:44}}>
        <div className="flex items-center gap-1.5">
          <Activity size={15} className="text-orange-400"/>
          <span className="text-sm font-semibold">Running Coach</span>
        </div>
        <div className="flex items-center gap-1.5">
          {AI_FEATURES_ENABLED && (
            <button onClick={() => setShowApiKey(true)}
              className={"flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors " + (apiKey ? "text-slate-400 hover:text-white border-slate-700 hover:border-slate-500 hover:bg-slate-800" : "text-amber-300 border-amber-500/40 hover:border-amber-400 hover:bg-slate-800")}>
              <Key size={13}/>{apiKey ? "API key" : "Set API key"}
            </button>
          )}
          <button onClick={() => setShowSettings(true)} aria-label="Settings"
            className="flex items-center justify-center text-slate-400 hover:text-white p-1.5 rounded-lg border border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-colors">
            <Settings size={15}/>
          </button>
          {onSignOut && (
            <button onClick={onSignOut}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white px-2.5 py-1.5 rounded-lg border border-slate-700 hover:border-slate-500 hover:bg-slate-800 transition-colors">
              <LogOut size={13}/>Sign out
            </button>
          )}
        </div>
      </header>

      <div style={{paddingTop:44, paddingBottom:64}}>
        {tab === "dash"  && <Dashboard  {...shared}/>}
        {tab === "plan"  && <PlanView   {...shared}/>}
        {tab === "log"   && <LogView    {...shared} onDone={() => setTab("dash")}/>}
        {tab === "history" && <HistoryView {...shared}/>}
        {tab === "stats" && <StatsView  {...shared}/>}
        {tab === "coach" && <CoachView  {...shared}/>}
      </div>

      <nav className="fixed bottom-0 inset-x-0 bg-slate-800 border-t border-slate-700 flex z-20" style={{height:64}}>
        {TABS.map(item => (
          <button key={item.id} onClick={() => setTab(item.id)}
            className={"flex-1 flex flex-col items-center justify-center gap-0.5 text-xs transition-colors " + (tab === item.id ? "text-orange-400" : "text-slate-500 hover:text-slate-300")}>
            <item.Icon size={20}/>{item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

// Colored accent bar per run type, shared by the dashboard and history list.
const runBarColor = type => {
  if (type === "LONG")      return "bg-sky-400";
  if (type === "TEMPO")     return "bg-yellow-400";
  if (type === "INTERVALS") return "bg-orange-400";
  if (type === "RACE")      return "bg-red-400";
  if (type === "WALK")      return "bg-cyan-400";
  return "bg-emerald-400";
};

// ══════════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════════
function Dashboard({runs, plan, settings, savePlan, buildPlan, goTab, openSettings}) {
  const today    = new Date(); today.setHours(0,0,0,0);
  const raceD    = new Date(settings.raceDate + "T00:00:00");
  const daysLeft = Math.max(0, Math.ceil((raceD - today) / 86400000));
  const nextSess = plan
    ? plan.weeks.flatMap(w => w.sessions)
        .filter(s => !s.done && new Date(s.date + "T00:00:00") >= today)
        .sort((a, b) => a.date.localeCompare(b.date))[0]
    : null;
  const wkMon = new Date(today); wkMon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const wkKm  = runs.filter(r => new Date(r.date + "T00:00:00") >= wkMon).reduce((s, r) => s + (r.km||0), 0);
  const totKm = runs.reduce((s, r) => s + (r.km||0), 0);

  const statCards = [
    {l:"This week",  v:wkKm.toFixed(1)+" km",  c:"text-orange-400",  I:Zap},
    {l:"Runs logged", v:String(runs.length),    c:"text-sky-400",     I:Activity},
    {l:"Total",       v:totKm.toFixed(0)+" km", c:"text-emerald-400", I:Award},
  ];

  return (
    <div className="p-4 space-y-5 max-w-lg mx-auto">
      <div className="pt-4">
        <p className="text-slate-400 text-sm">Good to see you,</p>
        <h1 className="text-2xl font-bold">{settings.name + " 🏃‍♂️"}</h1>
      </div>

      <div className="rounded-2xl p-5 border border-orange-500/30"
        style={{background:"linear-gradient(135deg,rgba(249,115,22,.13),rgba(220,38,38,.13))"}}>
        <div className="flex justify-between items-center">
          <div>
            <p className="text-orange-300 text-xs font-semibold uppercase tracking-widest mb-1">Race Day</p>
            <p className="font-semibold">{fmt.date(settings.raceDate)}</p>
            <p className="text-slate-400 text-sm mt-1">
              {(settings.distanceKm || 20) + "km · target sub " + fmt.dur(settings.goalSec) + " · " + fmt.pace(Math.round(settings.goalSec/(settings.distanceKm||20))) + "/km"}
            </p>
          </div>
          <div className="text-right">
            <p className="text-5xl font-black text-orange-400 leading-none">{daysLeft}</p>
            <p className="text-slate-400 text-xs mt-1">days to go</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {statCards.map(card => (
          <div key={card.l} className="bg-slate-800 rounded-xl p-3">
            <card.I size={15} className={card.c}/>
            <p className={"text-xl font-bold mt-1 leading-tight " + card.c}>{card.v}</p>
            <p className="text-slate-500 text-xs">{card.l}</p>
          </div>
        ))}
      </div>

      {nextSess ? (
        <div>
          <p className="text-slate-500 text-xs uppercase tracking-widest mb-2">Up next</p>
          <div className={"border rounded-xl p-4 " + (TBG[nextSess.type] || TBG.OTHER)}>
            <span className={"text-xs font-bold uppercase tracking-wide " + (TCLR[nextSess.type] || TCLR.OTHER)}>
              {nextSess.type}
            </span>
            <p className="text-white text-sm font-medium mt-1 leading-snug">{cleanDesc(nextSess.desc)}</p>
            <p className="text-slate-400 text-xs mt-2">
              {fmt.sht(nextSess.date) + " · " + nextSess.km + " km · ~" + estMin(nextSess.km, nextSess.pace) + " · " + fmt.pace(nextSess.pace) + "/km"}
            </p>
            <HRTarget type={nextSess.type} settings={settings} openSettings={openSettings}/>
          </div>
        </div>
      ) : !plan ? (
        <div className="bg-slate-800 rounded-xl p-5 text-center space-y-3">
          <p className="text-slate-400 text-sm">No training plan yet. Ready to get started?</p>
          <button
            onClick={() => savePlan(buildPlan(settings.raceDate, settings.goalSec, settings.planSessions, settings.distanceKm))}
            className="bg-orange-500 hover:bg-orange-600 text-white px-6 py-2.5 rounded-xl font-semibold text-sm transition-colors">
            Generate My Plan
          </button>
        </div>
      ) : (
        <div className="bg-slate-800 rounded-xl p-4 text-center text-slate-400 text-sm">All upcoming sessions done!</div>
      )}

      {runs.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-slate-500 text-xs uppercase tracking-widest">Recent runs</p>
            {runs.length > 3 && goTab && (
              <button onClick={() => goTab("history")}
                className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-0.5 transition-colors">
                View all<ChevronRight size={13}/>
              </button>
            )}
          </div>
          <div className="space-y-2">
            {runs.slice(0, 3).map(r => {
              const pace = r.km && r.durationSec ? r.durationSec / r.km : 0;
              return (
                <div key={r.id} className="bg-slate-800 rounded-xl p-3 flex items-center gap-3">
                  <div className={"w-1.5 h-10 rounded-full flex-shrink-0 " + runBarColor(r.type)}/>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium">{r.km + " km · " + fmt.dur(r.durationSec)}</p>
                    <p className="text-slate-400 text-xs">{fmt.sht(r.date) + " · " + fmt.pace(pace) + "/km" + (r.hr ? " · ❤️ " + r.hr : "") + (r.elevation ? " · ⛰️ " + r.elevation + "m" : "")}</p>
                  </div>
                  <span className={"text-xs font-semibold flex-shrink-0 " + (TCLR[r.type] || TCLR.OTHER)}>{r.type}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!runs.length && (
        <div className="bg-slate-800 rounded-xl p-6 text-center space-y-2">
          <Activity size={32} className="mx-auto text-slate-700"/>
          <p className="text-sm text-slate-400">No runs yet.</p>
          <p className="text-xs text-slate-600">Tap Log below to add your first one.</p>
          {!plan && (
            <p className="text-xs text-slate-600 pt-2 border-t border-slate-700/50">
              Had data from a previous version? Open Settings (gear, top right) → Restore.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  HISTORY VIEW — the full run log, newest first, grouped by month
// ══════════════════════════════════════════════════════════════════
function HistoryView({runs, deleteRun, updateRun, goTab}) {
  const [confirmId, setConfirmId] = useState(null);
  const [editRun,   setEditRun]   = useState(null);

  if (!runs.length) return (
    <div className="max-w-lg mx-auto flex flex-col items-center justify-center pt-24 text-center gap-3 p-4">
      <History size={48} className="text-slate-700"/>
      <p className="text-slate-400">No runs logged yet.</p>
      <button onClick={() => goTab && goTab("log")}
        className="bg-orange-500 hover:bg-orange-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors">
        Log your first run
      </button>
    </div>
  );

  // Runs arrive newest-first; bucket them into month sections in that order.
  const totKm  = runs.reduce((s, r) => s + (r.km || 0), 0);
  const groups = [];
  runs.forEach(r => {
    const key = new Date(r.date + "T12:00:00").toLocaleDateString("en-GB", {month:"long", year:"numeric"});
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) { g = {key, items:[]}; groups.push(g); }
    g.items.push(r);
  });

  return (
    <div className="max-w-lg mx-auto p-4">
      <div className="mt-4 mb-4">
        <h2 className="text-xl font-bold">History</h2>
        <p className="text-slate-500 text-xs mt-0.5">
          {runs.length + " run" + (runs.length === 1 ? "" : "s") + " · " + totKm.toFixed(0) + " km total"}
        </p>
      </div>

      <div className="space-y-5">
        {groups.map(g => (
          <div key={g.key}>
            <p className="text-slate-500 text-xs uppercase tracking-widest mb-2">{g.key}</p>
            <div className="space-y-2">
              {g.items.map(r => {
                const pace = r.km && r.durationSec ? r.durationSec / r.km : 0;
                return (
                  <div key={r.id} className="bg-slate-800 rounded-xl p-3 flex items-center gap-3">
                    <div className={"w-1.5 h-10 rounded-full flex-shrink-0 " + runBarColor(r.type)}/>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{r.km + " km · " + fmt.dur(r.durationSec)}</p>
                      <p className="text-slate-400 text-xs">
                        {fmt.date(r.date) + " · " + fmt.pace(pace) + "/km" + (r.hr ? " · ❤️ " + r.hr : "") + (r.elevation ? " · ⛰️ " + r.elevation + "m" : "")}
                      </p>
                      {r.notes && <p className="text-slate-600 text-xs mt-0.5 truncate">{r.notes}</p>}
                    </div>
                    <span className={"text-xs font-semibold flex-shrink-0 " + (TCLR[r.type] || TCLR.OTHER)}>{r.type}</span>
                    {confirmId === r.id ? (
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button onClick={() => { deleteRun(r.id); setConfirmId(null); }}
                          className="text-xs font-semibold text-red-400 hover:text-red-300 px-1.5 py-1">Delete</button>
                        <button onClick={() => setConfirmId(null)}
                          className="text-xs text-slate-500 hover:text-slate-300 px-1.5 py-1">Cancel</button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => setEditRun(r)} aria-label="Edit run"
                          className="text-slate-600 hover:text-orange-400 p-1 transition-colors">
                          <Pencil size={15}/>
                        </button>
                        <button onClick={() => setConfirmId(r.id)} aria-label="Delete run"
                          className="text-slate-600 hover:text-red-400 p-1 transition-colors">
                          <Trash2 size={15}/>
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {editRun && <EditRunModal run={editRun}
        onSave={patch => updateRun(editRun.id, patch)}
        onClose={() => setEditRun(null)}/>}
    </div>
  );
}

// ── EditRunModal ───────────────────────────────────────────────────
// Edit an existing run — mirrors the fields on the Log a Run form.
function EditRunModal({run, onSave, onClose}) {
  const sec = run.durationSec || 0;
  const [f, setF] = useState({
    date:  run.date,
    type:  run.type || "EASY",
    km:    run.km != null ? String(run.km) : "",
    dH:    String(Math.floor(sec / 3600) || ""),
    dM:    String(Math.floor((sec % 3600) / 60) || ""),
    dS:    String(sec % 60 || ""),
    hr:    run.hr        ? String(run.hr)        : "",
    hrMax: run.hrMax     ? String(run.hrMax)     : "",
    elev:  run.elevation ? String(run.elevation) : "",
    effort: run.effort || 5,
    notes:  run.notes || "",
  });
  const [err, setErr] = useState("");
  const set = (k, v) => setF(prev => Object.assign({}, prev, {[k]: v}));

  const save = () => {
    if (!f.km || (!f.dM && !f.dH)) { setErr("Distance and duration are required."); return; }
    const s = (parseInt(f.dH) || 0) * 3600 + (parseInt(f.dM) || 0) * 60 + (parseInt(f.dS) || 0);
    onSave({
      date: f.date, type: f.type, km: parseFloat(f.km), durationSec: s,
      hr:        f.hr    ? parseInt(f.hr)    : null,
      hrMax:     f.hrMax ? parseInt(f.hrMax) : null,
      elevation: f.elev  ? parseInt(f.elev)  : null,
      effort:    parseInt(f.effort), notes: f.notes,
    });
    onClose();
  };

  const I = "w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500";
  const L = "block text-xs text-slate-400 mb-1.5";

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-end justify-center p-4" onClick={onClose}>
      <div className="bg-slate-800 rounded-2xl w-full max-w-lg border border-slate-700 flex flex-col max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center px-4 py-3 border-b border-slate-700 shrink-0">
          <p className="font-semibold text-sm">Edit Run</p>
          <button onClick={onClose} className="text-slate-400 hover:text-white text-lg leading-none px-1">x</button>
        </div>
        <div className="p-4 space-y-4 overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div><label className={L}>Date</label>
              <input type="date" value={f.date} onChange={e => set("date", e.target.value)} className={I}/></div>
            <div><label className={L}>Type</label>
              <select value={f.type} onChange={e => set("type", e.target.value)} className={I}>
                {["EASY","TEMPO","LONG","INTERVALS","RACE","WALK","OTHER"].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div><label className={L}>Distance (km)</label>
            <input type="number" step="0.01" min="0" placeholder="8.5" value={f.km}
              onChange={e => set("km", e.target.value)} className={I}/></div>
          <div><label className={L}>Duration</label>
            <div className="grid grid-cols-3 gap-2">
              <input type="number" min="0" max="23" placeholder="h"   value={f.dH} onChange={e => set("dH", e.target.value)} className={I}/>
              <input type="number" min="0" max="59" placeholder="min" value={f.dM} onChange={e => set("dM", e.target.value)} className={I}/>
              <input type="number" min="0" max="59" placeholder="sec" value={f.dS} onChange={e => set("dS", e.target.value)} className={I}/>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div><label className={L}>Avg HR</label>
              <input type="number" placeholder="145" value={f.hr} onChange={e => set("hr", e.target.value)} className={I}/></div>
            <div><label className={L}>Max HR</label>
              <input type="number" placeholder="170" value={f.hrMax} onChange={e => set("hrMax", e.target.value)} className={I}/></div>
            <div><label className={L}>Elev (m)</label>
              <input type="number" placeholder="80" value={f.elev} onChange={e => set("elev", e.target.value)} className={I}/></div>
          </div>
          <div>
            <label className={L}>{"Perceived effort: "}<span className="text-white font-semibold">{f.effort + "/10"}</span></label>
            <input type="range" min="1" max="10" value={f.effort} onChange={e => set("effort", e.target.value)} className="w-full accent-orange-500"/>
          </div>
          <div><label className={L}>Notes</label>
            <textarea rows={2} placeholder="How did it feel? Any aches?" value={f.notes}
              onChange={e => set("notes", e.target.value)} className={I + " resize-none"}/></div>
          {err && <p className="text-xs text-red-400">{err}</p>}
          <button onClick={save}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2">
            <Check size={18}/>Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  PLAN VIEW
// ══════════════════════════════════════════════════════════════════
function PlanView({plan, settings, savePlan, saveSettings, buildPlan, toggleSess, exportData, openSettings}) {
  // Index of the week containing today — the one we auto-expand.
  const currentWeekIndex = () => {
    if (!plan) return null;
    const today = new Date(); today.setHours(0,0,0,0);
    const i = plan.weeks.findIndex(w => {
      const s = new Date(w.startDate + "T00:00:00");
      const e = new Date(s); e.setDate(s.getDate() + 7);
      return today >= s && today < e;
    });
    return i >= 0 ? i : 0;
  };

  const [exp,          setExp]         = useState(currentWeekIndex);
  const [editSessions, setEdit]        = useState(false);
  const [draft,        setDraft]       = useState(settings.planSessions || [{dayOffset:2,minutes:30},{dayOffset:6,minutes:60}]);
  const [draftDate,    setDraftDate]   = useState(settings.raceDate);
  const [draftGoal,    setDraftGoal]   = useState(settings.goalSec);
  const [draftDist,    setDraftDist]   = useState(settings.distanceKm || 20);
  const [confirmRegen, setConfirmRegen] = useState(false);

  // Re-expand the current week whenever the plan changes (e.g. regenerate),
  // adjusting state during render rather than in an effect.
  const [prevPlan, setPrevPlan] = useState(plan);
  if (plan !== prevPlan) {
    setPrevPlan(plan);
    setExp(currentWeekIndex());
  }

  const genPlan = opts => {
    const o    = opts || {};
    const ps   = o.planSessions || draft;
    const date = o.raceDate     || settings.raceDate;
    const goal = o.goalSec      || settings.goalSec;
    const dist = o.distanceKm   || settings.distanceKm || 20;
    saveSettings(Object.assign({}, settings, {planSessions: ps, raceDate: date, goalSec: goal, distanceKm: dist}));
    savePlan(buildPlan(date, goal, ps, dist));
    setEdit(false); setConfirmRegen(false);
  };

  if (!plan) return (
    <div className="p-4 max-w-lg mx-auto">
      <h2 className="text-xl font-bold mt-4 mb-5">Training Plan</h2>
      <div className="bg-slate-800 rounded-2xl p-5 space-y-5">
        <p className="text-slate-400 text-sm">Configure your goal and available training days.</p>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Race date</label>
          <input type="date" defaultValue={settings.raceDate}
            onChange={e => saveSettings(Object.assign({}, settings, {raceDate: e.target.value}))}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Race distance (km)</label>
          <input type="number" min="1" max="200" step="0.1" defaultValue={settings.distanceKm || 20}
            onChange={e => saveSettings(Object.assign({}, settings, {distanceKm: parseFloat(e.target.value) || 20}))}
            className="w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400"/>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">
            {"Goal time: "}
            <span className="text-white font-semibold">{Math.round(settings.goalSec/60) + " min"}</span>
          </label>
          <input type="range" min={75} max={180} step={5} defaultValue={120}
            onChange={e => saveSettings(Object.assign({}, settings, {goalSec: parseInt(e.target.value) * 60}))}
            className="w-full accent-orange-500"/>
          <div className="flex justify-between text-xs text-slate-600 mt-1"><span>1h15</span><span>3h00</span></div>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-2">Training days and durations</label>
          <SessionConfigurator sessions={draft} onChange={setDraft}/>
        </div>
        {!settings.maxHR && (
          <button type="button" onClick={openSettings}
            className="w-full bg-amber-500/10 hover:bg-amber-500/15 border border-amber-500/25 rounded-xl p-3 text-xs text-amber-200 flex gap-2 items-start text-left transition-colors">
            <span className="flex-shrink-0 text-base leading-none">💡</span>
            <span>Add your HR profile in Settings to unlock heart rate targets on every session.</span>
          </button>
        )}
        <button onClick={() => genPlan({planSessions: draft})}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white py-3.5 rounded-xl font-semibold transition-colors">
          Generate My Training Plan
        </button>
      </div>
    </div>
  );

  const all  = plan.weeks.flatMap(w => w.sessions);
  const done = all.filter(s => s.done).length;
  const pct  = Math.round((done / all.length) * 100);
  const today = new Date(); today.setHours(0,0,0,0);
  const ps   = plan.planSessions || settings.planSessions || [];
  const sessInfo = ps.slice()
    .sort((a, b) => a.dayOffset - b.dayOffset)
    .map(s => DAYS[s.dayOffset] + " (" + (s.minutes < 60 ? s.minutes + "min" : (s.minutes/60) + "h") + ")")
    .join(" · ");

  const phaseClass = phase => {
    if (phase === "TAPER") return "bg-emerald-500/15 text-emerald-400";
    if (phase === "PEAK" || phase === "RACE") return "bg-red-500/15 text-red-400";
    if (phase === "BUILD") return "bg-yellow-500/15 text-yellow-400";
    return "bg-sky-500/15 text-sky-400";
  };

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex justify-between items-center mt-4 mb-4">
        <h2 className="text-xl font-bold">Training Plan</h2>
        <div className="flex gap-1 items-center">
          <button onClick={exportData}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors">
            <Download size={16}/>
          </button>
          {confirmRegen ? (
            <div className="flex gap-1">
              <button onClick={() => setConfirmRegen(false)}
                className="px-2 py-1.5 text-slate-400 hover:text-white text-xs rounded-lg hover:bg-slate-700 transition-colors">
                Cancel
              </button>
              <button onClick={() => genPlan()}
                className="px-2 py-1.5 text-red-400 hover:text-white text-xs font-semibold rounded-lg hover:bg-red-500/20 transition-colors">
                Reset ✓
              </button>
            </div>
          ) : (
            <button onClick={() => setConfirmRegen(true)}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded-lg transition-colors"
              title="Regenerate plan">
              <RotateCcw size={16}/>
            </button>
          )}
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl p-4 mb-3">
        <div className="flex justify-between text-sm mb-2">
          <span className="text-slate-400">{done + " / " + all.length + " sessions"}</span>
          <span className="text-orange-400 font-bold">{pct + "%"}</span>
        </div>
        <div className="h-2.5 bg-slate-700 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-orange-500 to-amber-400 rounded-full transition-all duration-700" style={{width: pct + "%"}}/>
        </div>
        <div className="flex justify-between text-xs text-slate-600 mt-2">
          <span>{(plan.distanceKm || 20) + "km · sub " + fmt.dur(plan.goalSec)}</span>
          <span>{"Race: " + fmt.sht(plan.raceDate)}</span>
        </div>
      </div>

      <button onClick={() => {
          setDraft(ps.slice());
          setDraftDate(settings.raceDate);
          setDraftGoal(settings.goalSec);
          setDraftDist(settings.distanceKm || 20);
          setEdit(v => !v);
        }}
        className={"w-full mb-3 rounded-xl px-4 py-2.5 flex items-center justify-between text-xs transition-colors border " + (editSessions ? "bg-orange-500/10 border-orange-500/40" : "bg-slate-800 border-slate-700 hover:border-slate-500")}>
        <span>
          <span className="text-slate-400">Sessions: </span>
          <span className="text-white font-medium">{sessInfo || "not configured"}</span>
        </span>
        <span className="text-orange-400 font-semibold ml-2 flex-shrink-0">{editSessions ? "Close" : "Edit plan"}</span>
      </button>

      {editSessions && (
        <div className="bg-slate-800 rounded-xl p-4 mb-3 border border-orange-500/30 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Race date</label>
              <input type="date" value={draftDate} onChange={e => setDraftDate(e.target.value)}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-orange-400"/>
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1.5">Distance (km)</label>
              <input type="number" min="1" max="200" step="0.1" value={draftDist}
                onChange={e => setDraftDist(parseFloat(e.target.value) || 0)}
                className="w-full bg-slate-700 border border-slate-600 rounded-xl p-2.5 text-white text-sm focus:outline-none focus:border-orange-400"/>
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1.5">
              {"Goal time: "}
              <span className="text-white font-semibold">{fmt.dur(draftGoal)}</span>
              <span className="text-slate-500">{draftDist > 0 ? "  ·  " + fmt.pace(Math.round(draftGoal / draftDist)) + "/km" : ""}</span>
            </label>
            <input type="range" min={20} max={360} step={5} value={Math.round(draftGoal / 60)}
              onChange={e => setDraftGoal(parseInt(e.target.value) * 60)}
              className="w-full accent-orange-500"/>
            <div className="flex justify-between text-xs text-slate-600 mt-1"><span>20min</span><span>6h00</span></div>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-2">Training days and durations</label>
            <SessionConfigurator sessions={draft} onChange={setDraft}/>
          </div>
          <button onClick={() => genPlan({planSessions: draft, raceDate: draftDate, goalSec: draftGoal, distanceKm: draftDist || 20})}
            disabled={!draftDate || !draftDist}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white py-2.5 rounded-xl text-sm font-semibold transition-colors">
            Regenerate plan
          </button>
          <p className="text-xs text-slate-500 text-center">Regenerating rebuilds the schedule — completed sessions will reset.</p>
        </div>
      )}

      <div className="space-y-2">
        {plan.weeks.map((wk, i) => {
          const wS = new Date(wk.startDate + "T00:00:00");
          const wE = new Date(wS); wE.setDate(wS.getDate() + 7);
          const isCurr = today >= wS && today < wE;
          const isPast = wE < today;
          const isExp  = exp === i;
          const wDone  = wk.sessions.filter(s => s.done).length;
          const wkNumCls = isCurr ? "text-orange-400" : isPast ? "text-slate-600" : "text-slate-300";
          const wkCardCls = isCurr ? "border-orange-500/50 bg-orange-500/5" : "border-slate-700 bg-slate-800";
          const chevronCls = "text-slate-600 transition-transform flex-shrink-0 " + (isExp ? "rotate-90" : "");

          return (
            <div key={wk.weekNumber} className={"rounded-xl border overflow-hidden " + wkCardCls}>
              <button onClick={() => setExp(isExp ? null : i)} className="w-full px-4 py-3 flex items-center gap-2 text-left">
                <span className={"text-sm font-bold flex-shrink-0 " + wkNumCls}>{"W" + wk.weekNumber}</span>
                <span className="text-xs text-slate-600 flex-shrink-0">{fmt.sht(wk.startDate)}</span>
                <span className={"text-xs px-2 py-0.5 rounded-full flex-shrink-0 " + phaseClass(wk.phase)}>{wk.phase}</span>
                {isCurr && <span className="text-xs text-orange-400 flex-shrink-0">now</span>}
                <span className="flex-1"/>
                <span className="text-xs text-slate-600">{wDone + "/" + wk.sessions.length}</span>
                <ChevronRight size={14} className={chevronCls}/>
              </button>

              {isExp && (
                <div className="border-t border-slate-700/50">
                  {wk.sessions.slice().sort((a, b) => a.date.localeCompare(b.date)).map(s => {
                    const rowCls = "flex items-start gap-3 px-4 py-3 border-b border-slate-700/30 last:border-0 " + (s.done ? "opacity-40" : "");
                    const btnCls = "mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition-all " + (s.done ? "bg-emerald-500 border-emerald-500" : "border-slate-500 hover:border-emerald-400");
                    const descCls = "text-sm mt-0.5 leading-snug " + (s.done ? "line-through text-slate-600" : "text-slate-300");
                    const typeCls = "text-xs font-bold uppercase " + (TCLR[s.type] || "text-violet-400");
                    return (
                      <div key={s.id} className={rowCls}>
                        <button onClick={() => toggleSess(wk.weekNumber, s.id)} className={btnCls}>
                          {s.done && <Check size={11}/>}
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className={typeCls}>{s.type}</span>
                            <span className="text-xs text-slate-600">{fmt.sht(s.date)}</span>
                          </div>
                          <p className={descCls}>{cleanDesc(s.desc)}</p>
                          <p className="text-xs text-slate-600 mt-0.5">{s.km + " km · ~" + estMin(s.km, s.pace) + " · " + fmt.pace(s.pace) + "/km"}</p>
                          <HRTarget type={s.type} settings={settings} openSettings={openSettings}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  LOG VIEW
// ══════════════════════════════════════════════════════════════════
function LogView({addRuns, onDone}) {
  const INIT = {date:ymd(new Date()),type:"EASY",km:"",dH:"",dM:"",dS:"",hr:"",hrMax:"",elev:"",effort:5,notes:""};
  const [f,      setF]    = useState(INIT);
  const [busy,   setBusy] = useState(false);
  const [showImp,setImp]  = useState(false);
  const [csvMsg, setCsvMsg] = useState("");
  const fRef = useRef();
  const set  = (k, v) => setF(prev => Object.assign({}, prev, {[k]: v}));

  const showMsg = (msg, ms) => { setCsvMsg(msg); setTimeout(() => setCsvMsg(""), ms || 3000); };

  const submit = async () => {
    if (!f.km || (!f.dM && !f.dH)) { showMsg("Distance and duration are required."); return; }
    setBusy(true);
    const sec = (parseInt(f.dH)||0)*3600 + (parseInt(f.dM)||0)*60 + (parseInt(f.dS)||0);
    addRuns([{
      date: f.date, type: f.type, km: parseFloat(f.km), durationSec: sec,
      hr:        f.hr    ? parseInt(f.hr)    : null,
      hrMax:     f.hrMax ? parseInt(f.hrMax) : null,
      elevation: f.elev  ? parseInt(f.elev)  : null,
      effort:    parseInt(f.effort), notes: f.notes,
    }]);
    setBusy(false); onDone();
  };

  const handleCSV = e => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const lines = ev.target.result.trim().split("\n");
      const hdrs  = lines[0].split(",").map(h => h.trim().replace(/"/g, "").toLowerCase());
      const imported = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(",").map(v => v.trim().replace(/^"|"$/g, ""));
        const row  = {};
        hdrs.forEach((h, j) => { row[h] = vals[j] || ""; });
        if (hdrs.includes("start time") || hdrs.includes("activity type")) {
          const dStr = (row["start time"] || "").split(" ")[0];
          const dM   = parseFloat(row["distance (m)"] || row["distance"] || 0);
          const dur  = parseInt(row["duration (s)"] || row["duration"] || 0);
          if (dM > 500 && dur > 60) imported.push({
            date: dStr || ymd(new Date()),
            type: "EASY", km: Math.round(dM/100)/10, durationSec: dur,
            hr:        parseInt(row["average heart rate (bpm)"]) || null,
            hrMax:     parseInt(row["max heart rate (bpm)"])     || null,
            elevation: null, effort: 5, notes: "Zepp import",
          });
        } else if (hdrs.includes("activity date") || hdrs.includes("elapsed time")) {
          const dStr = row["activity date"] ? ymd(new Date(row["activity date"])) : "";
          const dK   = parseFloat(row["distance"] || 0);
          const dur  = parseInt(row["elapsed time"] || row["moving time"] || 0);
          const aT   = (row["activity type"] || "run").toLowerCase();
          if (aT.includes("run") && dK > 0.5) imported.push({
            date: dStr, type: "EASY", km: dK, durationSec: dur,
            hr:        parseInt(row["average heart rate"]) || null,
            hrMax:     parseInt(row["max heart rate"])     || null,
            elevation: parseInt(row["elevation gain"])     || null,
            effort: 5, notes: "Strava import",
          });
        }
      }
      if (imported.length) {
        addRuns(imported);
        showMsg("Imported " + imported.length + " run" + (imported.length > 1 ? "s" : "") + ".");
        setTimeout(() => onDone(), 1500);
      } else {
        showMsg("No runs found. Check it's a Zepp or Strava CSV.");
      }
    };
    reader.readAsText(file); e.target.value = "";
  };

  const I = "w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500";
  const L = "block text-xs text-slate-400 mb-1.5";
  const impBtnCls = "flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-lg border transition-colors " +
    (showImp ? "bg-orange-500 border-orange-500 text-white" : "border-orange-400/50 text-orange-400 hover:bg-orange-400/10");
  const msgCls = "mb-4 py-2.5 px-4 rounded-xl text-sm text-center " +
    (csvMsg.startsWith("Imported") ? "bg-emerald-500/15 text-emerald-300" : "bg-red-500/15 text-red-300");

  return (
    <div className="p-4 max-w-lg mx-auto">
      <div className="flex justify-between items-center mt-4 mb-5">
        <h2 className="text-xl font-bold">Log a Run</h2>
        <button onClick={() => setImp(v => !v)} className={impBtnCls}>
          <Upload size={14}/>Import CSV
        </button>
      </div>

      {csvMsg && <div className={msgCls}>{csvMsg}</div>}

      {showImp && (
        <div className="bg-slate-800 rounded-2xl p-4 mb-5 border border-slate-700 space-y-2.5">
          <p className="text-sm font-semibold text-slate-200">Import from Zepp or Strava</p>
          <p className="text-xs text-slate-500">
            <span className="text-slate-300">Zepp:</span> Profile → Privacy Center → Export Personal Data<br/>
            <span className="text-slate-300">Strava:</span> Settings → My Account → Download or Delete → Request Archive
          </p>
          <input ref={fRef} type="file" accept=".csv" onChange={handleCSV} className="hidden"/>
          <button onClick={() => fRef.current.click()}
            className="w-full bg-orange-500 hover:bg-orange-600 text-white py-2.5 rounded-xl text-sm font-medium transition-colors">
            Choose CSV file
          </button>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className={L}>Date</label>
            <input type="date" value={f.date} onChange={e => set("date", e.target.value)} className={I}/></div>
          <div><label className={L}>Type</label>
            <select value={f.type} onChange={e => set("type", e.target.value)} className={I}>
              {["EASY","TEMPO","LONG","INTERVALS","RACE","WALK","OTHER"].map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div><label className={L}>Distance (km)</label>
          <input type="number" step="0.01" min="0" placeholder="8.5" value={f.km}
            onChange={e => set("km", e.target.value)} className={I}/></div>
        <div><label className={L}>Duration</label>
          <div className="grid grid-cols-3 gap-2">
            <input type="number" min="0" max="23" placeholder="h"   value={f.dH} onChange={e => set("dH", e.target.value)} className={I}/>
            <input type="number" min="0" max="59" placeholder="min" value={f.dM} onChange={e => set("dM", e.target.value)} className={I}/>
            <input type="number" min="0" max="59" placeholder="sec" value={f.dS} onChange={e => set("dS", e.target.value)} className={I}/>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div><label className={L}>Avg HR</label>
            <input type="number" placeholder="145" value={f.hr} onChange={e => set("hr", e.target.value)} className={I}/></div>
          <div><label className={L}>Max HR</label>
            <input type="number" placeholder="170" value={f.hrMax} onChange={e => set("hrMax", e.target.value)} className={I}/></div>
          <div><label className={L}>Elev (m)</label>
            <input type="number" placeholder="80" value={f.elev} onChange={e => set("elev", e.target.value)} className={I}/></div>
        </div>
        <div>
          <label className={L}>{"Perceived effort: "}<span className="text-white font-semibold">{f.effort + "/10"}</span></label>
          <input type="range" min="1" max="10" value={f.effort} onChange={e => set("effort", e.target.value)} className="w-full accent-orange-500"/>
        </div>
        <div><label className={L}>Notes</label>
          <textarea rows={2} placeholder="How did it feel? Any aches?" value={f.notes}
            onChange={e => set("notes", e.target.value)} className={I + " resize-none"}/></div>
        <button onClick={submit} disabled={busy}
          className="w-full bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white py-3.5 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2">
          {busy ? <Loader size={18} className="animate-spin"/> : <Plus size={18}/>}
          Save Run
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  STATS VIEW
// ══════════════════════════════════════════════════════════════════
function StatsView({runs, settings}) {
  return (
    <div className="max-w-lg mx-auto">
      <div className="px-4 pt-6 pb-0">
        <h2 className="text-xl font-bold">Stats</h2>
      </div>
      <Overview runs={runs}/>
      <RacePredictions runs={runs} settings={settings}/>
    </div>
  );
}

function Overview({runs}) {
  const [period, setPeriod] = useState("12w");

  const fRuns = period === "all" ? runs : (() => {
    const cut = new Date();
    cut.setDate(cut.getDate() - (period === "4w" ? 28 : 84));
    return runs.filter(r => new Date(r.date + "T00:00:00") >= cut);
  })();

  const wkBars = (() => {
    const m = {};
    fRuns.forEach(r => {
      const d   = new Date(r.date + "T00:00:00");
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const k = ymd(mon);
      m[k] = (m[k] || 0) + (r.km || 0);
    });
    return Object.entries(m)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(e => ({d: fmt.sht(e[0]), km: Math.round(e[1] * 10) / 10}));
  })();

  // Weekly elevation gain, bucketed the same way as weekly distance so the two
  // charts share a timeline. Weeks with runs but no elevation contribute 0.
  const wkElevBars = (() => {
    const m = {};
    fRuns.forEach(r => {
      const d   = new Date(r.date + "T00:00:00");
      const mon = new Date(d);
      mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const k = ymd(mon);
      m[k] = (m[k] || 0) + (r.elevation || 0);
    });
    return Object.entries(m)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(e => ({d: fmt.sht(e[0]), elev: Math.round(e[1])}));
  })();

  const pLine = fRuns.slice()
    .filter(r => r.km && r.durationSec)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(r => ({d: fmt.sht(r.date), p: Math.round(r.durationSec / r.km)}));

  const totKm   = fRuns.reduce((s, r) => s + (r.km || 0), 0);
  const pRuns   = fRuns.filter(r => r.km && r.durationSec);
  const avgPace = pRuns.length ? pRuns.reduce((s, r) => s + r.durationSec / r.km, 0) / pRuns.length : 0;
  const bestPace = pRuns.filter(r => r.km >= 3).reduce((b, r) => {
    const p = r.durationSec / r.km;
    return (!b || p < b) ? p : b;
  }, null);
  const hrRuns = fRuns.filter(r => r.hr);
  const avgHR  = hrRuns.length ? hrRuns.reduce((s, r) => s + r.hr, 0) / hrRuns.length : 0;
  const totElev = fRuns.reduce((s, r) => s + (r.elevation || 0), 0);
  const totTime = fRuns.reduce((s, r) => s + (r.durationSec || 0), 0);

  const stats = [
    {l:"Total distance", v:totKm.toFixed(1) + " km",    s:fRuns.length + " runs", c:"text-orange-400"},
    {l:"Total time",     v:(totTime/3600).toFixed(1) + " h", s:"moving time",     c:"text-violet-400"},
    {l:"Average pace",   v:fmt.pace(avgPace),             s:"min/km",               c:"text-sky-400"},
    totElev > 0 && {l:"Total elevation", v:Math.round(totElev).toLocaleString() + " m", s:"climbed", c:"text-emerald-400"},
    bestPace && {l:"Best pace",     v:fmt.pace(bestPace), s:"runs ≥3km",            c:"text-amber-400"},
    avgHR > 0 && {l:"Avg heart rate", v:Math.round(avgHR) + "", s:"bpm",           c:"text-red-400"},
  ].filter(Boolean);

  const tt = {background:"#1e293b", border:"none", borderRadius:8, color:"#fff", fontSize:12};

  if (!runs.length) return (
    <div className="flex flex-col items-center justify-center pt-20 text-center gap-3 p-4">
      <TrendingUp size={48} className="text-slate-700"/>
      <p className="text-slate-400">Log some runs to see your stats!</p>
    </div>
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex justify-end">
        <div className="flex bg-slate-800 rounded-xl p-1 gap-0.5">
          {[["4w","4w"],["12w","12w"],["all","All"]].map(pair => (
            <button key={pair[0]} onClick={() => setPeriod(pair[0])}
              className={"text-xs px-3 py-1.5 rounded-lg transition-colors " + (period === pair[0] ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white")}>
              {pair[1]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {stats.map(s => (
          <div key={s.l} className="bg-slate-800 rounded-xl p-4">
            <p className="text-slate-500 text-xs">{s.l}</p>
            <p className={"text-2xl font-bold mt-1 " + s.c}>{s.v}</p>
            <p className="text-slate-600 text-xs">{s.s}</p>
          </div>
        ))}
      </div>
      {wkBars.length > 1 && (
        <div className="bg-slate-800 rounded-2xl p-4">
          <p className="text-slate-400 text-sm font-medium mb-3">Weekly distance (km)</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={wkBars} margin={{top:0,right:4,left:-18,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a"/>
              <XAxis dataKey="d" tick={{fill:"#475569",fontSize:10}}/>
              <YAxis tick={{fill:"#475569",fontSize:10}}/>
              <Tooltip contentStyle={tt} formatter={v => [v + " km", "Distance"]}/>
              <Bar dataKey="km" fill="#f97316" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {totElev > 0 && wkElevBars.length > 1 && (
        <div className="bg-slate-800 rounded-2xl p-4">
          <p className="text-slate-400 text-sm font-medium mb-3">Weekly elevation gain (m)</p>
          <ResponsiveContainer width="100%" height={150}>
            <BarChart data={wkElevBars} margin={{top:0,right:4,left:-18,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a"/>
              <XAxis dataKey="d" tick={{fill:"#475569",fontSize:10}}/>
              <YAxis tick={{fill:"#475569",fontSize:10}}/>
              <Tooltip contentStyle={tt} formatter={v => [v + " m", "Elevation"]}/>
              <Bar dataKey="elev" fill="#10b981" radius={[4,4,0,0]}/>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      {pLine.length > 2 && (
        <div className="bg-slate-800 rounded-2xl p-4">
          <div className="flex justify-between items-baseline mb-3">
            <p className="text-slate-400 text-sm font-medium">Pace trend</p>
            <p className="text-slate-600 text-xs">down = faster</p>
          </div>
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={pLine} margin={{top:4,right:4,left:-18,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#0f172a"/>
              <XAxis dataKey="d" tick={{fill:"#475569",fontSize:10}}/>
              <YAxis tick={{fill:"#475569",fontSize:10}} domain={["dataMin - 30","dataMax + 30"]}
                tickFormatter={v => fmt.pace(v)}/>
              <Tooltip contentStyle={tt} formatter={v => [fmt.pace(v) + "/km", "Pace"]}/>
              <ReferenceLine y={360} stroke="#f97316" strokeDasharray="5 3"
                label={{value:"6:00 goal", fill:"#f97316", fontSize:10, position:"right"}}/>
              <Line type="monotone" dataKey="p" stroke="#38bdf8" strokeWidth={2.5}
                dot={{r:3.5, fill:"#38bdf8", strokeWidth:0}}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  RACE PREDICTIONS — project finish times from logged runs
// ══════════════════════════════════════════════════════════════════
function RacePredictions({runs, settings}) {
  const [period, setPeriod] = useState("12w");

  // Same period filter the Overview uses, so both halves of Stats agree.
  const fRuns = period === "all" ? runs : (() => {
    const cut = new Date();
    cut.setDate(cut.getDate() - (period === "4w" ? 28 : 84));
    return runs.filter(r => new Date(r.date + "T00:00:00") >= cut);
  })();

  // Effective max HR: explicit setting → Tanaka from age → highest HR observed.
  const effMax = settings.maxHR
    || (settings.age ? Math.round(208 - 0.7 * settings.age) : 0)
    || fRuns.reduce((m, r) => Math.max(m, r.hrMax || r.hr || 0), 0);
  const restHR = settings.restHR || 60;
  const method = settings.hrMethod || "karvonen";

  const best = bestEffortAnchor(fRuns);
  const hr   = hrModelAnchor(fRuns, effMax, restHR, method);
  // Only trust the HR model with a real spread of efforts and a sane fit.
  const hrOk = hr && hr.n >= 8 && hr.spread >= 15 && hr.slope < 0 && hr.r2 >= 0.3;

  // 5 / 10 / 20 km, plus the race-day distance when it isn't already one of them.
  const dists = [5, 10, 20];
  const raceD = settings.distanceKm;
  if (raceD && !dists.includes(raceD)) dists.push(raceD);
  dists.sort((a, b) => a - b);

  if (!runs.length) return null;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-bold">Race predictions</h3>
          <p className="text-slate-500 text-xs mt-0.5">Projected finish times from your logged runs</p>
        </div>
        <div className="flex bg-slate-800 rounded-xl p-1 gap-0.5">
          {[["4w","4w"],["12w","12w"],["all","All"]].map(pair => (
            <button key={pair[0]} onClick={() => setPeriod(pair[0])}
              className={"text-xs px-3 py-1.5 rounded-lg transition-colors " + (period === pair[0] ? "bg-orange-500 text-white" : "text-slate-400 hover:text-white")}>
              {pair[1]}
            </button>
          ))}
        </div>
      </div>

      {!best ? (
        <div className="bg-slate-800 rounded-xl p-4 text-center">
          <p className="text-slate-400 text-sm">Log a run of 3 km or more to estimate your race times.</p>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {dists.map(d => {
              const bt = riegel(best.durationSec, best.km, d);
              const ht = hrOk ? riegel(hr.durationSec, hr.km, d) : null;
              return (
                <div key={d} className="bg-slate-800 rounded-xl p-4">
                  <div className="flex items-baseline justify-between mb-3">
                    <p className="font-semibold">
                      {d} km
                      {d === raceD && <span className="ml-2 text-xs text-orange-400 font-normal">race day</span>}
                    </p>
                  </div>
                  <div className={"grid gap-3 " + (ht ? "grid-cols-2" : "grid-cols-1")}>
                    <div>
                      <p className="text-slate-500 text-xs">Best-effort estimate</p>
                      <p className="text-2xl font-bold mt-0.5 text-orange-400">{fmt.dur(bt)}</p>
                      <p className="text-slate-600 text-xs">{fmt.pace(bt / d)}/km</p>
                    </div>
                    {ht && (
                      <div>
                        <p className="text-slate-500 text-xs">HR-modelled estimate</p>
                        <p className="text-2xl font-bold mt-0.5 text-sky-400">{fmt.dur(ht)}</p>
                        <p className="text-slate-600 text-xs">{fmt.pace(ht / d)}/km</p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-slate-800/50 rounded-xl p-4 space-y-2">
            <p className="text-slate-400 text-xs">
              <span className="text-orange-400 font-semibold">Best-effort</span> projects your strongest run
              {" (" + best.raw.km + " km in " + fmt.dur(best.durationSec)
                + (best.raw.elevation > 0 ? ", " + Math.round(best.raw.elevation) + " m climb" : "") + ")"}
              {" "}to each distance with Riegel's formula.
            </p>
            {hrOk ? (
              <p className="text-slate-400 text-xs">
                <span className="text-sky-400 font-semibold">HR-modelled</span> fits your pace against heart rate across
                {" " + hr.n + " runs"} and extrapolates to threshold effort (~{hr.thrHR} bpm) — so easy runs handled
                well count too, not just your fastest day.
              </p>
            ) : (
              <p className="text-slate-500 text-xs">
                Add your max HR in Settings and log more runs across easy + hard efforts to unlock the HR-based estimate.
              </p>
            )}
            <p className="text-slate-600 text-xs">Runs are grade-adjusted for elevation gain; predictions are for a flat course.</p>
          </div>
        </>
      )}
    </div>
  );
}

function HRZones({settings, saveSettings, runs, showToast}) {
  const [age,    setAge]    = useState(String(settings.age || ""));
  const [maxHR,  setMaxHR]  = useState(String(settings.maxHR || ""));
  const [restHR, setRestHR] = useState(String(settings.restHR || 60));
  const [method, setMethod] = useState(settings.hrMethod || "karvonen");
  const [saved,  setSaved]  = useState(false);

  const ageN  = parseInt(age)    || 0;
  const mhrN  = parseInt(maxHR)  || 0;
  const rhrN  = parseInt(restHR) || 60;
  const tanakaMax  = ageN ? Math.round(208 - 0.7 * ageN) : null;
  const classicMax = ageN ? 220 - ageN : null;
  const effMax = mhrN || tanakaMax || 0;
  const hrr    = effMax - rhrN;
  const ready  = effMax > 0 && rhrN > 0 && hrr > 0;

  const getZone = z => hrZoneBpm(z.lo, z.hi, effMax, rhrN, method);

  const getRunZone = hr => {
    if (!ready || !hr) return null;
    const idx = HR_ZONES.findIndex((z, i) => {
      const r = getZone(z);
      if (!r) return false;
      return i === HR_ZONES.length - 1 ? hr >= r.lo : hr >= r.lo && hr < r.hi;
    });
    return idx >= 0 ? idx + 1 : null;
  };

  const save   = () => {
    saveSettings(Object.assign({}, settings, {age:ageN, maxHR:mhrN||tanakaMax||0, restHR:rhrN, hrMethod:method}));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    if (showToast) showToast(ready ? "Profile saved — HR zones updated." : "Profile saved.");
  };
  const hrRuns = runs.filter(r => r.hr).slice(0, 6);
  const I = "w-full bg-slate-700 border border-slate-600 rounded-xl p-3 text-white text-sm focus:outline-none focus:border-orange-400 placeholder-slate-500";

  const methodOpts = [
    {v:"karvonen", l:"Karvonen (HRR)",  sub:"Uses resting HR — more personalised"},
    {v:"pct",      l:"% of Max HR",     sub:"Simpler, doesn't need resting HR"},
  ];

  return (
    <div className="space-y-5">
      <div className="bg-slate-800 rounded-2xl p-4 space-y-4">
        <p className="text-sm font-semibold text-slate-200">Heart Rate</p>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="text-xs text-slate-400 block mb-1.5">Age</label>
            <input type="number" min="10" max="90" placeholder="35" value={age} onChange={e => setAge(e.target.value)} className={I}/></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">Max HR</label>
            <input type="number" min="100" max="230" placeholder="auto" value={maxHR} onChange={e => setMaxHR(e.target.value)} className={I}/></div>
          <div><label className="text-xs text-slate-400 block mb-1.5">Rest HR</label>
            <input type="number" min="30" max="120" placeholder="60" value={restHR} onChange={e => setRestHR(e.target.value)} className={I}/></div>
        </div>

        {ageN > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-500">Max HR formulas — tap to apply:</p>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setMaxHR(String(tanakaMax))}
                className="text-xs bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 px-3 py-2 rounded-lg transition-colors text-left">
                <span className="font-semibold">{"Tanaka: " + tanakaMax + " bpm"}</span>
                <span className="block opacity-70 text-xs">208 - 0.7×age · more accurate</span>
              </button>
              <button onClick={() => setMaxHR(String(classicMax))}
                className="text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 px-3 py-2 rounded-lg transition-colors text-left">
                <span className="font-semibold">{"Classic: " + classicMax + " bpm"}</span>
                <span className="block text-slate-500 text-xs">220 - age · simple method</span>
              </button>
            </div>
          </div>
        )}

        <div>
          <p className="text-xs text-slate-400 mb-2">Zone calculation method:</p>
          <div className="grid grid-cols-2 gap-2">
            {methodOpts.map(opt => (
              <button key={opt.v} onClick={() => setMethod(opt.v)}
                className={"py-2.5 px-3 rounded-xl border text-left transition-colors " + (method === opt.v ? "bg-orange-500/15 border-orange-500/50 text-orange-300" : "bg-slate-700 border-slate-600 text-slate-400 hover:text-slate-300")}>
                <p className="text-xs font-semibold">{opt.l}</p>
                <p className="text-xs text-slate-500 mt-0.5">{opt.sub}</p>
              </button>
            ))}
          </div>
        </div>
        <button onClick={save}
          className={"w-full text-white py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center justify-center gap-2 " + (saved ? "bg-emerald-500" : "bg-orange-500 hover:bg-orange-600")}>
          {saved ? <><Check size={16}/>Saved</> : "Save heart rate"}
        </button>
      </div>

      {ready ? (
        <div className="space-y-5">
          <div className="bg-slate-800 rounded-2xl p-4">
            <p className="text-sm font-semibold text-slate-200 mb-4">Heart Rate Zones</p>
            <div className="flex rounded-xl overflow-hidden h-9 mb-3">
              {HR_ZONES.map(z => {
                const r = getZone(z);
                return (
                  <div key={z.n} className="flex-1 flex flex-col items-center justify-center" style={{background:z.clr}}>
                    <span className="text-xs font-black text-slate-900">{z.n}</span>
                    {r && <span className="font-semibold text-slate-800 leading-none" style={{fontSize:9}}>{r.lo}</span>}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between text-xs text-slate-600 mb-4 px-1">
              <span>{rhrN + " bpm (rest)"}</span>
              <span>{effMax + " bpm (max)"}</span>
            </div>
            <div className="space-y-1">
              {HR_ZONES.map(z => {
                const r = getZone(z);
                const aeroClass = z.type === "Aerobic"
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-orange-500/15 text-orange-400";
                return (
                  <div key={z.n} className="flex items-center gap-3 py-2.5 border-b border-slate-700/50 last:border-0">
                    <div className="w-3 h-3 rounded-full flex-shrink-0" style={{background:z.clr}}/>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-white">{"Z" + z.n + " · " + z.name}</span>
                        <span className={"text-xs px-1.5 py-0.5 rounded-full " + aeroClass}>{z.type}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5 leading-snug">{z.desc}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-sm font-bold text-white">{r ? (r.lo + "–" + r.hi) : "-"}</p>
                      <p className="text-xs text-slate-500">{Math.round(z.lo*100) + "–" + Math.round(z.hi*100) + "%"}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="bg-slate-800 rounded-xl p-3 text-xs text-slate-500 leading-relaxed">
            <span className="text-slate-300 font-medium">{method === "karvonen" ? "Karvonen method: " : "% of Max HR: "}</span>
            {method === "karvonen"
              ? "Zone HR = ((MaxHR - RestHR) x intensity%) + RestHR. HRR = " + effMax + " - " + rhrN + " = " + hrr + " bpm. More accurate as it accounts for individual fitness."
              : "Zone HR = MaxHR x intensity%. Simple and widely used, but doesn't account for resting HR or fitness level."}
          </div>

          {hrRuns.length > 0 && (
            <div className="bg-slate-800 rounded-2xl p-4">
              <p className="text-sm font-semibold text-slate-200 mb-3">Recent runs — zone analysis</p>
              <div className="space-y-1">
                {hrRuns.map(r => {
                  const zIdx  = getRunZone(r.hr);
                  const zData = zIdx ? HR_ZONES[zIdx - 1] : null;
                  return (
                    <div key={r.id} className="flex items-center gap-3 py-2 border-b border-slate-700/30 last:border-0">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white">{fmt.sht(r.date) + " · " + r.km + " km"}</p>
                        <p className="text-xs text-slate-500">
                          {"Avg HR: "}<span className="text-red-400">{r.hr + " bpm"}</span>
                        </p>
                      </div>
                      {zData ? (
                        <div className="text-right flex-shrink-0">
                          <span className="text-xs font-semibold px-2 py-1 rounded-lg"
                            style={{background: zData.clr + "25", color: zData.clr}}>
                            {"Z" + zData.n + " · " + zData.name}
                          </span>
                          <p className={"text-xs mt-0.5 " + (zData.type === "Aerobic" ? "text-emerald-400" : "text-orange-400")}>
                            {zData.type}
                          </p>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-600">—</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-slate-800 rounded-2xl p-8 text-center">
          <Heart size={36} className="mx-auto mb-3 text-slate-700"/>
          <p className="text-slate-400 text-sm">Enter your age and/or Max HR above</p>
          <p className="text-slate-600 text-xs mt-1">to calculate your personalised heart rate zones</p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  COACH VIEW
// ══════════════════════════════════════════════════════════════════
const ANTHROPIC_HEADERS = key => ({
  "Content-Type": "application/json",
  "x-api-key": key,
  "anthropic-version": "2023-06-01",
  "anthropic-dangerous-direct-browser-access": "true",
});

function CoachView({runs, plan, settings, apiKey, savePlan, openApiKey}) {
  const initMsg = "Hey " + settings.name + "! I'm your AI running coach. I can answer questions, analyse your progress, and update your training plan directly from this chat. What's on your mind?";
  const [msgs,  setMsgs]  = useState([{role:"assistant", text:initMsg}]);
  const [input, setInput] = useState("");
  const [busy,  setBusy]  = useState(false);
  const endRef = useRef();

  // Persist coach conversation across sessions
  useEffect(() => {
    db.get("rc_coach_msgs").then(saved => {
      if (saved && saved.length > 0) setMsgs(saved);
    });
  }, []);
  useEffect(() => {
    if (msgs.length > 1) db.set("rc_coach_msgs", msgs.slice(-80));
  }, [msgs]);

  useEffect(() => { endRef.current && endRef.current.scrollIntoView({behavior:"smooth"}); }, [msgs]);

  const clearChat = () => {
    const fresh = [{role:"assistant", text:initMsg}];
    setMsgs(fresh);
    db.set("rc_coach_msgs", fresh);
  };

  const applyChanges = changes => {
    if (!plan || !changes || !changes.length) return 0;
    let count = 0;
    const updated = Object.assign({}, plan, {
      weeks: plan.weeks.map(w => Object.assign({}, w, {
        sessions: w.sessions.map(s => {
          const ch = changes.find(c => c.sessionId === s.id);
          if (!ch) return s;
          count++;
          const patch = {};
          if (ch.type  !== undefined) patch.type = ch.type;
          if (ch.km    !== undefined) patch.km   = Math.round(ch.km * 10) / 10;
          if (ch.desc  !== undefined) patch.desc = ch.desc;
          if (ch.pace  !== undefined) patch.pace = ch.pace;
          return Object.assign({}, s, patch);
        }),
      })),
    });
    savePlan(updated);
    return count;
  };

  const UPDATE_TOOL = {
    name: "update_plan",
    description: "Directly modify sessions in the athlete's training plan. You MUST invoke this tool (never output tool calls as text or code blocks) whenever the user asks to add, schedule, change, swap, ease, or adjust any session.",
    input_schema: {
      type: "object",
      properties: {
        changes: {
          type: "array",
          description: "Sessions to modify",
          items: {
            type: "object",
            properties: {
              sessionId: {
                type: "string",
                description: "The sessionId field from the plan session list, e.g. 'w18d2'. Must match exactly.",
              },
              type: {
                type: "string",
                enum: ["EASY","TEMPO","LONG","INTERVALS","RACE","WALK"],
                description: "Session type. Use RACE for ANY race event — 5K, 10K, half-marathon, tune-up race, etc. Use WALK for walking/recovery-walk sessions.",
              },
              km:   {type:"number", description:"Distance in km"},
              desc: {type:"string", description:"Session description shown to the athlete"},
              pace: {type:"number", description:"Target pace in seconds/km"},
            },
            required: ["sessionId"],
          },
        },
        summary: {type:"string", description:"One-line summary of what was changed"},
      },
      required: ["changes","summary"],
    },
  };

  const sysPrompt = () => {
    const recent = runs.slice(0, 8).map(r => ({
      date:r.date, type:r.type, km:r.km,
      pace: r.km && r.durationSec ? Math.round(r.durationSec / r.km) : null,
      hr:r.hr, effort:r.effort, notes:r.notes,
    }));
    const dist = (plan ? plan.distanceKm : settings.distanceKm) || 20;
    const tgt  = plan ? plan.targetPace : Math.round(settings.goalSec / dist);
    const ps   = plan ? {
      raceDate: plan.raceDate, goalSec: plan.goalSec,
      done:  plan.weeks.flatMap(w => w.sessions).filter(s => s.done).length,
      total: plan.weeks.flatMap(w => w.sessions).length,
    } : null;
    const hrInfo   = settings.maxHR ? ("MaxHR=" + settings.maxHR + ", RestHR=" + (settings.restHR||60)) : "not set";
    const planDays = (settings.planSessions || []).map(s => DAYS[s.dayOffset] + "(" + s.minutes + "min)").join(", ");
    const allSessions = plan
      ? plan.weeks.flatMap(w => w.sessions.map(s => ({
          sessionId: s.id,
          date: s.date, type: s.type, km: s.km, done: s.done, week: w.weekNumber, phase: w.phase,
        })))
      : [];
    return "You are a professional running coach for " + settings.name + " training for a " + dist + "km race.\n"
      + "Race: " + settings.raceDate + " | Goal: sub-" + Math.floor(settings.goalSec/60) + "min | Target: " + fmt.pace(tgt) + "/km\n"
      + "Schedule: " + planDays + " | HR: " + hrInfo + "\n"
      + "Progress: " + (ps ? (ps.done + "/" + ps.total + " sessions done") : "no plan") + "\n"
      + "Recent runs: " + JSON.stringify(recent) + "\n"
      + "Plan sessions — use the sessionId field when calling update_plan: " + JSON.stringify(allSessions) + "\n"
      + "Today: " + ymd(new Date()) + "\n"
      + "Pace ref: easy=" + Math.round(tgt*1.25) + "s/km, tempo=" + Math.round(tgt*1.05) + "s/km, target=" + tgt + "s/km\n"
      + "CRITICAL: When modifying the plan, ALWAYS call the update_plan tool directly — never write tool calls as text or code. Use type=RACE for any race event (10K, half-marathon, tune-up, etc.).";
  };

  const send = async () => {
    if (!input.trim() || busy) return;
    if (!apiKey) { openApiKey(); return; }
    const msg = input.trim(); setInput(""); setBusy(true);
    setMsgs(m => m.concat({role:"user", text:msg}));
    try {
      const history  = msgs.filter(m => m.role === "user" || m.role === "assistant").map(m => ({role:m.role, content:m.text}));
      const apiMsgs  = history.concat({role:"user", content:msg});
      const r1 = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: ANTHROPIC_HEADERS(apiKey),
        body: JSON.stringify({model:"claude-sonnet-4-20250514", max_tokens:1024, system:sysPrompt(), tools:[UPDATE_TOOL], messages:apiMsgs}),
      });
      const d1 = await r1.json();
      if (!r1.ok) {
        const errMsg = (d1.error && d1.error.message) || "Request failed (" + r1.status + ").";
        setMsgs(m => m.concat({role:"assistant", text:"API error: " + errMsg + " Check your API key (top right)."}));
        setBusy(false);
        return;
      }
      const toolCall = d1.content && d1.content.find(c => c.type === "tool_use");

      if (toolCall && toolCall.name === "update_plan") {
        const count = applyChanges(toolCall.input.changes);
        const r2 = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST", headers: ANTHROPIC_HEADERS(apiKey),
          body: JSON.stringify({
            model:"claude-sonnet-4-20250514", max_tokens:1024, system:sysPrompt(), tools:[UPDATE_TOOL],
            messages: apiMsgs.concat(
              {role:"assistant", content:d1.content},
              {role:"user", content:[{type:"tool_result", tool_use_id:toolCall.id, content:"Done — " + count + " session(s) updated."}]}
            ),
          }),
        });
        const d2  = await r2.json();
        const txt = d2.content ? d2.content.filter(c => c.type === "text").map(c => c.text).join("") : "";
        setMsgs(m => m.concat(
          {role:"plan_update", text:toolCall.input.summary, count},
          {role:"assistant",   text:txt},
        ));
      } else {
        const txt = d1.content ? d1.content.filter(c => c.type === "text").map(c => c.text).join("") : "Sorry, no response.";
        setMsgs(m => m.concat({role:"assistant", text:txt}));
      }
    } catch(e) {
      console.error(e);
      setMsgs(m => m.concat({role:"assistant", text:"Connection error. Please try again."}));
    }
    setBusy(false);
  };

  const quick = ["How's my training going?","Make next Sunday's run easier","I'm tired this week — adjust the plan","Can I still hit sub-2h with 2 sessions/week?"];

  return (
    <div className="max-w-lg mx-auto p-4">
      <div className="pt-4 mb-4 flex justify-between items-start">
        <div>
          <h2 className="text-xl font-bold">AI Coach</h2>
          <p className="text-xs text-slate-500">Powered by Claude · can update your plan directly</p>
        </div>
        <button onClick={clearChat}
          className="text-xs text-slate-500 hover:text-slate-300 px-2 py-1 rounded transition-colors mt-1">
          Clear chat
        </button>
      </div>

      {!apiKey && (
        <button onClick={openApiKey}
          className="w-full mb-4 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs text-amber-200 flex gap-2 items-center text-left hover:bg-amber-500/15 transition-colors">
          <Key size={15} className="flex-shrink-0"/>
          <span>No API key set — tap here to add your Claude API key before chatting with the coach.</span>
        </button>
      )}

      <div className="bg-slate-800 rounded-2xl overflow-hidden border border-slate-700">
        <div className="overflow-y-auto p-4 space-y-3" style={{height:"calc(100vh - 310px)", minHeight:280}}>
          {msgs.map((m, i) => {
            if (m.role === "plan_update") return (
              <div key={i} className="flex justify-center my-1">
                <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl px-4 py-2.5 text-xs text-center max-w-xs">
                  <span className="text-emerald-300 font-semibold">Plan updated</span>
                  <span className="block text-emerald-400/70 mt-0.5">{m.text}</span>
                </div>
              </div>
            );
            const isUser  = m.role === "user";
            const wrapCls = "flex " + (isUser ? "justify-end" : "justify-start");
            const bubbleCls = "max-w-xs rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap "
              + (isUser ? "bg-orange-500 text-white rounded-br-sm" : "bg-slate-700 text-slate-100 rounded-bl-sm");
            return (
              <div key={i} className={wrapCls}>
                <div className={bubbleCls}>{m.text}</div>
              </div>
            );
          })}
          {busy && (
            <div className="flex justify-start">
              <div className="bg-slate-700 rounded-2xl rounded-bl-sm px-5 py-3.5">
                <Loader size={16} className="text-orange-400 animate-spin"/>
              </div>
            </div>
          )}
          {msgs.length <= 1 && !busy && (
            <div className="flex flex-wrap gap-2 mt-2">
              {quick.map((q, i) => (
                <button key={i} onClick={() => setInput(q)}
                  className="bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 text-xs px-3 py-2 rounded-full transition-colors">
                  {q}
                </button>
              ))}
            </div>
          )}
          <div ref={endRef}/>
        </div>
        <div className="border-t border-slate-700 p-3 flex gap-2">
          <input type="text" value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) send(); }}
            placeholder="Ask your coach..."
            className="flex-1 bg-slate-700 border border-slate-600 rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-orange-400"/>
          <button onClick={send} disabled={!input.trim() || busy}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-4 rounded-xl transition-colors flex items-center">
            <ChevronRight size={18}/>
          </button>
        </div>
      </div>
    </div>
  );
}

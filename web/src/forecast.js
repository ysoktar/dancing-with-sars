// Short-range probabilistic forecast for an irregular radar time series.
//
// Model: damped-trend exponential smoothing, parameters chosen by one-step
// error; prediction intervals by bootstrapping one-step residuals through the
// model recursion (so uncertainty grows with the horizon).
// Skill is measured honestly with a rolling-origin backtest against the
// naive "same as last pass" forecast.

const DAY = 86400000;

export function theilSen(x, y) {
  const s = [];
  for (let i = 0; i < x.length; i++) for (let j = i + 1; j < x.length; j++) if (x[j] !== x[i]) s.push((y[j] - y[i]) / (x[j] - x[i]));
  s.sort((a, b) => a - b);
  const slope = s.length ? s[Math.floor(s.length / 2)] : 0;
  const ic = x.map((xi, i) => y[i] - slope * xi).sort((a, b) => a - b);
  return { slope, icpt: ic[Math.floor(ic.length / 2)] };
}

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); const k = (s.length - 1) * p, f = Math.floor(k); return s[f] + (s[Math.min(s.length - 1, f + 1)] - s[f]) * (k - f); };

export const MIN_POINTS = 8;

// Damped-trend exponential smoothing (Gardner & McKenzie). Passes are treated
// as equally spaced steps (NISAR repeats every 12 days).
function holt(y, a, b, phi) {
  let l = y[0], t = y.length > 1 ? y[1] - y[0] : 0;
  const res = [];
  for (let i = 1; i < y.length; i++) {
    const f = l + phi * t;
    res.push(y[i] - f);
    const l2 = a * y[i] + (1 - a) * f;
    t = b * (l2 - l) + (1 - b) * phi * t;
    l = l2;
  }
  return { l, t, res };
}
const fc = (l, t, phi, h) => { let s = 0, p = 1; for (let i = 1; i <= h; i++) { p *= phi; s += p; } return l + s * t; };

function fitHolt(y) {
  let best = null;
  for (const a of [0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) for (const b of [0.05, 0.15, 0.3]) for (const phi of [0.7, 0.85, 0.95]) {
    const m = holt(y, a, b, phi);
    const sse = m.res.slice(2).reduce((s, v) => s + v * v, 0);
    if (!best || sse < best.sse) best = { a, b, phi, sse, ...m };
  }
  return best;
}

/**
 * @param {number[]} times  ms timestamps (one per pass)
 * @param {number[]} values
 */
export function forecast(times, values, { steps = 3, stepDays = 12, B = 600, lo = -Infinity, hi = Infinity } = {}) {
  const n = times.length;
  if (n < MIN_POINTS) return null;
  const clip = (v) => Math.min(hi, Math.max(lo, v));
  const m = fitHolt(values);
  const resid = m.res.slice(1);
  const r = rng(12345);
  const sims = Array.from({ length: steps }, () => []);
  for (let b = 0; b < B; b++) {
    let l = m.l, t = m.t;
    for (let h = 0; h < steps; h++) {
      const f = l + m.phi * t;
      const y = f + resid[Math.floor(r() * resid.length)];
      sims[h].push(clip(y));
      const l2 = m.a * y + (1 - m.a) * f;
      t = m.b * (l2 - l) + (1 - m.b) * m.phi * t;
      l = l2;
    }
  }
  const lastT = times[n - 1];
  const future = sims.map((s, h) => ({
    t: lastT + stepDays * (h + 1) * DAY,
    mid: clip(fc(m.l, m.t, m.phi, h + 1)),
    p10: q(s, 0.1), p90: q(s, 0.9), p025: q(s, 0.025), p975: q(s, 0.975),
  }));

  // rolling-origin backtest: one-step-ahead forecasts of the last k passes from the passes before each
  const k = Math.min(5, n - 6);
  const errT = [], errP = [];
  let inside = 0;
  for (let h = n - k; h < n; h++) {
    const ys = values.slice(0, h);
    const mm = fitHolt(ys);
    const pred = fc(mm.l, mm.t, mm.phi, 1);
    const rs = mm.res.slice(1);
    errT.push(Math.abs(values[h] - pred));
    errP.push(Math.abs(values[h] - ys[ys.length - 1]));
    if (values[h] >= pred + q(rs, 0.1) && values[h] <= pred + q(rs, 0.9)) inside++;
  }
  const mae = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const maeT = mae(errT), maeP = mae(errP);
  return {
    model: { alpha: m.a, beta: m.b, phi: m.phi },
    trendPerMonth: m.t * (30.44 / stepDays),
    future,
    backtest: { n: k, maeTrend: maeT, maePersist: maeP, skill: maeP > 0 ? 1 - maeT / maeP : 0, coverage80: inside / k },
  };
}

/** How much a radar-only forecast can be trusted, per change type. */
export const FORECASTABILITY = {
  flood: { level: 'limited', text: 'Flood extent depends on upstream rainfall and terrain, and neither is in this series. Read this as "if the current trend continues", not as a flood forecast. A real one needs rainfall (GPM) and a hydrological model.' },
  wetland: { level: 'limited', text: 'The flood pulse is seasonal and driven by rain far upstream. Less than a year of data cannot capture the seasonal cycle, so the trend is only a short-range continuation.' },
  agriculture: { level: 'moderate', text: 'Crop calendars repeat every year. With several years of data a seasonal model would work well. With under one year this is trend extrapolation only, and it breaks at planting or harvest.' },
  groundwater: { level: 'moderate', text: 'Here the backscatter tracks irrigation and crops, not ground sinking. Subsidence itself is slow and steady and suits trend forecasting, but it must come from a GUNW interferogram time series.' },
  deforestation: { level: 'limited', text: 'Clearing is a human decision. A trend only describes a business-as-usual scenario; policy, prices and enforcement can change it overnight.' },
  glacier: { level: 'moderate', text: 'Ice flow is physically smooth over weeks, so short-range forecasts of motion are realistic (best from GOFF velocities). Backscatter jumps at melt onset and freeze-up, so expect breaks at season changes.' },
  volcano: { level: 'none', text: 'The timing of an eruption cannot be reliably predicted. The line below only extends the backscatter trend and says nothing about the next eruption. Monitoring deformation (GUNW) is useful for warnings, not for exact timing.' },
  wildfire: { level: 'moderate', text: 'Post-fire recovery is slow and fairly steady, but snow cover from October changes the signal regardless of vegetation.' },
};

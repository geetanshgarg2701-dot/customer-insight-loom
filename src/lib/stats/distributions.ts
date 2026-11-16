/**
 * Distribution functions the stats engine needs and DuckDB 1.4.3 lacks.
 * Plain TypeScript, no dependency. Every function is tested against
 * published reference values in distributions.test.ts.
 */

const LANCZOS_G = 7;
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural log of the gamma function, Lanczos approximation, g = 7, n = 9. */
export function lnGamma(x: number): number {
  if (!(x > 0)) throw new RangeError("lnGamma needs a positive argument.");
  if (x < 0.5) {
    // Reflection formula.
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  }
  const z = x - 1;
  let a = LANCZOS[0];
  const t = z + LANCZOS_G + 0.5;
  for (let i = 1; i < LANCZOS.length; i++) a += LANCZOS[i] / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

const EPS = 1e-15;
const FPMIN = 1e-300;
const MAX_ITER = 10_000;

function gammaPrefactor(a: number, x: number): number {
  return Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

/** Series for the lower regularized gamma P, best when x is below a + 1. */
function gammaSeries(a: number, x: number): number {
  let ap = a;
  let del = 1 / a;
  let sum = del;
  for (let n = 0; n < MAX_ITER; n++) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * gammaPrefactor(a, x);
}

/** Continued fraction for the upper regularized gamma Q, modified Lentz, best when x is above a + 1. */
function gammaContinuedFraction(a: number, x: number): number {
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < MAX_ITER; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return gammaPrefactor(a, x) * h;
}

function checkGammaArgs(a: number, x: number) {
  if (!(a > 0) || !(x >= 0)) throw new RangeError("Incomplete gamma needs a > 0 and x >= 0.");
}

/** Lower regularized incomplete gamma P of a and x. */
export function regularizedGammaP(a: number, x: number): number {
  checkGammaArgs(a, x);
  if (x === 0) return 0;
  return x < a + 1 ? gammaSeries(a, x) : 1 - gammaContinuedFraction(a, x);
}

/** Upper regularized incomplete gamma Q of a and x, computed directly so tails keep precision. */
export function regularizedGammaQ(a: number, x: number): number {
  checkGammaArgs(a, x);
  if (x === 0) return 1;
  return x < a + 1 ? 1 - gammaSeries(a, x) : gammaContinuedFraction(a, x);
}

/** Standard normal CDF. Uses erfc of x over root 2 equals Q of one half and x squared over 2. */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return Number.NaN;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  const tail = 0.5 * regularizedGammaQ(0.5, (x * x) / 2);
  return x < 0 ? tail : 1 - tail;
}

function lowerQuantile(p: number): number {
  // Starting point: Abramowitz and Stegun 26.2.23, absolute error below 4.5e-4.
  const t = Math.sqrt(-2 * Math.log(p));
  let x =
    -(t - (2.515517 + 0.802853 * t + 0.010328 * t * t) /
      (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t));
  // Halley steps against the accurate CDF bring it to machine precision.
  for (let i = 0; i < 8; i++) {
    const e = normalCdf(x) - p;
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    const step = u / (1 + (x * u) / 2);
    x -= step;
    if (Math.abs(step) <= 1e-16 * Math.max(1, Math.abs(x))) break;
  }
  return x;
}

/** Inverse of the standard normal CDF, for p strictly between 0 and 1. */
export function normalQuantile(p: number): number {
  if (!(p > 0 && p < 1)) throw new RangeError("normalQuantile needs p strictly between 0 and 1.");
  if (p === 0.5) return 0;
  return p < 0.5 ? lowerQuantile(p) : -lowerQuantile(1 - p);
}

/** Probability that a chi square variable with df degrees of freedom exceeds x. */
export function chiSquareSurvival(x: number, df: number): number {
  if (!(df > 0)) throw new RangeError("chiSquareSurvival needs df > 0.");
  if (!(x > 0)) return 1;
  return regularizedGammaQ(df / 2, x / 2);
}

function checkBinomial(n: number, p: number) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("Binomial n must be a whole number >= 0.");
  if (!(p >= 0 && p <= 1)) throw new RangeError("Binomial p must be between 0 and 1.");
}

/** P of X at most k for X binomial with n trials and success probability p. */
export function binomialCdf(k: number, n: number, p: number): number {
  checkBinomial(n, p);
  const kk = Math.floor(k);
  if (kk < 0) return 0;
  if (kk >= n) return 1;
  if (p === 0) return 1;
  if (p === 1) return 0;
  const lnN = lnGamma(n + 1);
  const lp = Math.log(p);
  const lq = Math.log1p(-p);
  let sum = 0;
  for (let i = 0; i <= kk; i++) {
    sum += Math.exp(lnN - lnGamma(i + 1) - lnGamma(n - i + 1) + i * lp + (n - i) * lq);
  }
  return Math.min(1, sum);
}

/**
 * Central range holding at least `level` of a binomial distribution:
 * low is the smallest k with CDF at least the lower tail, high the smallest k
 * with CDF at least 1 minus the lower tail.
 */
export function binomialCentralRange(
  n: number,
  p: number,
  level: number,
): { low: number; high: number } {
  checkBinomial(n, p);
  if (!(level > 0 && level < 1)) throw new RangeError("level must be strictly between 0 and 1.");
  const tail = (1 - level) / 2;
  let low = -1;
  let high = -1;
  for (let k = 0; k <= n && high < 0; k++) {
    const c = binomialCdf(k, n, p);
    if (low < 0 && c >= tail) low = k;
    if (c >= 1 - tail) high = k;
  }
  return { low, high };
}

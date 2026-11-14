/** Descriptive Wilson score interval for a binomial pass-rate estimate. */
export function wilsonInterval(passed, total) {
  if (!Number.isInteger(passed) || !Number.isInteger(total) || passed < 0 || total < 0 || passed > total) {
    throw new RangeError('Wilson interval counts must satisfy 0 <= passed <= total.');
  }
  if (total === 0) return { lower: 0, upper: 0 };
  const z = 1.959963984540054; // 95% z-score
  const p = passed / total;
  const denom = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denom;
  const halfWidth = (z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total))) / denom;
  return { lower: Math.max(0, center - halfWidth), upper: Math.min(1, center + halfWidth) };
}

export function intervalsOverlap(a, b) {
  return a.lower <= b.upper && b.lower <= a.upper;
}

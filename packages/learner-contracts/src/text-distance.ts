/** UTF-16 code-unit edit distance shared by platform quiz graders. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = Array.from({ length: n + 1 }, (_, i) => i);
  const curr = new Array<number>(n + 1);
  for (let i = 1; i <= m; i += 1) {
    curr[0] = i;
    const ac = a[i - 1];
    for (let j = 1; j <= n; j += 1) {
      curr[j] = ac === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], curr[j - 1], prev[j]);
    }
    for (let j = 0; j <= n; j += 1) prev[j] = curr[j];
  }
  return prev[n];
}

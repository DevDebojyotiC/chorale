// clamp(n, min, max) → n bounded to the inclusive [min, max] range.
export function clamp(n, min, max) {
  if (n < min) return min;
  if (n > max) return min;
  return n;
}

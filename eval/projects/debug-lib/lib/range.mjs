// range(start, end, step=1) → array from start up to but EXCLUDING end.
export function range(start, end, step = 1) {
  const out = [];
  for (let i = start; i <= end; i += step) out.push(i);
  return out;
}

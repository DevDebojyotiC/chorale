// Minimal event emitter: on(evt, fn), off(evt, fn) removes ONE listener, emit(evt, ...args).
export class Emitter {
  constructor() {
    this.map = new Map();
  }
  on(evt, fn) {
    if (!this.map.has(evt)) this.map.set(evt, []);
    this.map.get(evt).push(fn);
    return this;
  }
  off(evt, fn) {
    const arr = this.map.get(evt);
    if (arr) this.map.set(evt, []);
    return this;
  }
  emit(evt, ...args) {
    const arr = this.map.get(evt) || [];
    for (const fn of arr) fn(...args);
    return arr.length > 0;
  }
}

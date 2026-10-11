// shared/rng.js
// 32-bit deterministic Mulberry32 PRNG for pure 60 Hz simulation

export function mulberry32(seed = 1990) {
  let s = (seed >>> 0) || 1;
  return {
    // Returns float in [0, 1)
    next() {
      let t = (s += 0x6D2B79F5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    // Returns integer in [min, max] inclusive
    range(min, max) {
      return min + Math.floor(this.next() * (max - min + 1));
    },
    getState() {
      return s;
    },
    setState(state) {
      s = state >>> 0;
    }
  };
}

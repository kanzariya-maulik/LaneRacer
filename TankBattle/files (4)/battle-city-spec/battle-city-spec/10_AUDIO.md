# 10 — Audio (NES-style, Web Audio synthesis)

No audio files. Everything is synthesised so it works offline on a LAN.

## 1. Setup [EXACT requirement]
- Create `AudioContext` on first user gesture (`click`/`keydown`); until then queue nothing.
- Master gain 0.4–0.5. A `muted` toggle (`M` key).
- Channels emulated: **2 pulse** (square wave, duty 12.5/25/50 %), **1 triangle**, **1 noise**. Use `OscillatorNode` with custom `PeriodicWave` for non-50 % duty; triangle = `type:'triangle'`; noise = looping random `AudioBuffer` through filters.
- Keep a **voice limit** (max ~8 concurrent) and reuse nodes.

## 2. Sound event list
| Event | When | Recipe (summary) |
|---|---|---|
| `stage_start` | STAGE_INTRO | short upbeat 4-bar jingle (pulse + triangle bass) ≈ 3–4 s |
| `move_idle` | player tank alive, not moving | low continuous engine rumble: triangle ~55 Hz + faint noise, volume 0.05 |
| `move_active` | player tank moving | same but pulse-modulated; pitch up ~15 % (slightly faster tremolo 12 Hz) |
| `fire` | player fires | pulse 25 %: 880→330 Hz exp ramp in 90 ms, gain 0.25 |
| `hit_brick` | bullet hits brick | noise burst 70 ms lowpass 1.2 kHz + pulse 150 Hz blip |
| `hit_steel` | bullet hits steel/edge | pulse 50 % 1.8 kHz → 1.2 kHz, 60 ms ("ting") |
| `enemy_explode` | enemy destroyed | noise 350 ms, lowpass sweep 1.5 kHz→100 Hz, gain 0.4 |
| `player_explode` | player destroyed | noise 600 ms, lowpass 900→60 Hz + triangle 90→40 Hz thump |
| `eagle_explode` | base destroyed | like player_explode but 900 ms + descending 3-note sad motif |
| `powerup_appear` | item spawns | quick rising 3-note pulse arpeggio |
| `powerup_pickup` | taken | bright 4-note up arpeggio, 150 ms |
| `life_up` | 1UP/extra life | ascending 6-note jingle |
| `pause` | pause/unpause | two short blips (880 Hz, 660 Hz) |
| `tally_tick` | each count increment | 40 ms pulse blip 1.2 kHz |
| `tally_done` | tally end | 2-note chime |
| `game_over` | game over text rises | slow descending 5-note motif, triangle + pulse |
| `bullet_cancel` | bullet vs bullet | tiny noise tick 30 ms |
| `ice_slide` | optional | none |
| `shield` | optional | none |

## 3. Reusable synth helpers
```js
class Chip {
  constructor(ctx, master){ this.ctx=ctx; this.out=master; this.noiseBuf=this.makeNoise(); }
  makeNoise(){ const b=this.ctx.createBuffer(1,this.ctx.sampleRate,this.ctx.sampleRate);
    const d=b.getChannelData(0); for(let i=0;i<d.length;i++) d[i]=Math.random()*2-1; return b; }
  pulse(freq, dur, {duty=0.5, gain=0.2, slideTo=null, when=0}={}) {
    const t=this.ctx.currentTime+when, o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.setPeriodicWave(this.duty(duty)); o.frequency.setValueAtTime(freq,t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(slideTo,t+dur);
    g.gain.setValueAtTime(gain,t); g.gain.linearRampToValueAtTime(0,t+dur);
    o.connect(g).connect(this.out); o.start(t); o.stop(t+dur);
  }
  duty(d){ // PeriodicWave for pulse with duty d (cache it)
    const N=32, re=new Float32Array(N), im=new Float32Array(N);
    for(let n=1;n<N;n++) im[n]=(2/(n*Math.PI))*Math.sin(n*Math.PI*d);
    return this.ctx.createPeriodicWave(re, im);
  }
  triangle(freq, dur, {gain=0.25, when=0}={}) { /* OscillatorNode type 'triangle' */ }
  noise(dur, {lp=1500, lpEnd=100, gain=0.3, when=0}={}) { /* AudioBufferSource loop + BiquadFilter lowpass sweep */ }
  seq(notes, tempo){ /* schedule [{f,len,ch}] for jingles */ }
}
```
(The agent should implement the omitted bodies analogously.)

## 4. Engine loop sound details [EXACT feel]
- Original has a constant **low engine drone** while any player tank is alive, which **changes pitch/pattern when moving**. Implement two looping voices; crossfade when `anyPlayerMoving` changes.
- Stop engine sounds during pause, tally, game over.

## 5. Music
- Original gameplay has **no background music**, only sound effects and the short stage/tally/game-over jingles. **Keep it that way** [EXACT].

## 6. Jingle composition guide (since we can't copy the original melody)
- Stage start: C–E–G–C (pulse 25 %) over an A-minor triangle bass, tempo ~ 150 bpm, 8 notes. Write our own melody; don't copy Namco's.
- Game over: descending minor line (E–D–C–A) over 3 s with long final note.

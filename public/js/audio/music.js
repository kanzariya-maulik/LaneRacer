// Interactive multi-track Web Audio Music Engine for LaneRacer.
// Synthesizes racing soundtracks in real-time with zero network/file dependencies.

export const TRACKS = {
    off: { id: 'off', name: 'Off (Engine Only)' },
    synthwave: { id: 'synthwave', name: 'Synthwave Velocity', bpm: 128 },
    eurobeat: { id: 'eurobeat', name: 'Eurobeat Rush', bpm: 155 },
    cyberpunk: { id: 'cyberpunk', name: 'Cyberpunk Overdrive', bpm: 140 },
    arcade: { id: 'arcade', name: '8-Bit Arcade Sprint', bpm: 136 },
    lofi: { id: 'lofi', name: 'Sunset Cruise', bpm: 92 },
};

const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};

export class MusicPlayer {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.musicGain = null;
        this.currentTrack = store.get('lanrace.music') || 'off';
        this.volume = Math.min(1, Math.max(0, +(store.get('lanrace.musicVolume') ?? 50) / 100));
        this.isPlaying = false;
        this.stepIndex = 0;
        this.nextNoteTime = 0;
        this.timerID = null;
        this.noiseBuffer = null;
    }

    init(ctx, masterNode) {
        this.ctx = ctx;
        this.master = masterNode;
        this.musicGain = ctx.createGain();
        this.musicGain.gain.value = this.currentTrack === 'off' ? 0 : this.volume * 0.45;
        this.musicGain.connect(masterNode);
        this.createNoiseBuffer();

        if (this.currentTrack !== 'off') {
            this.play(this.currentTrack);
        }
    }

    createNoiseBuffer() {
        if (!this.ctx) return;
        const bufferSize = this.ctx.sampleRate * 2;
        this.noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const output = this.noiseBuffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            output[i] = Math.random() * 2 - 1;
        }
    }

    setVolume(v) {
        this.volume = Math.min(1, Math.max(0, v));
        store.set('lanrace.musicVolume', Math.round(this.volume * 100));
        if (this.musicGain && this.ctx) {
            const effective = this.currentTrack === 'off' ? 0 : this.volume * 0.45;
            this.musicGain.gain.setTargetAtTime(effective, this.ctx.currentTime, 0.05);
        }
    }

    setTrack(trackId) {
        if (!TRACKS[trackId]) trackId = 'off';
        this.currentTrack = trackId;
        store.set('lanrace.music', trackId);

        if (trackId === 'off') {
            this.stop();
        } else {
            this.play(trackId);
        }
    }

    play(trackId) {
        if (!this.ctx || this.ctx.state !== 'running') return;
        if (!TRACKS[trackId] || trackId === 'off') {
            this.stop();
            return;
        }
        this.currentTrack = trackId;
        this.stop();
        this.isPlaying = true;
        this.stepIndex = 0;
        this.nextNoteTime = this.ctx.currentTime + 0.05;
        if (this.musicGain) {
            this.musicGain.gain.setTargetAtTime(this.volume * 0.45, this.ctx.currentTime, 0.05);
        }
        this.schedule();
    }

    stop() {
        this.isPlaying = false;
        if (this.timerID) {
            clearTimeout(this.timerID);
            this.timerID = null;
        }
        if (this.musicGain && this.ctx) {
            this.musicGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
        }
    }

    schedule() {
        if (!this.isPlaying || !this.ctx || this.ctx.state !== 'running') return;
        const bpm = TRACKS[this.currentTrack]?.bpm || 128;
        const secondsPer16th = 60 / bpm / 4;

        while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
            this.playStep(this.currentTrack, this.stepIndex, this.nextNoteTime);
            this.nextNoteTime += secondsPer16th;
            this.stepIndex = (this.stepIndex + 1) % 64; // 4-bar loop (64 16th notes)
        }

        this.timerID = setTimeout(() => this.schedule(), 50);
    }

    playStep(track, step, t) {
        switch (track) {
            case 'synthwave':
                this.stepSynthwave(step, t);
                break;
            case 'eurobeat':
                this.stepEurobeat(step, t);
                break;
            case 'cyberpunk':
                this.stepCyberpunk(step, t);
                break;
            case 'arcade':
                this.stepArcade(step, t);
                break;
            case 'lofi':
                this.stepLofi(step, t);
                break;
        }
    }

    // --- INSTRUMENT SYNTHESIZERS ---
    kick(t, freq = 150, decay = 0.25, gainVal = 0.8) {
        if (!this.ctx) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.frequency.setValueAtTime(freq, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + decay);
        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
        osc.connect(gain).connect(this.musicGain);
        osc.start(t);
        osc.stop(t + decay);
    }

    snare(t, duration = 0.18, gainVal = 0.5) {
        if (!this.ctx || !this.noiseBuffer) return;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(1000, t);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
        noise.connect(filter).connect(gain).connect(this.musicGain);
        noise.start(t);
        noise.stop(t + duration);
    }

    hihat(t, open = false, gainVal = 0.2) {
        if (!this.ctx || !this.noiseBuffer) return;
        const noise = this.ctx.createBufferSource();
        noise.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(8000, t);
        filter.Q.value = 3;
        const gain = this.ctx.createGain();
        const dur = open ? 0.15 : 0.04;
        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        noise.connect(filter).connect(gain).connect(this.musicGain);
        noise.start(t);
        noise.stop(t + dur);
    }

    bass(t, freq, dur = 0.18, wave = 'sawtooth', filterFreq = 800, gainVal = 0.4) {
        if (!this.ctx || !freq) return;
        const osc = this.ctx.createOscillator();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, t);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(filterFreq, t);
        filter.frequency.exponentialRampToValueAtTime(200, t + dur);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(filter).connect(gain).connect(this.musicGain);
        osc.start(t);
        osc.stop(t + dur);
    }

    lead(t, freq, dur = 0.2, wave = 'sawtooth', gainVal = 0.25) {
        if (!this.ctx || !freq) return;
        const osc = this.ctx.createOscillator();
        osc.type = wave;
        osc.frequency.setValueAtTime(freq, t);
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2500, t);
        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(gainVal, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
        osc.connect(filter).connect(gain).connect(this.musicGain);
        osc.start(t);
        osc.stop(t + dur);
    }

    // --- TRACK SEQUENCES ---
    stepSynthwave(step, t) {
        // Four on the floor kick
        if (step % 4 === 0) this.kick(t, 140, 0.22, 0.7);
        // Snare on 4 and 12
        if (step % 16 === 4 || step % 16 === 12) this.snare(t, 0.2, 0.45);
        // 16th note hi-hats
        this.hihat(t, step % 8 === 4, step % 2 === 0 ? 0.15 : 0.08);

        // Bassline (Am - F - C - G)
        const bar = Math.floor(step / 16);
        const rootNotes = [110, 87.31, 130.81, 98]; // A2, F2, C3, G2
        const root = rootNotes[bar % 4];
        if (step % 2 === 0) {
            const oct = (step % 4 === 2) ? 2 : 1;
            this.bass(t, (root / 2) * oct, 0.12, 'sawtooth', 1200, 0.35);
        }

        // Arpeggiated Lead
        const arpA = [220, 261.63, 329.63, 440, 523.25, 440, 329.63, 261.63];
        const arpF = [174.61, 220, 261.63, 349.23, 440, 349.23, 261.63, 220];
        const arpC = [261.63, 329.63, 392, 523.25, 659.25, 523.25, 392, 329.63];
        const arpG = [196, 246.94, 293.66, 392, 493.88, 392, 293.66, 246.94];
        const arps = [arpA, arpF, arpC, arpG];
        const activeArp = arps[bar % 4];
        if (step % 2 === 1) {
            const note = activeArp[(step % 8)];
            this.lead(t, note, 0.15, 'sawtooth', 0.18);
        }
    }

    stepEurobeat(step, t) {
        // Fast driving kick on 0, 4, 8, 12
        if (step % 4 === 0) this.kick(t, 160, 0.18, 0.75);
        // Snare with punch on 4, 12
        if (step % 16 === 4 || step % 16 === 12) this.snare(t, 0.15, 0.5);
        // Offbeat open hi-hat
        if (step % 4 === 2) this.hihat(t, true, 0.25);
        else this.hihat(t, false, 0.08);

        // Fast Octave Bass (Em - C - D - Bm)
        const bar = Math.floor(step / 16);
        const roots = [82.41, 65.41, 73.42, 61.74]; // E2, C2, D2, B1
        const r = roots[bar % 4];
        const isHigh = (step % 2 === 1);
        this.bass(t, isHigh ? r * 2 : r, 0.1, 'square', 1400, 0.38);

        // Eurobeat Brass Lead
        const leadEm = [329.63, 0, 392, 493.88, 0, 440, 392, 329.63];
        const note = leadEm[step % 8];
        if (note > 0 && (step % 2 === 0)) {
            this.lead(t, note, 0.2, 'sawtooth', 0.25);
        }
    }

    stepCyberpunk(step, t) {
        // Heavy industrial sub kick
        if (step % 4 === 0) this.kick(t, 180, 0.3, 0.85);
        if (step % 16 === 8) this.snare(t, 0.25, 0.4);
        if (step % 2 === 0) this.hihat(t, false, 0.12);

        // Dark industrial rolling bass (Dm)
        const dBass = [73.42, 73.42, 146.83, 73.42, 110, 73.42, 146.83, 130.81];
        const note = dBass[step % 8];
        this.bass(t, note, 0.12, 'sawtooth', 700 + (step % 8) * 100, 0.4);

        // Acid Synth Stabs
        if (step % 16 === 3 || step % 16 === 9 || step % 16 === 14) {
            this.lead(t, 293.66 * (step % 2 ? 1.5 : 1), 0.18, 'square', 0.28);
        }
    }

    stepArcade(step, t) {
        // Retro 8-bit chip groove
        if (step % 8 === 0 || step % 8 === 6) this.kick(t, 130, 0.15, 0.6);
        if (step % 8 === 4) this.snare(t, 0.12, 0.35);
        if (step % 2 === 0) this.hihat(t, false, 0.1);

        // Chiptune Square Bass (C - Am - F - G)
        const bar = Math.floor(step / 16);
        const roots = [130.81, 110, 87.31, 98];
        this.bass(t, roots[bar % 4], 0.1, 'square', 2000, 0.3);

        // Rapid 8-bit melody
        const mel = [523.25, 587.33, 659.25, 783.99, 659.25, 587.33, 523.25, 392];
        this.lead(t, mel[step % 8], 0.08, 'square', 0.2);
    }

    stepLofi(step, t) {
        // Slow relaxed chill beat
        if (step % 8 === 0) this.kick(t, 100, 0.2, 0.5);
        if (step % 8 === 4) this.snare(t, 0.15, 0.25);
        if (step % 4 === 2) this.hihat(t, false, 0.06);

        // Soft sub bass
        const bar = Math.floor(step / 16);
        const roots = [65.41, 87.31, 73.42, 98]; // C2, F2, D2, G2
        if (step % 4 === 0) {
            this.bass(t, roots[bar % 4], 0.35, 'sine', 300, 0.35);
        }

        // Electric piano chords
        if (step % 8 === 0) {
            const chords = [
                [261.63, 329.63, 392, 493.88], // Cmaj7
                [174.61, 220, 261.63, 329.63], // Fmaj7
                [146.83, 174.61, 220, 261.63], // Dm7
                [196, 246.94, 293.66, 349.23], // G7
            ];
            const ch = chords[bar % 4];
            ch.forEach(freq => this.lead(t, freq, 0.4, 'triangle', 0.1));
        }
    }
}

export const music = new MusicPlayer();

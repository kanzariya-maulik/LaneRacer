// Pure Web Audio API Retro Chiptune Sound Synthesizer
// Zero external asset files needed — 100% synthesized procedural audio

export class RetroTankAudio {
    constructor() {
        this.ctx = null;
        this.master = null;
        this.engineOsc = null;
        this.engineGain = null;
        this.isMuted = false;
        this.alarmInterval = null;
    }

    unlock() {
        if (this.ctx) return;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        this.ctx = new AudioCtx();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.45;
        this.master.connect(this.ctx.destination);

        this.startEngineHum();
    }

    setMuted(muted) {
        this.isMuted = muted;
        if (this.master) {
            this.master.gain.value = muted ? 0 : 0.45;
        }
    }

    // Continuous procedural engine rumble
    startEngineHum() {
        if (!this.ctx || this.engineOsc) return;
        try {
            this.engineOsc = this.ctx.createOscillator();
            this.engineGain = this.ctx.createGain();

            this.engineOsc.type = 'sawtooth';
            this.engineOsc.frequency.setValueAtTime(38, this.ctx.currentTime); // Low idle hum
            this.engineGain.gain.setValueAtTime(0.04, this.ctx.currentTime);

            // Lowpass filter to muffle harsh harmonics
            const filter = this.ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.setValueAtTime(140, this.ctx.currentTime);

            this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master);
            this.engineOsc.start();
        } catch (e) {}
    }

    updateEngine(isMoving) {
        if (!this.ctx || !this.engineOsc || !this.engineGain) return;
        const targetFreq = isMoving ? 68 : 38;
        const targetVol = isMoving ? 0.08 : 0.04;
        this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.08);
        this.engineGain.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.08);
    }

    // Standard cannon shell fire sound
    playFire() {
        if (!this.ctx || this.isMuted) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(460, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(110, this.ctx.currentTime + 0.12);

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.12);

        osc.connect(gain).connect(this.master);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.12);
    }

    // Thrown bomb toss whoosh (Triggered on ENTER)
    playBombThrow() {
        if (!this.ctx || this.isMuted) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(580, this.ctx.currentTime + 0.16);

        gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.16);

        osc.connect(gain).connect(this.master);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.16);
    }

    // Massive bomb detonation AOE blast
    playBombBlast() {
        if (!this.ctx || this.isMuted) return;
        // 1. Heavy bass sub-drop
        const subOsc = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        subOsc.type = 'sine';
        subOsc.frequency.setValueAtTime(150, this.ctx.currentTime);
        subOsc.frequency.exponentialRampToValueAtTime(25, this.ctx.currentTime + 0.7);
        subGain.gain.setValueAtTime(0.6, this.ctx.currentTime);
        subGain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.7);
        subOsc.connect(subGain).connect(this.master);
        subOsc.start();
        subOsc.stop(this.ctx.currentTime + 0.7);

        // 2. White noise blast rumble
        this.playExplosion(true);
    }

    // 8-bit noise explosion for tank shell blasts & wall crumbles
    playExplosion(isBig = false) {
        if (!this.ctx || this.isMuted) return;
        const dur = isBig ? 0.65 : 0.26;
        const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (data.length * 0.35));
        }

        const src = this.ctx.createBufferSource();
        src.buffer = buf;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(isBig ? 420 : 920, this.ctx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(70, this.ctx.currentTime + dur);

        src.connect(filter).connect(this.master);
        src.start();
    }

    // Steel block clank ricochet
    playSteelClank() {
        if (!this.ctx || this.isMuted) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(300, this.ctx.currentTime + 0.08);

        gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.08);

        osc.connect(gain).connect(this.master);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.08);
    }

    // Two-tone warning siren when Eagle HQ is under attack!
    playEagleAlarm() {
        if (!this.ctx || this.isMuted) return;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, this.ctx.currentTime);
        osc.frequency.setValueAtTime(440, this.ctx.currentTime + 0.16);

        gain.gain.setValueAtTime(0.35, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.32);

        osc.connect(gain).connect(this.master);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.32);
    }

    // Powerup collection arpeggio
    playPowerup() {
        if (!this.ctx || this.isMuted) return;
        const notes = [440, 554, 659, 880];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.06);
            gain.gain.setValueAtTime(0.25, this.ctx.currentTime + idx * 0.06);
            gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + idx * 0.06 + 0.1);
            osc.connect(gain).connect(this.master);
            osc.start(this.ctx.currentTime + idx * 0.06);
            osc.stop(this.ctx.currentTime + idx * 0.06 + 0.1);
        });
    }

    // Victory triumphant fanfare
    playVictory() {
        if (!this.ctx || this.isMuted) return;
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
            const osc = this.ctx.createOscillator();
            const gain = this.ctx.createGain();
            osc.type = 'square';
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime + idx * 0.12);
            gain.gain.setValueAtTime(0.3, this.ctx.currentTime + idx * 0.12);
            gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + idx * 0.12 + 0.25);
            osc.connect(gain).connect(this.master);
            osc.start(this.ctx.currentTime + idx * 0.12);
            osc.stop(this.ctx.currentTime + idx * 0.12 + 0.25);
        });
    }
}

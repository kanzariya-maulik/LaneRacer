// AudioWorklet wrapper around the engine synth (v8.js). One processor per engine voice; parameters are k-rate.
import { V8Synth } from './v8.js';

class V8Processor extends AudioWorkletProcessor {
    static get parameterDescriptors() {
        return [
            { name: 'rpm', defaultValue: 4500, minValue: 0, maxValue: 20000, automationRate: 'k-rate' },
            { name: 'load', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'cut', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
            { name: 'stutter', defaultValue: 0, minValue: 0, maxValue: 60, automationRate: 'k-rate' },
            { name: 'crackle', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
        ];
    }

    constructor(options) {
        super();
        const profile = options?.processorOptions?.profile || 'v10';
        this.synth = new V8Synth(sampleRate, (Math.random() * 4294967295) >>> 0, profile);
        this.p = { rpm: 4500, load: 0, cut: 0, stutter: 0, crackle: 0 };
        this.alive = true;
        this.port.onmessage = (e) => {
            if (e.data === 'stop') this.alive = false;
            else if (typeof e.data === 'object' && e.data.profile) this.synth.setProfile(e.data.profile);
        };
    }

    process(_inputs, outputs, params) {
        const out = outputs[0][0], p = this.p;
        p.rpm += (params.rpm[0] - p.rpm) * 0.35;      // ease across blocks (~8 ms) so shifts don't click
        p.load += (params.load[0] - p.load) * 0.25;
        p.cut = params.cut[0]; p.stutter = params.stutter[0]; p.crackle = params.crackle[0];
        this.synth.render(out, out.length, p);
        return this.alive;
    }
}

registerProcessor('v8', V8Processor);

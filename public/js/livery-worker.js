// Paints team liveries for carModel.js off the main thread (the first one also maps the car's surfaces: ~0.3 s)
import { paintLivery } from './carShape.js';

self.onmessage = ({ data: d }) => {
    const px = paintLivery(d.teamId, d.size);
    self.postMessage({ teamId: d.teamId, pixels: px.buffer }, [px.buffer]);
};

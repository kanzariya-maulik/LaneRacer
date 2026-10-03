// Builds the fine ground grid (scenery.js) off the main thread for game3d.js, so starting a session never freezes on it
import { terrainGround, terrainHeights } from './scenery.js';

self.onmessage = ({ data: d }) => {
    const H = terrainHeights(d.t, d.x0, d.y0, d.w, d.h, d.segs, terrainGround(d.t, d.reach), d.sink, d.carve);
    self.postMessage({ id: d.id, H }, [H.buffer]);
};

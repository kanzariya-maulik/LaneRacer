// Cameras: chase → chase far → T-cam → cockpit, framed as the F1 games. Pure, shared by game3d.js and the node tests.
// Eye points in carShape.js's car frame (x forward, y left, z up, metres). The cockpit eye is inside the helmet: its faces
// point out, so from inside they're culled and the helmet needs no hiding. Calibration knobs: tune by eye in the browser.
export const VIEWS = ['chase', 'far', 'tcam', 'cockpit'];
export const VIEW_NAMES = { chase: 'CHASE', far: 'CHASE FAR', tcam: 'T-CAM', cockpit: 'COCKPIT' };
export const VIEW_FOV = { chase: 60, far: 60, tcam: 75, cockpit: 75 };
// Chase cameras (metres from the car's centre): behind, up, the point looked at ahead and its height. Low and close
// as the F1 games: the rear wing just under the horizon, the car the lower third of the screen
export const CHASE = { chase: { back: 4.6, up: 1.25, ahead: 7.5, lookUp: 0 }, far: { back: 5.2, up: 1.7, ahead: 9, lookUp: 0 } };
export const EYE = { tcam: [0.0, 0, 1.06], cockpit: [0.16, 0, 0.78] }; // T-cam as the F1 games: helmet top at the bottom, halo, wheel and both front tyres
export const EYE_TILT = { tcam: -0.26, cockpit: -0.14 }; // nose down a touch: the road ahead fills the lower frame
export const WHEEL_POS = [0.45, 0, 0.66]; // clear of the cockpit lid (z 0.628)

export const nextView = (v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length];
export const viewOf = (stored) => (VIEWS.includes(stored) ? stored : 'chase');
export const onboard = (v) => v === 'tcam' || v === 'cockpit';
export const wheelAngle = (steer) => Math.max(-1, Math.min(1, steer || 0)) * (Math.PI / 2);
export const toThree = ([x, y, z]) => [x, z, -y];
// Per car: the real model's own markers (carModels.js), the procedural car's values without them
// cockpit: just over the halo's top bar, the wheel's display at the bottom of the screen; T-cam: on the airbox, above
// and behind the helmet (its top, the halo, the wheel and both front tyres in view)
const FROM_EYE = { cockpit: [-0.12, 0, 0.24], tcam: [-0.34, 0, 0.4] };
export const eyeFor = (view, asset) => (asset?.eye ? asset.eye.map((v, k) => v + FROM_EYE[view][k]) : EYE[view]);
export const wheelPosFor = (asset) => asset?.wheelPos || WHEEL_POS;
// Front wheel angles [left, right] for a steering angle (+ = right): anti-Ackermann as an F1 car, the inner wheel turning
// ANTI_ACKERMANN less than the mean and the outer one as much more (high-speed corners load the outer tyre)
const ANTI_ACKERMANN = 0.15;
export const frontSteer = (s) => { const k = ANTI_ACKERMANN * Math.sign(s); return [s * (1 + k), s * (1 - k)]; };

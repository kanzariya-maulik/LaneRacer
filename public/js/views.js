// Onboard cameras: chase → T-cam → cockpit. Pure, shared by game3d.js and the node tests.
// Eye points in carShape.js's car frame (x forward, y left, z up, metres). The cockpit eye is inside the helmet: its faces
// point out, so from inside they're culled and the helmet needs no hiding. Calibration knobs: tune by eye in the browser.
export const VIEWS = ['chase', 'tcam', 'cockpit'];
export const VIEW_NAMES = { chase: 'CHASE', tcam: 'T-CAM', cockpit: 'COCKPIT' };
export const VIEW_FOV = { chase: 60, tcam: 60, cockpit: 75 };
export const EYE = { tcam: [0.03, 0, 1.02], cockpit: [0.20, 0, 0.68] };
export const EYE_TILT = { tcam: -0.10, cockpit: -0.05 }; // nose down a touch: the road ahead fills the lower frame
export const WHEEL_POS = [0.45, 0, 0.66];

export const nextView = (v) => VIEWS[(VIEWS.indexOf(v) + 1) % VIEWS.length];
export const viewOf = (stored) => (VIEWS.includes(stored) ? stored : 'chase');
export const onboard = (v) => v === 'tcam' || v === 'cockpit';
export const wheelAngle = (steer) => Math.max(-1, Math.min(1, steer || 0)) * (Math.PI / 2);
export const shadowHalf = (v) => (onboard(v) ? 120 : 360); // ±20 m round the car onboard: ~3× sharper texels
export const toThree = ([x, y, z]) => [x, z, -y];

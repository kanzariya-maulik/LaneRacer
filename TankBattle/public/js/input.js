// Input Manager capturing WASD for movement, ENTER for throwing bombs, and SPACE for cannon fire

export class InputManager {
    constructor(onFireBomb, onFireShell) {
        this.onFireBomb = onFireBomb;
        this.onFireShell = onFireShell;
        this.keys = {
            up: false,
            down: false,
            left: false,
            right: false,
            enter: false,
            space: false
        };

        this.lastDir = 'UP';
        this.seq = 0;
        this.unackedInputs = [];
        this.maxBuffer = 6;

        this.shootPending = false;
        this.bombPending = false;

        this.setupKeyboardListeners();
    }

    setupKeyboardListeners() {
        window.addEventListener('keydown', (e) => {
            // Prevent default page scroll for arrows, space, enter
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter'].includes(e.code)) {
                e.preventDefault();
            }

            if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.up = true;
            if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.down = true;
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.left = true;
            if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right = true;

            // ENTER key throws bomb!
            if (e.code === 'Enter' || e.code === 'NumpadEnter') {
                if (!this.keys.enter) {
                    this.keys.enter = true;
                    this.bombPending = true;
                    if (this.onFireBomb) this.onFireBomb();
                }
            }

            // SPACE key fires standard cannon shell
            if (e.code === 'Space') {
                if (!this.keys.space) {
                    this.keys.space = true;
                    this.shootPending = true;
                    if (this.onFireShell) this.onFireShell();
                }
            }
        });

        window.addEventListener('keyup', (e) => {
            if (e.code === 'KeyW' || e.code === 'ArrowUp') this.keys.up = false;
            if (e.code === 'KeyS' || e.code === 'ArrowDown') this.keys.down = false;
            if (e.code === 'KeyA' || e.code === 'ArrowLeft') this.keys.left = false;
            if (e.code === 'KeyD' || e.code === 'ArrowRight') this.keys.right = false;
            if (e.code === 'Enter' || e.code === 'NumpadEnter') this.keys.enter = false;
            if (e.code === 'Space') this.keys.space = false;
        });

        // Window blur cleans all inputs
        window.addEventListener('blur', () => {
            this.keys.up = false;
            this.keys.down = false;
            this.keys.left = false;
            this.keys.right = false;
            this.keys.enter = false;
            this.keys.space = false;
        });
    }

    // Trigger bomb throw programmatically (e.g. from on-screen button)
    triggerBomb() {
        this.bombPending = true;
        if (this.onFireBomb) this.onFireBomb();
    }

    // Trigger cannon shell programmatically
    triggerShell() {
        this.shootPending = true;
        if (this.onFireShell) this.onFireShell();
    }

    // Sample current frame input
    sample() {
        this.seq++;

        let dir = this.lastDir;
        let moving = false;

        // Determine primary directional vector (prioritizing newest or single direction)
        if (this.keys.up && !this.keys.down) {
            dir = 'UP';
            moving = true;
        } else if (this.keys.down && !this.keys.up) {
            dir = 'DOWN';
            moving = true;
        } else if (this.keys.left && !this.keys.right) {
            dir = 'LEFT';
            moving = true;
        } else if (this.keys.right && !this.keys.left) {
            dir = 'RIGHT';
            moving = true;
        }

        this.lastDir = dir;

        const inputFrame = {
            seq: this.seq,
            dir,
            moving,
            shoot: this.shootPending,
            bomb: this.bombPending
        };

        // Reset one-shot fire triggers
        this.shootPending = false;
        this.bombPending = false;

        this.unackedInputs.push(inputFrame);
        if (this.unackedInputs.length > this.maxBuffer) {
            this.unackedInputs.shift();
        }

        return {
            current: inputFrame,
            batch: [...this.unackedInputs] // Send redundant batch for UDP packet loss resilience
        };
    }

    acknowledge(serverAckSeq) {
        this.unackedInputs = this.unackedInputs.filter(i => i.seq > serverAckSeq);
    }
}

// Lightweight structured logger for TankBattle LAN
function timestamp() {
    return new Date().toISOString().substring(11, 19);
}

const logger = {
    info: (...args) => console.log(`[${timestamp()}] [INFO]`, ...args),
    warn: (...args) => console.warn(`[${timestamp()}] [WARN]`, ...args),
    error: (...args) => console.error(`[${timestamp()}] [ERROR]`, ...args),
    debug: (...args) => {
        if (process.env.DEBUG) console.log(`[${timestamp()}] [DEBUG]`, ...args);
    }
};

module.exports = logger;

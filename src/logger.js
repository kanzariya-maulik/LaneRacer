const fs = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

// Ensure logs directory exists
try {
    if (!fs.existsSync(LOGS_DIR)) {
        fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
} catch (e) {
    console.error('Failed to create logs dir:', e);
}

const MAX_LOG_SIZE = 2 * 1024 * 1024; // 2MB max per log file

function writeLog(filename, message) {
    const filePath = path.join(LOGS_DIR, filename);
    const time = new Date().toISOString();
    const line = `[${time}] ${message}\n`;

    try {
        // Rotate if file is too large
        if (fs.existsSync(filePath)) {
            const stats = fs.statSync(filePath);
            if (stats.size > MAX_LOG_SIZE) {
                const backupPath = `${filePath}.old`;
                if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
                fs.renameSync(filePath, backupPath);
            }
        }
        fs.appendFileSync(filePath, line, 'utf8');
    } catch (e) {
        // Silently ignore write failures
    }
}

const Logger = {
    bot(msg) {
        writeLog('ai_bot.log', msg);
    },
    player(id, username, msg) {
        writeLog('players.log', `[${username || id}] ${msg}`);
    },
    game(msg) {
        writeLog('game_events.log', msg);
    },
    all(tag, msg) {
        writeLog('activity.log', `[${tag}] ${msg}`);
    }
};

module.exports = Logger;

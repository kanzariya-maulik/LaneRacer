# ╔══════════════════════════════════════════════════════════════╗
# ║              🏎  LAN RACE — Makefile                         ║
# ║  Usage: make <target>                                        ║
# ╚══════════════════════════════════════════════════════════════╝

# ── Config ────────────────────────────────────────────────────
APP       := server.js
PORT      ?= 3232
PID_FILE  := .lanrace.pid
LOG_FILE  := .lanrace.log
NODE      := node

# ── Colours ───────────────────────────────────────────────────
BOLD   := \033[1m
GREEN  := \033[1;32m
YELLOW := \033[1;33m
CYAN   := \033[1;36m
RED    := \033[1;31m
RESET  := \033[0m

.DEFAULT_GOAL := all
.PHONY: all dev watch help start stop kill-all restart status logs info urls install test clean

# ── Run Project (Default Target with Watch Mode) ──────────────
all: kill-all urls
	@printf "$(GREEN)▶  Starting LAN Race server (watch mode) on port $(PORT)...$(RESET)\n"
	@PORT=$(PORT) $(NODE) --watch $(APP)

dev: all
watch: all

# ── Start Server in Background ────────────────────────────────
start: kill-all
	@printf "$(GREEN)▶  Starting LAN Race server in background on port $(PORT)...$(RESET)\n"
	@PORT=$(PORT) nohup $(NODE) $(APP) >> $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE); \
	sleep 1; \
	if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		printf "$(GREEN)✅  Server started! PID=$$(cat $(PID_FILE))$(RESET)\n\n"; \
		$(MAKE) --no-print-directory urls; \
	else \
		printf "$(RED)❌  Server failed to start. Check logs:$(RESET)\n"; \
		tail -20 $(LOG_FILE) 2>/dev/null || true; \
	fi

# ── Stop Server ───────────────────────────────────────────────
stop: kill-all

# ── Kill All Server Instances ─────────────────────────────────
kill-all:
	@printf "$(RED)⏹  Killing all existing server instances on port $(PORT)...$(RESET)\n"
	@$(NODE) scripts/kill-server.js $(PORT) 2>/dev/null || true
	@printf "$(GREEN)✅  All server instances killed.$(RESET)\n"

# ── Restart Server ────────────────────────────────────────────
restart: kill-all start

# ── Server Status ─────────────────────────────────────────────
status:
	@printf "\n$(BOLD)$(CYAN)🏎  LAN Race Server Status$(RESET)\n"
	@printf "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(RESET)\n"
	@$(NODE) -e "const fs=require('fs'); const net=require('net'); const pidFile='$(PID_FILE)'; const port=$(PORT); const s=net.createServer(); s.once('error', (e)=>{ if(e.code==='EADDRINUSE'){ const pid = fs.existsSync(pidFile) ? fs.readFileSync(pidFile,'utf8').trim() : 'Unknown'; console.log('  Status : \033[1;32m● RUNNING\033[0m\n  Port   : ' + port + (pid !== 'Unknown' ? '\n  PID    : ' + pid : '') + '\n  Log    : $(LOG_FILE)\n'); } else { console.log('  Status : \033[1;31m● STOPPED\033[0m\n'); } }); s.once('listening', ()=>{ console.log('  Status : \033[1;31m● STOPPED\033[0m\n'); s.close(); }); s.listen(port, '0.0.0.0');"

# ── Server Logs ───────────────────────────────────────────────
logs:
	@if [ ! -f $(LOG_FILE) ]; then \
		printf "$(YELLOW)No log file yet. Run$(RESET) $(BOLD)make start$(RESET) first.\n"; \
	else \
		printf "$(CYAN)━━ Live logs (Ctrl+C to exit) ━━━━━━━━━━━━━━━━$(RESET)\n"; \
		tail -f $(LOG_FILE); \
	fi

# ── Connection URLs Info ──────────────────────────────────────
urls:
	@printf "\n$(BOLD)$(CYAN)🌐  LAN RACE — Access URLs$(RESET)\n"
	@printf "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(RESET)\n"
	@printf "  $(GREEN)Localhost:$(RESET)   http://localhost:$(PORT)\n"
	@printf "  $(GREEN)Loopback:$(RESET)    http://127.0.0.1:$(PORT)\n"
	@printf "$(BOLD)  LAN Address (share with players):$(RESET)\n"
	@$(NODE) -e "const os=require('os'); const interfaces=os.networkInterfaces(); for(const name of Object.keys(interfaces)){ for(const iface of interfaces[name]){ if(iface.family==='IPv4' && !iface.internal){ console.log('  \033[1;33m▶\033[0m  http://' + iface.address + ':$(PORT)'); } } }" 2>/dev/null || true
	@printf "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(RESET)\n\n"

# ── Available Commands Info ───────────────────────────────────
help: info

info:
	@printf "\n$(BOLD)$(CYAN)🏎  LAN RACE — Available Commands$(RESET)\n"
	@printf "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(RESET)\n"
	@printf "  $(GREEN)make all$(RESET)        — Kill existing server, print links, and run the project\n"
	@printf "  $(GREEN)make start$(RESET)      — Start the server in background and print connection links\n"
	@printf "  $(GREEN)make stop$(RESET)       — Stop the running background server\n"
	@printf "  $(GREEN)make kill-all$(RESET)   — Force kill all running server instances and remove PID file\n"
	@printf "  $(GREEN)make restart$(RESET)    — Stop all existing servers and start a fresh server instance\n"
	@printf "  $(GREEN)make status$(RESET)     — Show whether server is running and display process info\n"
	@printf "  $(GREEN)make logs$(RESET)       — Tail live server log output (Ctrl+C to exit)\n"
	@printf "  $(GREEN)make info$(RESET)       — Print all available make commands with one-line descriptions\n"
	@printf "  $(GREEN)make urls$(RESET)       — Print Localhost and LAN IP links for players to join\n"
	@printf "  $(GREEN)make install$(RESET)    — Install npm dependencies\n"
	@printf "  $(GREEN)make test$(RESET)       — Run project automated test suite\n"
	@printf "  $(GREEN)make clean$(RESET)      — Remove PID and log files\n"
	@printf "\n  $(YELLOW)PORT=XXXX make all$(RESET)   — Run on a custom port (default: $(PORT))\n\n"

# ── Install Dependencies ──────────────────────────────────────
install:
	@printf "$(CYAN)📦  Installing dependencies...$(RESET)\n"
	@npm install
	@printf "$(GREEN)✅  Done.$(RESET)\n"

# ── Run Tests ─────────────────────────────────────────────────
test:
	@printf "$(CYAN)🧪  Running tests...$(RESET)\n"
	@npm test

# ── Clean Files ───────────────────────────────────────────────
clean:
	@printf "$(YELLOW)🧹  Cleaning PID and log files...$(RESET)\n"
	@$(NODE) -e "const fs=require('fs'); for(const f of ['$(PID_FILE)','$(LOG_FILE)']) { if(fs.existsSync(f)) try{ fs.unlinkSync(f); }catch(e){} }"
	@printf "$(GREEN)✅  Done.$(RESET)\n"

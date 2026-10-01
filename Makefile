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

# ── Colours (works on macOS/Linux) ────────────────────────────
BOLD   := \033[1m
GREEN  := \033[1;32m
YELLOW := \033[1;33m
CYAN   := \033[1;36m
RED    := \033[1;31m
RESET  := \033[0m

.PHONY: help start stop restart status logs info install clean

# ── Default target: show help ──────────────────────────────────
help:
	@printf "\n$(BOLD)$(CYAN)🏎  LAN RACE — Available Commands$(RESET)\n"
	@printf "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(RESET)\n"
	@printf "  $(GREEN)make start$(RESET)      — Start the server in the background\n"
	@printf "  $(GREEN)make stop$(RESET)       — Stop the running server\n"
	@printf "  $(GREEN)make restart$(RESET)    — Restart the server\n"
	@printf "  $(GREEN)make status$(RESET)     — Show whether server is running\n"
	@printf "  $(GREEN)make logs$(RESET)       — Tail live server logs (Ctrl+C to exit)\n"
	@printf "  $(GREEN)make info$(RESET)       — Show all LAN URLs clients can connect to\n"
	@printf "  $(GREEN)make install$(RESET)    — Install npm dependencies\n"
	@printf "  $(GREEN)make clean$(RESET)      — Remove PID / log files\n"
	@printf "\n  $(YELLOW)PORT=XXXX make start$(RESET)  — Start on a custom port (default: $(PORT))\n\n"

# ── Start ──────────────────────────────────────────────────────
start:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		printf "$(YELLOW)⚠  Server already running (PID $$(cat $(PID_FILE)))$(RESET)\n"; \
		printf "   Run $(BOLD)make restart$(RESET) to restart it.\n"; \
	else \
		printf "$(GREEN)▶  Starting LAN Race server on port $(PORT)...$(RESET)\n"; \
		PORT=$(PORT) nohup $(NODE) $(APP) >> $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE); \
		sleep 1; \
		if kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
			printf "$(GREEN)✅  Server started! PID=$$(cat $(PID_FILE))$(RESET)\n\n"; \
			$(MAKE) --no-print-directory info; \
		else \
			printf "$(RED)❌  Server failed to start. Check logs:$(RESET)\n"; \
			tail -20 $(LOG_FILE); \
		fi \
	fi

# ── Stop ───────────────────────────────────────────────────────
stop:
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		printf "$(RED)⏹  Stopping server (PID $$(cat $(PID_FILE)))...$(RESET)\n"; \
		kill $$(cat $(PID_FILE)); \
		rm -f $(PID_FILE); \
		printf "$(GREEN)✅  Server stopped.$(RESET)\n"; \
	else \
		printf "$(YELLOW)⚠  No running server found.$(RESET)\n"; \
		rm -f $(PID_FILE); \
	fi

# ── Restart ────────────────────────────────────────────────────
restart: stop
	@sleep 1
	@$(MAKE) --no-print-directory start

# ── Status ─────────────────────────────────────────────────────
status:
	@printf "\n$(BOLD)$(CYAN)🏎  LAN Race Server Status$(RESET)\n"
	@printf "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(RESET)\n"
	@if [ -f $(PID_FILE) ] && kill -0 $$(cat $(PID_FILE)) 2>/dev/null; then \
		PID=$$(cat $(PID_FILE)); \
		printf "  Status : $(GREEN)● RUNNING$(RESET)\n"; \
		printf "  PID    : $$PID\n"; \
		printf "  Port   : $(PORT)\n"; \
		printf "  Uptime : $$(ps -o etime= -p $$PID | xargs)\n"; \
		printf "  Log    : $(LOG_FILE)\n\n"; \
	else \
		printf "  Status : $(RED)● STOPPED$(RESET)\n\n"; \
		rm -f $(PID_FILE); \
	fi

# ── Logs ───────────────────────────────────────────────────────
logs:
	@if [ ! -f $(LOG_FILE) ]; then \
		printf "$(YELLOW)No log file yet. Run$(RESET) $(BOLD)make start$(RESET) first.\n"; \
	else \
		printf "$(CYAN)━━ Live logs (Ctrl+C to exit) ━━━━━━━━━━━━━━━━$(RESET)\n"; \
		tail -f $(LOG_FILE); \
	fi

# ── Info (show all accessible URLs) ───────────────────────────
info:
	@printf "$(BOLD)$(CYAN)🌐  Access URLs$(RESET)\n"
	@printf "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(RESET)\n"
	@printf "  $(GREEN)Local:$(RESET)      http://localhost:$(PORT)\n"
	@printf "  $(GREEN)Loopback:$(RESET)   http://127.0.0.1:$(PORT)\n"
	@printf "$(BOLD)  LAN addresses (share with players):$(RESET)\n"
	@# macOS + Linux compatible: list all non-loopback IPv4 addresses
	@(ifconfig 2>/dev/null || ip -4 addr 2>/dev/null) | \
		grep -Eo 'inet (addr:)?([0-9]{1,3}\.){3}[0-9]{1,3}' | \
		grep -Eo '([0-9]{1,3}\.){3}[0-9]{1,3}' | \
		grep -v '^127\.' | \
		while read ip; do \
			printf "  $(YELLOW)▶$(RESET)  http://$$ip:$(PORT)\n"; \
		done
	@printf "$(CYAN)━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━$(RESET)\n\n"

# ── Install ────────────────────────────────────────────────────
install:
	@printf "$(CYAN)📦  Installing dependencies...$(RESET)\n"
	@npm install
	@printf "$(GREEN)✅  Done.$(RESET)\n"

# ── Clean ──────────────────────────────────────────────────────
clean:
	@printf "$(YELLOW)🧹  Cleaning PID and log files...$(RESET)\n"
	@rm -f $(PID_FILE) $(LOG_FILE)
	@printf "$(GREEN)✅  Done.$(RESET)\n"

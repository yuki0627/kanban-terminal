# Dev server control: start/stop/restart the current directory's project in
# dev mode (yarn dev — Express backend + Vite dev server with HMR).
#
# `make stop` kills by port, not by PID file, so it stops whatever is
# listening on these ports regardless of which worktree/branch started it.

PORT ?= 34567
CLIENT_PORT ?= 6856
PID_FILE := .kanban-dev.pid
LOG_FILE := kanban-dev.log

.PHONY: start stop restart status

start:
	@if lsof -ti tcp:$(PORT) -sTCP:LISTEN >/dev/null 2>&1 || lsof -ti tcp:$(CLIENT_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "Already running on port $(PORT) or $(CLIENT_PORT) — run 'make restart' to switch to this directory."; \
		exit 1; \
	fi
	@echo "Starting dev server (PORT=$(PORT) CLIENT_PORT=$(CLIENT_PORT)) in $(CURDIR) ..."
	@PORT=$(PORT) CLIENT_PORT=$(CLIENT_PORT) nohup yarn dev > $(LOG_FILE) 2>&1 & echo $$! > $(PID_FILE)
	@for i in $$(seq 1 30); do \
		if curl -s -o /dev/null "http://localhost:$(PORT)/api/health"; then \
			echo "Ready: http://localhost:$(CLIENT_PORT)  (log: $(LOG_FILE))"; \
			exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "Server did not become ready in time — check $(LOG_FILE)"; exit 1

stop:
	@found=0; \
	for p in $(PORT) $(CLIENT_PORT); do \
		pids=$$(lsof -ti tcp:$$p -sTCP:LISTEN 2>/dev/null); \
		if [ -n "$$pids" ]; then \
			found=1; \
			echo "Stopping process(es) on port $$p: $$pids"; \
			kill $$pids 2>/dev/null; \
		fi; \
	done; \
	if [ "$$found" = "1" ]; then \
		sleep 1; \
		for p in $(PORT) $(CLIENT_PORT); do \
			pids=$$(lsof -ti tcp:$$p -sTCP:LISTEN 2>/dev/null); \
			[ -n "$$pids" ] && kill -9 $$pids 2>/dev/null || true; \
		done; \
	else \
		echo "Nothing running on port $(PORT) or $(CLIENT_PORT)."; \
	fi; \
	rm -f $(PID_FILE)

restart: stop
	@sleep 1
	@$(MAKE) start

status:
	@lsof -i tcp:$(PORT) -sTCP:LISTEN 2>/dev/null || echo "port $(PORT): not listening"
	@lsof -i tcp:$(CLIENT_PORT) -sTCP:LISTEN 2>/dev/null || echo "port $(CLIENT_PORT): not listening"

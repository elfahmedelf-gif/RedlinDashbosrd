#!/bin/bash

set -euo pipefail

# 获取脚本所在目录（.zscripts）
# 使用 $0 获取脚本路径（与 build.sh 保持一致）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEV_PID=""
PID_FILE="$PROJECT_DIR/.zscripts/dev.pid"

log_step_start() {
	local step_name="$1"
	echo "=========================================="
	echo "[$(date '+%Y-%m-%d %H:%M:%S')] Starting: $step_name"
	echo "=========================================="
	export STEP_START_TIME
	STEP_START_TIME=$(date +%s)
}

log_step_end() {
	local step_name="${1:-Unknown step}"
	local end_time
	end_time=$(date +%s)
	local duration=$((end_time - STEP_START_TIME))
	echo "=========================================="
	echo "[$(date '+%Y-%m-%d %H:%M:%S')] Completed: $step_name"
	echo "[LOG] Step: $step_name | Duration: ${duration}s"
	echo "=========================================="
	echo ""
}

start_dev_server() {
	cd "$PROJECT_DIR"
	# setsid：让 dev server 成为独立会话/进程组首进程（PGID == PID），
	# 停止时可以整组杀掉（next dev | tee 是一条管道，包含多个子进程）。
	# 不重定向到 dev.log：package.json 的 dev 脚本自带 `| tee dev.log`，
	# 这里再重定向会双写同一个文件（曾造成日志交错）。
	setsid bun run dev < /dev/null &
	DEV_PID=$!
	echo "$DEV_PID" > "$PID_FILE"
	echo "[DEV] Started Next.js dev server (PID: $DEV_PID, PGID: $DEV_PID)"
}

stop_dev_server() {
	if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
		echo "[DEV] Stopping Next.js dev server (PID: $DEV_PID)..."
		kill -TERM -- "-$DEV_PID" >/dev/null 2>&1 || kill "$DEV_PID" >/dev/null 2>&1 || true
		sleep 2
		kill -KILL -- "-$DEV_PID" >/dev/null 2>&1 || true
		DEV_PID=""
	fi
}

port_3000_ok() {
	curl -s --connect-timeout 2 --max-time 8 "http://localhost:3000/" >/dev/null 2>&1
}

start_mini_services() {
	local mini_services_dir="$PROJECT_DIR/mini-services"
	local started_count=0

	log_step_start "Starting mini-services"
	if [ ! -d "$mini_services_dir" ]; then
		echo "Mini-services directory not found, skipping..."
		log_step_end "Starting mini-services"
		return 0
	fi

	echo "Found mini-services directory, scanning for sub-services..."

	for service_dir in "$mini_services_dir"/*; do
		if [ ! -d "$service_dir" ]; then
			continue
		fi

		local service_name
		service_name=$(basename "$service_dir")
		echo "Checking service: $service_name"

		if [ ! -f "$service_dir/package.json" ]; then
			echo "[$service_name] No package.json found, skipping..."
			continue
		fi

		if ! grep -q '"dev"' "$service_dir/package.json"; then
			echo "[$service_name] No dev script found, skipping..."
			continue
		fi

		echo "Starting $service_name in background..."
		(
			cd "$service_dir"
			echo "[$service_name] Installing dependencies..."
			bun install
			echo "[$service_name] Running bun run dev..."
			exec bun run dev
		) >"$PROJECT_DIR/.zscripts/mini-service-${service_name}.log" 2>&1 &

		local service_pid=$!
		echo "[$service_name] Started in background (PID: $service_pid)"
		echo "[$service_name] Log: $PROJECT_DIR/.zscripts/mini-service-${service_name}.log"
		disown "$service_pid" 2>/dev/null || true
		started_count=$((started_count + 1))
	done

	echo "Mini-services startup completed. Started $started_count service(s)."
	log_step_end "Starting mini-services"
}

wait_for_service() {
	local host="$1"
	local port="$2"
	local service_name="$3"
	local max_attempts="${4:-60}"
	local attempt=1

	echo "Waiting for $service_name to be ready on $host:$port..."

	while [ "$attempt" -le "$max_attempts" ]; do
		if curl -s --connect-timeout 2 --max-time 5 "http://$host:$port" >/dev/null 2>&1; then
			echo "$service_name is ready!"
			return 0
		fi

		echo "Attempt $attempt/$max_attempts: $service_name not ready yet, waiting..."
		sleep 1
		attempt=$((attempt + 1))
	done

	echo "ERROR: $service_name failed to start within $max_attempts seconds"
	return 1
}

cleanup() {
	stop_dev_server
}

trap cleanup EXIT INT TERM

cd "$PROJECT_DIR"

if ! command -v bun >/dev/null 2>&1; then
	echo "ERROR: bun is not installed or not in PATH"
	exit 1
fi

log_step_start "bun install"
echo "[BUN] Installing dependencies..."
bun install
log_step_end "bun install"

log_step_start "bun run db:push"
echo "[BUN] Setting up database..."
bun run db:push
log_step_end "bun run db:push"

log_step_start "Starting Next.js dev server"
echo "[BUN] Starting development server..."
start_dev_server
log_step_end "Starting Next.js dev server"

log_step_start "Waiting for Next.js dev server"
wait_for_service "localhost" "3000" "Next.js dev server"
log_step_end "Waiting for Next.js dev server"

log_step_start "Health check"
echo "[BUN] Performing health check..."
curl -fsS localhost:3000 >/dev/null
echo "[BUN] Health check passed"
log_step_end "Health check"

start_mini_services

echo "Next.js dev server is running in background (PID: $DEV_PID)."
echo "Entering watchdog mode: auto-restart if the server ever goes down."

# ---------------------------------------------------------------------------
# 自愈守护循环（watchdog）
#
# 背景：本沙盒会在内存吃紧（如生产构建与 dev server 并存）时触发内核 OOM
# 杀掉 next-server（2026-11-17 事故：两次 OOM 导致 preview 502 近一小时）。
# 原版 dev.sh 启动后即退出，没有任何机制把服务器拉起来。
#
# 本循环由 /start.sh 在开机时后台拉起，随沙盒常驻；每 15 秒检查一次
# localhost:3000，任何"崩溃 / OOM / 挂死"都会被整组清理后重新拉起。
# 若端口已被其他实例占用（例如 agent 手动启动的服务器），则不重复启动。
# ---------------------------------------------------------------------------
set +e
RESTART_COUNT=0
while true; do
	if port_3000_ok; then
		: # 服务器健康（无论是本脚本还是其他实例拉起的），不动作
	else
		RESTART_COUNT=$((RESTART_COUNT + 1))
		echo "[DEV][WATCHDOG] $(date '+%Y-%m-%d %H:%M:%S') port 3000 not responding (event #$RESTART_COUNT) — recycling dev server..."
		stop_dev_server
		start_dev_server
		if wait_for_service "localhost" "3000" "Next.js dev server (watchdog restart)" 90; then
			echo "[DEV][WATCHDOG] dev server recovered (PID: $DEV_PID)"
		else
			echo "[DEV][WATCHDOG] dev server still not ready after restart; will retry next cycle"
		fi
	fi
	sleep 15
done

#!/bin/bash

set -euo pipefail

# 获取脚本所在目录（.zscripts）
# 使用 $0 获取脚本路径（与 build.sh 保持一致）
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

DEV_PID=""
PID_FILE="$PROJECT_DIR/.zscripts/dev.pid"

# ---------------------------------------------------------------------------
# 模式选择：优先生产服务器（npm run start）
#
# 背景：next dev 会现场编译大模块（vouchers / reports / import-wizard...），
# preview 浏览器会碰到 net::ERR_CONNECTION_RESET。生产构建已存在时改用
# npm run start（standalone 产物：响应瞬时、内存占用低）。
# 判定标准：.next/standalone/server.js + .next/BUILD_ID 同时存在。
# 构建缺失时自动先跑一次 npm run build 再启动生产服务器。
# ---------------------------------------------------------------------------
is_prod_build() {
        [ -f "$PROJECT_DIR/.next/standalone/server.js" ] && [ -f "$PROJECT_DIR/.next/BUILD_ID" ]
}

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
        # setsid：让 server 成为独立会话/进程组首进程（PGID == PID），
        # 停止时可以整组杀掉（bun run dev|start | tee 是一条管道，包含多个子进程）。
        # 不重定向到日志文件：package.json 的 dev/start 脚本自带 `| tee dev.log / server.log`，
        # 这里再重定向会双写同一个文件（曾造成日志交错）。
        if is_prod_build; then
                echo "[SERVER] Production build detected — starting Next.js PRODUCTION server (npm run start → .next/standalone/server.js)"
                setsid bun run start < /dev/null &
        else
                echo "[SERVER] No production build — starting Next.js dev server (npm run dev)"
                setsid bun run dev < /dev/null &
        fi
        DEV_PID=$!
        echo "$DEV_PID" > "$PID_FILE"
        echo "[SERVER] Started (PID: $DEV_PID, PGID: $DEV_PID)"
}

stop_dev_server() {
        if [ -n "${DEV_PID:-}" ] && kill -0 "$DEV_PID" >/dev/null 2>&1; then
                echo "[SERVER] Stopping Next.js server (PID: $DEV_PID)..."
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

# ---------------------------------------------------------------------------
# 启动前确保存在生产构建：
# - 已有 .next/standalone 产物 → 直接 npm run start（瞬时启动，无现场编译）
# - 没有产物 → 先 npm run build 一次（生成 standalone），之后重启/watchdog 拉起
#   都走 npm run start。注意：若之后修改了源码，需要重新 npm run build 才会生效。
# ---------------------------------------------------------------------------
if is_prod_build; then
        log_step_start "Production build check"
        echo "[BUILD] Existing production build found (.next/standalone) — skipping npm run build"
        log_step_end "Production build check"
else
        log_step_start "npm run build (production, one-time)"
        echo "[BUILD] No production build found — running npm run build (may take a few minutes)..."
        npm run build
        log_step_end "npm run build (production, one-time)"
fi

log_step_start "Starting Next.js server"
echo "[SERVER] Starting Next.js server..."
start_dev_server
log_step_end "Starting Next.js server"

log_step_start "Waiting for Next.js server"
wait_for_service "localhost" "3000" "Next.js server"
log_step_end "Waiting for Next.js server"

log_step_start "Health check"
echo "[SERVER] Performing health check..."
curl -fsS localhost:3000 >/dev/null
echo "[SERVER] Health check passed"
log_step_end "Health check"

start_mini_services

echo "Next.js server is running in background (PID: $DEV_PID)."
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
                echo "[SERVER][WATCHDOG] $(date '+%Y-%m-%d %H:%M:%S') port 3000 not responding (event #$RESTART_COUNT) — recycling server..."
                stop_dev_server
                start_dev_server
                if wait_for_service "localhost" "3000" "Next.js server (watchdog restart)" 90; then
                        echo "[SERVER][WATCHDOG] server recovered (PID: $DEV_PID)"
                else
                        echo "[SERVER][WATCHDOG] server still not ready after restart; will retry next cycle"
                fi
        fi
        sleep 15
done

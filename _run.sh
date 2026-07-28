#!/usr/bin/env bash
set -euo pipefail

mode="${1:-dev}"
port="${PORT:-7071}"
tailnet_ip="$(tailscale ip -4)"

if [ -z "$tailnet_ip" ]; then
    echo "Unable to determine a Tailnet IPv4 address." >&2
    exit 1
fi

server_pid=""
ui_pid=""

cleanup() {
    [ -z "$ui_pid" ] || kill "$ui_pid" 2>/dev/null || true
    [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

case "$mode" in
    dev)
        bun run dev:ui -- --host "$tailnet_ip" &
        ui_pid=$!
        HOST="$tailnet_ip" PORT="$port" bun run dev &
        ;;
    prod)
        bun run build:ui
        HOST="$tailnet_ip" PORT="$port" bun run start &
        ;;
    *)
        echo "Usage: $0 [dev|prod]" >&2
        exit 2
        ;;
esac

server_pid=$!
for _ in $(seq 1 30); do
    if curl --fail --silent "http://$tailnet_ip:$port/api/health" >/dev/null; then
        echo "Dashboard is ready at http://$tailnet_ip:$port"
        wait "$server_pid"
        exit $?
    fi
    sleep 1
done

echo "Dashboard did not become healthy at http://$tailnet_ip:$port/api/health" >&2
exit 1

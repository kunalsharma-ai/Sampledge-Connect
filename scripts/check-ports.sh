#!/usr/bin/env sh
# Checks that the host ports the gateway publishes are free before `docker compose up`.
# (Only the gateway service publishes ports; see docs/deploy.md, "Networks and ports".)
# Reads overrides from .env next to docker-compose.yml. Linux (ss) or macOS (lsof).
#   sh scripts/check-ports.sh
set -eu
cd "$(dirname "$0")/.."

val() { # val NAME DEFAULT -> value from the environment, then .env, then the default
  eval "v=\${$1:-}"
  if [ -z "$v" ] && [ -f .env ]; then
    v=$(sed -n "s/^[[:space:]]*$1=[\"']\{0,1\}\([0-9]*\).*/\1/p" .env | tail -n 1)
  fi
  echo "${v:-$2}"
}

WEB_PORT=$(val WEB_PORT 3000)
API_PORT=$(val API_PORT 4000)
LK_HTTP=$(val LIVEKIT_HTTP_PORT 7880)
LK_TCP=$(val LIVEKIT_TCP_PORT 7881)
LK_UDP=$(val LIVEKIT_UDP_PORT 7882)
LK_TURN=$(val LIVEKIT_TURN_PORT 3478)
RELAY_START=$(val LIVEKIT_TURN_RELAY_START 30000)
RELAY_END=$(val LIVEKIT_TURN_RELAY_END 30100)
JITSI_HTTP=$(val JITSI_HTTP_PORT 8000)
JITSI_JVB=$(val JITSI_JVB_PORT 10000)

# Jitsi's ports are only published when its compose file is in COMPOSE_FILE.
compose_file=${COMPOSE_FILE:-}
if [ -z "$compose_file" ] && [ -f .env ]; then
  compose_file=$(sed -n 's/^[[:space:]]*COMPOSE_FILE=//p' .env | tail -n 1)
fi
case "$compose_file" in *docker-compose.jitsi.yml*) JITSI=1 ;; *) JITSI=0 ;; esac

if command -v ss >/dev/null 2>&1; then
  TCP_USED=$(ss -Htln | awk '{print $4}' | sed 's/.*://' | sort -un)
  UDP_USED=$(ss -Huan | awk '{print $4}' | sed 's/.*://' | sort -un)
elif command -v lsof >/dev/null 2>&1; then
  TCP_USED=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk 'NR>1{print $9}' | sed 's/.*://' | sort -un)
  UDP_USED=$(lsof -nP -iUDP 2>/dev/null | awk 'NR>1{print $9}' | sed 's/->.*//; s/.*://' | sort -un)
else
  echo "Neither ss nor lsof is installed; can't check ports." >&2
  exit 2
fi

# Our own stack holds these ports while it runs, so only check when it is stopped.
if docker compose ps --status running -q 2>/dev/null | grep -q .; then
  echo "SampConnect containers are running; run 'docker compose down' first for an accurate check." >&2
fi

problems=0
check() { # check tcp|udp FROM TO NAME
  used=$TCP_USED
  [ "$1" = udp ] && used=$UDP_USED
  hits=$(echo "$used" | awk -v a="$2" -v b="$3" '$1>=a && $1<=b' | tr '\n' ' ')
  if [ -n "$hits" ]; then
    echo "IN USE  $1 $2-$3 ($4): $hits"
    problems=1
  else
    echo "free    $1 $2-$3 ($4)"
  fi
}

check tcp "$WEB_PORT" "$WEB_PORT" WEB_PORT
check tcp "$API_PORT" "$API_PORT" API_PORT
check tcp "$LK_HTTP" "$LK_HTTP" LIVEKIT_HTTP_PORT
check tcp "$LK_TCP" "$LK_TCP" LIVEKIT_TCP_PORT
check udp "$LK_UDP" "$LK_UDP" LIVEKIT_UDP_PORT
check udp "$LK_TURN" "$LK_TURN" LIVEKIT_TURN_PORT
check udp "$RELAY_START" "$RELAY_END" LIVEKIT_TURN_RELAY_START-END
if [ "$JITSI" -eq 1 ]; then
  check tcp "$JITSI_HTTP" "$JITSI_HTTP" JITSI_HTTP_PORT
  check udp "$JITSI_JVB" "$JITSI_JVB" JITSI_JVB_PORT
fi

in_relay() { [ "$1" -ge "$RELAY_START" ] && [ "$1" -le "$RELAY_END" ]; }
if in_relay "$LK_UDP" || in_relay "$LK_TURN" || { [ "$JITSI" -eq 1 ] && in_relay "$JITSI_JVB"; }; then
  echo "A UDP port sits inside the TURN relay range; move it or the range."
  problems=1
fi
if [ "$LK_UDP" = "$LK_TURN" ] || { [ "$JITSI" -eq 1 ] && { [ "$JITSI_JVB" = "$LK_UDP" ] || [ "$JITSI_JVB" = "$LK_TURN" ]; }; }; then
  echo "Two UDP settings use the same port; give each its own."
  problems=1
fi
for old in LIVEKIT_RTC_PORT_START LIVEKIT_RTC_PORT_END; do
  if [ -f .env ] && grep -q "^[[:space:]]*$old=" .env; then
    echo "note    $old in .env is no longer used (call media now uses LIVEKIT_UDP_PORT); remove it."
  fi
done

if [ "$problems" -ne 0 ]; then
  echo
  echo "Set a free port in .env (see .env.example), open it in the firewall, then run"
  echo "'docker compose up' again. See docs/deploy.md, \"Port already in use\"."
  exit 1
fi
echo "All ports are free."

#!/usr/bin/env sh
# Checks that the host ports docker-compose.yml publishes are free before `docker compose up`.
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
LK_TURN=$(val LIVEKIT_TURN_PORT 3478)
RTC_START=$(val LIVEKIT_RTC_PORT_START 50000)
RTC_END=$(val LIVEKIT_RTC_PORT_END 50100)
RELAY_START=$(val LIVEKIT_TURN_RELAY_START 50101)
RELAY_END=$(val LIVEKIT_TURN_RELAY_END 50200)

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
check udp "$LK_TURN" "$LK_TURN" LIVEKIT_TURN_PORT
check udp "$RTC_START" "$RTC_END" LIVEKIT_RTC_PORT_START-END
check udp "$RELAY_START" "$RELAY_END" LIVEKIT_TURN_RELAY_START-END
check tcp 27017 27017 mongo
check tcp 6379 6379 redis

if [ "$RELAY_START" -le "$RTC_END" ] && [ "$RTC_START" -le "$RELAY_END" ]; then
  echo "The media range and the TURN relay range overlap; give them separate ranges."
  problems=1
fi

if [ "$problems" -ne 0 ]; then
  echo
  echo "Set a free port or range in .env (see .env.example), open it in the firewall, then run"
  echo "'docker compose up' again. See docs/deploy.md, \"Port already in use\"."
  exit 1
fi
echo "All ports are free."

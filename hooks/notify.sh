#!/usr/bin/env sh
# Shell one-liner alternative: hooks/notify.sh "제목" "본문"
curl -s -X POST "http://127.0.0.1:${FLOATINGBOX_PORT:-47831}/notify" \
  -H 'Content-Type: application/json' \
  --data "$(printf '{"title":"%s","body":"%s","source":"shell"}' "$1" "$2")" >/dev/null

#!/bin/sh
# Refuses to commit or push a secret: a value from .env.local or an API key saved in the app's
# Settings (~/.ai-diving-monitor/config.json, or AI_DIVING_MONITOR_CONFIG).
# Usage: secret-guard.sh <commit|push> < text to scan ; exits 1 when a secret is found.
mode=$1
input=$(cat)
found=0

# check <name> <value> <where>: report the value when it is long enough to be a secret and present.
check() {
  value=$(printf '%s' "$2" | tr -d '"\r' | sed 's/^ *//;s/ *$//')
  [ ${#value} -ge 16 ] || return 0
  if printf '%s' "$input" | grep -qF -- "$value"; then
    echo "secret-guard: the value of $1 from $3 is in what you are about to $mode. Remove it." >&2
    found=1
  fi
}

env_file="$(git rev-parse --show-toplevel)/.env.local"
if [ -f "$env_file" ]; then
  while IFS='=' read -r name value; do
    case "$name" in ''|\#*) continue ;; esac
    # Only real secrets: values of keys, secrets, tokens and passwords.
    case "$name" in *KEY*|*SECRET*|*TOKEN*|*PASSWORD*) check "$name" "$value" .env.local ;; esac
  done < "$env_file"
fi

config="${AI_DIVING_MONITOR_CONFIG:-$HOME/.ai-diving-monitor/config.json}"
if [ -f "$config" ]; then
  # The keys saved in Settings: every "provider": "key" pair inside "api_keys": { ... }.
  pairs=$(tr -d '\n' < "$config" | sed -n 's/.*"api_keys" *: *{\([^}]*\)}.*/\1/p' | grep -oE '"[^"]*" *: *"[^"]*"')
  # A here-document keeps the loop in this shell, so check() can set found.
  while IFS= read -r pair; do
    [ -n "$pair" ] || continue
    name=$(printf '%s' "$pair" | sed 's/^"\([^"]*\)".*/\1/')
    value=$(printf '%s' "$pair" | sed 's/^"[^"]*" *: *"\([^"]*\)"$/\1/')
    check "the $name API key" "$value" "$config"
  done <<EOF
$pairs
EOF
fi
exit $found

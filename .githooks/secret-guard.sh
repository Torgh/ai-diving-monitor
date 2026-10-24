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

# The data folder, found the way the app finds it (lib/server/paths.ts).
if [ -n "$AI_DIVING_MONITOR_HOME" ]; then data="$AI_DIVING_MONITOR_HOME"
elif [ -n "$AI_DIVING_MONITOR_DB" ]; then data=$(dirname "$AI_DIVING_MONITOR_DB")
else data="$HOME/.ai-diving-monitor"; fi

# check_pairs <label> <file> <"name": "value" pairs, one per line>
check_pairs() {
  # A here-document keeps the loop in this shell, so check() can set found.
  while IFS= read -r pair; do
    [ -n "$pair" ] || continue
    name=$(printf '%s' "$pair" | sed 's/^"\([^"]*\)".*/\1/')
    value=$(printf '%s' "$pair" | sed 's/^"[^"]*" *: *"\([^"]*\)"$/\1/')
    check "$(printf "$1" "$name")" "$value" "$2"
  done <<EOF
$3
EOF
}

config="${AI_DIVING_MONITOR_CONFIG:-$data/config.json}"
if [ -f "$config" ]; then
  flat=$(tr -d '\n' < "$config")
  # The keys saved in Settings: every "provider": "key" pair inside "api_keys": { ... }.
  check_pairs "the %s API key" "$config" "$(printf '%s' "$flat" | sed -n 's/.*"api_keys" *: *{\([^}]*\)}.*/\1/p' | grep -oE '"[^"]*" *: *"[^"]*"')"
  # The Google OAuth client's secret.
  check_pairs "%s" "$config" "$(printf '%s' "$flat" | grep -oE '"googleClientSecret" *: *"[^"]*"')"
fi

token="$data/google-token.json"
if [ -f "$token" ]; then
  check_pairs "the Google %s" "$token" "$(tr -d '\n' < "$token" | grep -oE '"(refreshToken|accessToken)" *: *"[^"]*"')"
fi
exit $found

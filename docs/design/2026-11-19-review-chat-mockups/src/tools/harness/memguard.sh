#!/usr/bin/env bash
# Keeps the machine responsive while several build agents work in this checkout.
#
# When free memory runs low it stops the heaviest helper process an agent started (a type check, a
# test run or a headless browser); the agent simply reruns it. It also closes headless browsers that
# have been open longer than any capture needs. It never touches the dev server, and never touches a
# process outside this checkout other than headless browser shells.
#
# It also watches the battery. This is a laptop: under sustained heavy load it draws more than its charger
# supplies, the battery runs down while plugged in, and the system powers off at 2% (three times on
# 2026-11-19). At BATT_HOLD percent it pauses every helper (SIGSTOP, nothing is lost) and lets them
# continue at BATT_RESUME percent.
#
#   memguard.sh [log-file]        LOW_MB=4000 CRIT_MB=2000 BROWSER_MAX_AGE=900 BATT_HOLD=10 BATT_RESUME=18
ROOT=/home/diogenes/.cache/keating-deploy/design-pass-20261119
LOG=${1:-/tmp/keating-design-shots/memguard.log}
LOW_MB=${LOW_MB:-4000}
CRIT_MB=${CRIT_MB:-2000}
BROWSER_MAX_AGE=${BROWSER_MAX_AGE:-900}
BATT_HOLD=${BATT_HOLD:-10}
BATT_RESUME=${BATT_RESUME:-18}
BAT=/sys/class/power_supply/BAT0
battery() { if [ -r "$BAT/capacity" ]; then cat "$BAT/capacity"; else echo 100; fi; }
mkdir -p "$(dirname "$LOG")"
say() { printf '%s %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOG"; }

helpers() { # prints "rss_kb pid kind" for every helper process, heaviest first
  for pid in $(pgrep -u "$(id -u)" -f 'chrome-headless-shell|tsc|tsgo|bun test|bun x|storybook|playwright|ffmpeg|record\.mjs|record-all\.mjs|vite build|nitro build|generate-nodepod' 2>/dev/null); do
    [ "$pid" = "$$" ] && continue
    cmd=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null) || continue
    cwd=$(readlink "/proc/$pid/cwd" 2>/dev/null)
    case "$cmd" in
      *scripts/dev.mjs*|*"nitro dev"*|*node_modules/.bin/vite*|*memguard.sh*) continue ;;
      *chrome-headless-shell*) kind=browser ;;
      *) case "$cwd $cmd" in *"$ROOT"*) kind=build ;; *) continue ;; esac ;;
    esac
    rss=$(awk '/VmRSS/{print $2}' "/proc/$pid/status" 2>/dev/null)
    [ -n "$rss" ] && echo "$rss $pid $kind"
  done | sort -rn
}

say "memguard started: low ${LOW_MB} MB, critical ${CRIT_MB} MB, browsers closed after ${BROWSER_MAX_AGE}s"
tick=0
held=""
while :; do
  avail=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  cap=$(battery)
  if [ "$cap" -le "$BATT_HOLD" ]; then
    pids=$(helpers | awk '{print $2}' | tr '\n' ' ')
    if [ -n "${pids// /}" ]; then
      # shellcheck disable=SC2086
      kill -STOP $pids 2>/dev/null
      [ -z "$held" ] && say "battery ${cap}% ($(cat "$BAT/status" 2>/dev/null)): paused $(echo $pids | wc -w) helpers until it reaches ${BATT_RESUME}%"
      held=1
    fi
  elif [ -n "$held" ] && [ "$cap" -ge "$BATT_RESUME" ]; then
    pids=$(helpers | awk '{print $2}' | tr '\n' ' ')
    # shellcheck disable=SC2086
    [ -n "${pids// /}" ] && kill -CONT $pids 2>/dev/null
    say "battery ${cap}%: helpers continue"
    held=""
  fi
  if [ "$avail" -lt "$CRIT_MB" ]; then
    say "critical: ${avail} MB free, stopping every helper"
    helpers | while read -r rss pid kind; do kill -9 "$pid" 2>/dev/null && say "  stopped $kind $pid ($((rss / 1024)) MB)"; done
    sleep 5
  elif [ "$avail" -lt "$LOW_MB" ]; then
    helpers | head -1 | while read -r rss pid kind; do kill -9 "$pid" 2>/dev/null && say "low: ${avail} MB free, stopped $kind $pid ($((rss / 1024)) MB)"; done
    sleep 4
  fi
  tick=$((tick + 1))
  if [ $((tick % 20)) -eq 0 ]; then
    # A capture takes a minute or two; a browser older than this was left behind by a failed run.
    for pid in $(pgrep -u "$(id -u)" -f 'chrome-headless-shell' 2>/dev/null); do
      grep -qa -- '--type=' "/proc/$pid/cmdline" 2>/dev/null && continue
      age=$(ps -o etimes= -p "$pid" 2>/dev/null | tr -d ' ')
      [ -n "$age" ] && [ "$age" -gt "$BROWSER_MAX_AGE" ] && kill -9 "$pid" 2>/dev/null && say "closed a browser left open for ${age}s ($pid)"
    done
  fi
  if [ $((tick % 100)) -eq 0 ]; then say "ok: ${avail} MB free, $(helpers | wc -l) helpers, battery ${cap}% $(cat "$BAT/status" 2>/dev/null)"; fi
  sleep 3
done

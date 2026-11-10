#!/bin/bash
# Installs the GiftStar family computer program so it starts at login and stays on.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "Node.js is not installed. Install it from nodejs.org, then run this again."; exit 1; }
[ -f "$DIR/.env" ] || { echo "Missing $DIR/.env. Copy .env.example to .env and fill it in first."; exit 1; }
[ -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ] || echo "Note: Google Chrome was not found in Applications. Set CHROME_PATH in .env."

mkdir -p "$HOME/.giftstar-agent" "$HOME/Library/LaunchAgents"
(cd "$DIR" && npm install --no-audit --no-fund)

PLIST="$HOME/Library/LaunchAgents/com.giftstar.agent.plist"
sed -e "s#__NODE__#$NODE#g" -e "s#__DIR__#$DIR#g" -e "s#__HOME__#$HOME#g" "$DIR/com.giftstar.agent.plist.template" > "$PLIST"

launchctl bootout "gui/$(id -u)" "$PLIST" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Installed. It now starts at login. Log file: $HOME/.giftstar-agent/agent.log"
echo "To check it:  tail -f $HOME/.giftstar-agent/agent.log"
echo "To remove it: launchctl bootout gui/$(id -u) $PLIST && rm $PLIST"

#!/usr/bin/env bash
# =============================================================================
# setup_guide.sh — Clow Bots Interactive Setup Wizard
# Guides you through bot creation, public keys, tokens, and .env generation
# =============================================================================
# Usage:
#   bash setup_guide.sh             # full interactive setup
#   bash setup_guide.sh --check     # verify existing .env.deploy only
#   bash setup_guide.sh --reset     # clear .env.deploy and start fresh
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; DIM='\033[2m'; RESET='\033[0m'
ok()     { echo -e "${GREEN}✔${RESET}  $*"; }
warn()   { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()    { echo -e "${RED}✖${RESET}  $*" >&2; }
info()   { echo -e "${CYAN}▸${RESET}  $*"; }
prompt() { echo -e "${BOLD}?${RESET}  $*"; }
dim()    { echo -e "${DIM}$*${RESET}"; }

ENV_FILE=".env.deploy"
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ─── Modes ────────────────────────────────────────────────────────────────────
case "${1:-}" in
  --check)
    if [[ ! -f "$DEPLOY_DIR/$ENV_FILE" ]]; then
      err ".env.deploy not found. Run: bash setup_guide.sh"
      exit 1
    fi
    # shellcheck disable=SC1090
    set -a; source "$DEPLOY_DIR/$ENV_FILE"; set +a
    echo ""
    echo -e "${BOLD}Checking .env.deploy…${RESET}"
    ISSUES=0
    _check() {
      local var="$1"
      if [[ -z "${!var:-}" ]]; then
        err "MISSING: $var"
        ISSUES=$((ISSUES + 1))
      elif [[ "${!var}" == "your_"* || "${!var}" == "REPLACE"* ]]; then
        warn "PLACEHOLDER: $var (still has default value)"
        ISSUES=$((ISSUES + 1))
      else
        ok "$var ✓"
      fi
    }
    for v in PICOCLAW_BOT_TOKEN PICOCLAW_APP_ID PICOCLAW_PUBLIC_KEY PICOCLAW_FLY_APP \
             OPENCLAW_BOT_TOKEN OPENCLAW_APP_ID OPENCLAW_PUBLIC_KEY OPENCLAW_FLY_APP \
             DISCORD_GUILD_ID; do
      _check "$v"
    done
    echo ""
    [[ $ISSUES -eq 0 ]] && ok "All values configured correctly" && exit 0
    err "$ISSUES issue(s) found. Edit $ENV_FILE or re-run setup_guide.sh"
    exit 1
    ;;
  --reset)
    [[ -f "$DEPLOY_DIR/$ENV_FILE" ]] && rm "$DEPLOY_DIR/$ENV_FILE" && ok "Cleared $ENV_FILE"
    ;;
esac

# ─── Banner ──────────────────────────────────────────────────────────────────
clear
echo -e "${BOLD}"
echo "  ╔════════════════════════════════════════════════╗"
echo "  ║   Clow Bots Setup Wizard                      ║"
echo "  ║   PicoClaw · OpenClaw · deeptechx Discord     ║"
echo "  ╚════════════════════════════════════════════════╝"
echo -e "${RESET}"
echo "  This wizard creates .env.deploy with all required secrets."
echo "  Your tokens are stored locally only — never committed to git."
echo ""
dim "  Press Ctrl+C at any time to cancel."
echo ""

_read_secret() {
  local var="$1" label="$2" url="$3"
  local val=""
  echo ""
  prompt "$label"
  [[ -n "$url" ]] && dim "  Get it at: $url"
  while [[ -z "$val" ]]; do
    read -rsp "  > " val
    echo ""
    [[ -z "$val" ]] && warn "Value cannot be empty. Try again."
  done
  printf -v "$var" '%s' "$val"
}

_read_value() {
  local var="$1" label="$2" url="$3" default="${4:-}"
  local val=""
  echo ""
  prompt "$label"
  [[ -n "$url" ]] && dim "  Get it at: $url"
  [[ -n "$default" ]] && dim "  Press Enter to use default: $default"
  read -rp "  > " val
  val="${val:-$default}"
  printf -v "$var" '%s' "$val"
}

_confirm() {
  local msg="$1"
  echo ""
  prompt "$msg [y/N]"
  read -rp "  > " ans
  [[ "${ans,,}" == "y" || "${ans,,}" == "yes" ]]
}

# ─── Step 1: Discord Guild ID ─────────────────────────────────────────────────
echo -e "${BOLD}Step 1 of 5 — Discord Server (Guild) ID${RESET}"
dim "  Enable Developer Mode in Discord → User Settings → Advanced → Developer Mode"
dim "  Then right-click your server name → Copy Server ID"
_read_value DISCORD_GUILD_ID "Paste your Discord Server (Guild) ID:" "" ""

# ─── Step 2: PicoClaw bot setup ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 2 of 5 — PicoClaw Bot${RESET}"
info "PicoClaw is your private dev assistant (local LLM — runs on your machine or private server)"
echo ""
info "Create the bot:"
echo "  1. Go to discord.com/developers/applications → New Application"
echo "  2. Name it:  PicoClaw"
echo "  3. Open the Bot tab → Reset Token → Copy the token"
echo "  4. Also copy the Application ID (shown on the General Information page)"
echo "  5. On the Bot page → copy the Public Key (below the App Icon)"
echo ""

_read_secret PICOCLAW_BOT_TOKEN \
  "Paste the PicoClaw Bot Token:" \
  "discord.com/developers/applications → your app → Bot → Reset Token"

_read_value PICOCLAW_APP_ID \
  "Paste the PicoClaw Application ID:" \
  "discord.com/developers/applications → your app → General Information" \
  ""

_read_value PICOCLAW_PUBLIC_KEY \
  "Paste the PicoClaw Public Key:" \
  "discord.com/developers/applications → your app → General Information → Public Key" \
  ""

_read_value PICOCLAW_FLY_APP \
  "Fly.io app name for PicoClaw (leave blank if not using Fly.io):" \
  "fly.io/apps" \
  "picoclaw-discord"

echo ""
info "PicoClaw invite URL:"
echo "  https://discord.com/api/oauth2/authorize?client_id=${PICOCLAW_APP_ID}&permissions=2147483647&scope=bot%20applications.commands"
dim "  Open the URL above in your browser to add PicoClaw to your server"

# ─── Step 3: OpenClaw bot setup ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 3 of 5 — OpenClaw Bot${RESET}"
info "OpenClaw is your community bot (visible to all server members)"
echo ""
info "Create the bot:"
echo "  1. Go to discord.com/developers/applications → New Application"
echo "  2. Name it:  OpenClaw"
echo "  3. Follow the same steps as PicoClaw above"
echo ""

_read_secret OPENCLAW_BOT_TOKEN \
  "Paste the OpenClaw Bot Token:" \
  "discord.com/developers/applications → your app → Bot → Reset Token"

_read_value OPENCLAW_APP_ID \
  "Paste the OpenClaw Application ID:" \
  "discord.com/developers/applications → your app → General Information" \
  ""

_read_value OPENCLAW_PUBLIC_KEY \
  "Paste the OpenClaw Public Key:" \
  "discord.com/developers/applications → your app → General Information → Public Key" \
  ""

_read_value OPENCLAW_FLY_APP \
  "Fly.io app name for OpenClaw (leave blank if not using Fly.io):" \
  "fly.io/apps" \
  "openclaw-discord"

echo ""
info "OpenClaw invite URL:"
echo "  https://discord.com/api/oauth2/authorize?client_id=${OPENCLAW_APP_ID}&permissions=2147483647&scope=bot%20applications.commands"
dim "  Open the URL above in your browser to add OpenClaw to your server"

# ─── Step 4: Interaction endpoints ───────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 4 of 5 — Interaction Endpoints (optional — skip if using gateway)${RESET}"
dim "  Only needed if your bots use HTTP interactions (Fly.io / serverless) rather than gateway WebSocket"

PICOCLAW_ENDPOINT=""
OPENCLAW_ENDPOINT=""

if _confirm "Set up HTTP interaction endpoints?"; then
  _read_value PICOCLAW_ENDPOINT \
    "PicoClaw interactions endpoint URL (e.g. https://picoclaw.fly.dev/interactions):" \
    "" ""
  _read_value OPENCLAW_ENDPOINT \
    "OpenClaw interactions endpoint URL (e.g. https://openclaw.fly.dev/interactions):" \
    "" ""

  echo ""
  info "Register the endpoints in the Discord Developer Portal:"
  [[ -n "$PICOCLAW_ENDPOINT" ]] && echo "  PicoClaw: discord.com/developers/applications/$PICOCLAW_APP_ID/information"
  [[ -n "$OPENCLAW_ENDPOINT" ]] && echo "  OpenClaw: discord.com/developers/applications/$OPENCLAW_APP_ID/information"
  echo "  → Paste the URL in 'Interactions Endpoint URL' and click Save"
  dim "  Discord will ping your endpoint to verify the public key. The bot must be running."
fi

# ─── Step 5: Write .env.deploy ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Step 5 of 5 — Writing .env.deploy${RESET}"

ENV_PATH="$DEPLOY_DIR/$ENV_FILE"

cat > "$ENV_PATH" <<EOF
# =============================================================================
# Clow Bots — Deploy Environment
# Generated by setup_guide.sh on $(date -u '+%Y-%m-%d %H:%M UTC')
# ⚠ NEVER commit this file — it is listed in .gitignore
# =============================================================================

# ── Discord Server ──────────────────────────────────────────────────────────
DISCORD_GUILD_ID=${DISCORD_GUILD_ID}

# ── PicoClaw ─────────────────────────────────────────────────────────────────
PICOCLAW_BOT_TOKEN=${PICOCLAW_BOT_TOKEN}
PICOCLAW_APP_ID=${PICOCLAW_APP_ID}
PICOCLAW_PUBLIC_KEY=${PICOCLAW_PUBLIC_KEY}
PICOCLAW_FLY_APP=${PICOCLAW_FLY_APP:-picoclaw-discord}
${PICOCLAW_ENDPOINT:+PICOCLAW_ENDPOINT=${PICOCLAW_ENDPOINT}}

# ── OpenClaw ─────────────────────────────────────────────────────────────────
OPENCLAW_BOT_TOKEN=${OPENCLAW_BOT_TOKEN}
OPENCLAW_APP_ID=${OPENCLAW_APP_ID}
OPENCLAW_PUBLIC_KEY=${OPENCLAW_PUBLIC_KEY}
OPENCLAW_FLY_APP=${OPENCLAW_FLY_APP:-openclaw-discord}
${OPENCLAW_ENDPOINT:+OPENCLAW_ENDPOINT=${OPENCLAW_ENDPOINT}}
EOF

# Ensure .gitignore protects this file
ROOT_GITIGNORE="$(dirname "$DEPLOY_DIR")/.gitignore"
if [[ -f "$ROOT_GITIGNORE" ]] && ! grep -q "\.env\.deploy" "$ROOT_GITIGNORE"; then
  echo ".env.deploy" >> "$ROOT_GITIGNORE"
  echo "deploy/.env.deploy" >> "$ROOT_GITIGNORE"
  ok ".env.deploy added to .gitignore"
fi

chmod 600 "$ENV_PATH"
ok "Written to $ENV_PATH (permissions: 600)"

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔════════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   Setup complete!                              ║${RESET}"
echo -e "${GREEN}${BOLD}╚════════════════════════════════════════════════╝${RESET}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Add both bots to your server using the invite URLs shown above"
echo "  2. Register slash commands:"
echo "       bash deploy/register_commands.sh both"
echo ""
echo "  3. Apply the server template (channel + role architecture):"
echo "       /discord apply the clow-ecosystem template"
echo ""
echo "  4. Deploy the bots:"
echo "       bash deploy/deploy.sh"
echo ""
echo "  5. Verify:"
echo "       bash deploy/setup_guide.sh --check"
echo ""
dim "  See DISCORD_SERVER_SETUP.md for the full channel and role guide"
echo ""

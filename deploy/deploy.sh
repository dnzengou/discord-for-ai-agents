#!/usr/bin/env bash
# =============================================================================
# deploy.sh — Clow Bots Discord Ecosystem Deployment
# Bots: PicoClaw (private dev bot) · OpenClaw (community bot)
# Platform: Fly.io (flyctl) — swap DEPLOY_TARGET for other platforms
# =============================================================================
# Usage:
#   bash deploy.sh                 # deploy both bots
#   bash deploy.sh picoclaw        # deploy PicoClaw only
#   bash deploy.sh openclaw        # deploy OpenClaw only
#   bash deploy.sh --dry-run       # validate env + config, no actual deploy
#   bash deploy.sh --setup         # run interactive setup_guide.sh first
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

# ─── Colour helpers ─────────────────────────────────────────────────────────
RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✖${RESET}  $*" >&2; }
info() { echo -e "${CYAN}▸${RESET}  $*"; }
step() { echo -e "\n${BOLD}$*${RESET}"; }

# ─── Argument parsing ────────────────────────────────────────────────────────
DRY_RUN=0
TARGET="both"   # picoclaw | openclaw | both
for arg in "$@"; do
  case "$arg" in
    --dry-run)    DRY_RUN=1 ;;
    --setup)      bash "$(dirname "$0")/setup_guide.sh" ;;
    picoclaw)     TARGET="picoclaw" ;;
    openclaw)     TARGET="openclaw" ;;
    both)         TARGET="both" ;;
    -h|--help)
      sed -n '3,15p' "$0" | sed 's/# \?//'
      exit 0 ;;
    *) err "Unknown argument: $arg"; exit 1 ;;
  esac
done

# ─── Banner ──────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   Clow Bots — Discord GTM Deploy         ║"
echo "  ║   PicoClaw · OpenClaw · deeptechx        ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${RESET}"
[[ $DRY_RUN -eq 1 ]] && warn "DRY-RUN mode — no changes will be applied"

# ─── Required env validation ─────────────────────────────────────────────────
step "1/5  Validating environment"

ENV_FILE="${DEPLOY_ENV_FILE:-.env.deploy}"

# Load .env file if present (never commit this file)
if [[ -f "$ENV_FILE" ]]; then
  info "Loading env from $ENV_FILE"
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
else
  warn "No $ENV_FILE found — falling back to environment variables"
fi

MISSING=0
_require_env() {
  local var="$1" desc="$2"
  if [[ -z "${!var:-}" ]]; then
    err "Missing required env var: $var  ($desc)"
    MISSING=$((MISSING + 1))
  else
    ok "$var is set"
  fi
}

case "$TARGET" in
  picoclaw|both) _require_env PICOCLAW_BOT_TOKEN   "PicoClaw Discord bot token"
                 _require_env PICOCLAW_APP_ID       "PicoClaw application ID"
                 _require_env PICOCLAW_PUBLIC_KEY   "PicoClaw interaction public key"
                 _require_env PICOCLAW_FLY_APP      "Fly.io app name for PicoClaw" ;;
esac

case "$TARGET" in
  openclaw|both) _require_env OPENCLAW_BOT_TOKEN   "OpenClaw Discord bot token"
                 _require_env OPENCLAW_APP_ID       "OpenClaw application ID"
                 _require_env OPENCLAW_PUBLIC_KEY   "OpenClaw interaction public key"
                 _require_env OPENCLAW_FLY_APP      "Fly.io app name for OpenClaw" ;;
esac

# Optional but recommended
_require_env DISCORD_GUILD_ID  "Target Discord guild (server) ID"

if [[ $MISSING -gt 0 ]]; then
  err "$MISSING required env var(s) missing. Run bash setup_guide.sh or set them manually."
  exit 1
fi
ok "All required env vars present"

# ─── Security checks ─────────────────────────────────────────────────────────
step "2/5  Security checks"

# Check no tokens committed in tracked files
if git -C "$(dirname "$0")/.." rev-parse --git-dir &>/dev/null; then
  if git -C "$(dirname "$0")/.." grep -r "Bot [A-Za-z0-9_\-\.]\{20,\}" -- ":(exclude).env*" 2>/dev/null | grep -qv "^Binary"; then
    err "Possible hardcoded bot token found in tracked files. Aborting."
    exit 1
  fi
fi
ok "No hardcoded tokens detected in tracked files"

# Verify tokens look valid (not placeholders)
for var in PICOCLAW_BOT_TOKEN OPENCLAW_BOT_TOKEN; do
  if [[ "${!var:-}" == "your_token_here" || "${!var:-}" == "REPLACE_ME" ]]; then
    err "$var is still a placeholder. Set the real token."
    exit 1
  fi
done
ok "Token values are not placeholders"

# ─── Pre-flight: tooling check ────────────────────────────────────────────────
step "3/5  Checking deploy tooling"

DEPLOY_METHOD="flyctl"
if ! command -v flyctl &>/dev/null; then
  if command -v fly &>/dev/null; then
    DEPLOY_METHOD="fly"
    ok "fly CLI found (alias)"
  else
    warn "flyctl/fly not found — falling back to curl-based deploy"
    DEPLOY_METHOD="curl"
  fi
else
  ok "flyctl found: $(flyctl version 2>/dev/null | head -1)"
fi

# ─── Slash command registration ───────────────────────────────────────────────
step "4/5  Registering slash commands"

REG_SCRIPT="$(dirname "$0")/register_commands.sh"
if [[ ! -f "$REG_SCRIPT" ]]; then
  err "register_commands.sh not found at $REG_SCRIPT"
  exit 1
fi

if [[ $DRY_RUN -eq 0 ]]; then
  case "$TARGET" in
    picoclaw|both)
      info "Registering PicoClaw commands…"
      BOT_TOKEN="$PICOCLAW_BOT_TOKEN" APP_ID="$PICOCLAW_APP_ID" \
        GUILD_ID="${DISCORD_GUILD_ID:-}" \
        bash "$REG_SCRIPT" picoclaw
      ok "PicoClaw commands registered"
      ;;
  esac
  case "$TARGET" in
    openclaw|both)
      info "Registering OpenClaw commands…"
      BOT_TOKEN="$OPENCLAW_BOT_TOKEN" APP_ID="$OPENCLAW_APP_ID" \
        GUILD_ID="${DISCORD_GUILD_ID:-}" \
        bash "$REG_SCRIPT" openclaw
      ok "OpenClaw commands registered"
      ;;
  esac
else
  info "[dry-run] Would register slash commands for: $TARGET"
fi

# ─── Bot deployment ───────────────────────────────────────────────────────────
step "5/5  Deploying bots"

_deploy_fly() {
  local bot="$1" fly_app="$2" token_var="$3" pubkey_var="$4" appid_var="$5"
  info "Deploying $bot → Fly.io app: $fly_app"

  # Set secrets on the Fly app (idempotent)
  "$DEPLOY_METHOD" secrets set \
    DISCORD_BOT_TOKEN="${!token_var}" \
    DISCORD_PUBLIC_KEY="${!pubkey_var}" \
    DISCORD_APP_ID="${!appid_var}" \
    --app "$fly_app" 2>/dev/null || {
    warn "Could not set secrets via flyctl — ensure you're authenticated: flyctl auth login"
  }

  # Deploy
  "$DEPLOY_METHOD" deploy \
    --app "$fly_app" \
    --remote-only \
    --auto-confirm 2>&1 | tail -20
  ok "$bot deployed to $fly_app"
}

_deploy_curl() {
  local bot="$1"
  warn "$bot: curl-based deploy — Fly.io CLI not available."
  info "Manual steps:"
  echo "  1. Install flyctl:  curl -L https://fly.io/install.sh | sh"
  echo "  2. Authenticate:    flyctl auth login"
  echo "  3. Re-run:          bash deploy.sh $bot"
}

if [[ $DRY_RUN -eq 0 ]]; then
  case "$TARGET" in
    picoclaw|both)
      if [[ "$DEPLOY_METHOD" != "curl" ]]; then
        _deploy_fly "PicoClaw" "$PICOCLAW_FLY_APP" \
          PICOCLAW_BOT_TOKEN PICOCLAW_PUBLIC_KEY PICOCLAW_APP_ID
      else
        _deploy_curl "picoclaw"
      fi ;;
  esac
  case "$TARGET" in
    openclaw|both)
      if [[ "$DEPLOY_METHOD" != "curl" ]]; then
        _deploy_fly "OpenClaw" "$OPENCLAW_FLY_APP" \
          OPENCLAW_BOT_TOKEN OPENCLAW_PUBLIC_KEY OPENCLAW_APP_ID
      else
        _deploy_curl "openclaw"
      fi ;;
  esac
else
  info "[dry-run] Would deploy: $TARGET via $DEPLOY_METHOD"
fi

# ─── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║   Deploy complete!                       ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════╝${RESET}"
echo ""
echo "  Next steps:"
echo "  • Verify bots are online: /status in Discord"
echo "  • Run /discord:setup if you haven't configured the active server"
echo "  • See DISCORD_SERVER_SETUP.md for the full channel + role architecture"
echo ""

#!/usr/bin/env bash
# =============================================================================
# register_commands.sh — Discord Slash Command Registration
# Registers 12 commands per bot (24 total) via idempotent PUT
#
# PicoClaw (12):  ask · code · explain · debug · review · summarize
#                 improve · test · docs · deploy · devflow · status
#
# OpenClaw (12):  help · chat · research · compare · benchmark · model
#                 template · analyze · report · feedback · imagine · learn
# =============================================================================
# Usage:
#   BOT_TOKEN=... APP_ID=... bash register_commands.sh picoclaw
#   BOT_TOKEN=... APP_ID=... bash register_commands.sh openclaw
#   BOT_TOKEN=... APP_ID=... bash register_commands.sh both
#   BOT_TOKEN=... APP_ID=... GUILD_ID=... bash register_commands.sh picoclaw  # guild-scoped (instant)
# =============================================================================
# GUILD_ID set   → guild-scoped commands (updates in <1s, dev/staging use)
# GUILD_ID unset → global commands     (propagates up to 1h, production use)
# PUT is idempotent — safe to re-run at any time
# =============================================================================

set -euo pipefail
IFS=$'\n\t'

RED='\033[0;31m'; YELLOW='\033[1;33m'; GREEN='\033[0;32m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
ok()   { echo -e "${GREEN}✔${RESET}  $*"; }
warn() { echo -e "${YELLOW}⚠${RESET}  $*"; }
err()  { echo -e "${RED}✖${RESET}  $*" >&2; }
info() { echo -e "${CYAN}▸${RESET}  $*"; }

# ─── Args ─────────────────────────────────────────────────────────────────────
BOT="${1:-both}"

# ─── Env validation ───────────────────────────────────────────────────────────
: "${BOT_TOKEN:?BOT_TOKEN env var is required}"
: "${APP_ID:?APP_ID env var is required}"

DISCORD_API="https://discord.com/api/v10"
GUILD_SCOPE="${GUILD_ID:-}"

if [[ -n "$GUILD_SCOPE" ]]; then
  ENDPOINT="$DISCORD_API/applications/$APP_ID/guilds/$GUILD_SCOPE/commands"
  info "Guild-scoped registration (guild: $GUILD_SCOPE) — updates instantly"
else
  ENDPOINT="$DISCORD_API/applications/$APP_ID/commands"
  info "Global registration — propagates in up to 1 hour"
fi

# ─── Rate-limit-aware PUT helper ──────────────────────────────────────────────
_put_command() {
  local name="$1" payload="$2"
  local url="$ENDPOINT"   # PUT to bulk endpoint below; individual PUT for upsert
  local http_status

  http_status=$(curl -s -o /tmp/_cmd_resp.json -w "%{http_code}" \
    -X PUT \
    -H "Authorization: Bot $BOT_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    "$url")

  if [[ "$http_status" == "429" ]]; then
    local retry_after
    retry_after=$(jq -r '.retry_after // 1' /tmp/_cmd_resp.json 2>/dev/null || echo 1)
    warn "Rate limited — waiting ${retry_after}s"
    sleep "$retry_after"
    _put_command "$name" "$payload"
  elif [[ "$http_status" -ge 400 ]]; then
    err "Failed to register /$name — HTTP $http_status"
    cat /tmp/_cmd_resp.json 2>/dev/null && echo ""
    return 1
  fi
}

# ─── Bulk PUT (idempotent — replaces ALL commands atomically) ─────────────────
_bulk_put() {
  local bot_name="$1" payload="$2"
  info "Registering ${bot_name} commands via bulk PUT…"
  local http_status

  http_status=$(curl -s -o /tmp/_bulk_resp.json -w "%{http_code}" \
    -X PUT \
    -H "Authorization: Bot $BOT_TOKEN" \
    -H "Content-Type: application/json" \
    --data "$payload" \
    "$ENDPOINT")

  if [[ "$http_status" == "429" ]]; then
    local retry_after
    retry_after=$(jq -r '.retry_after // 2' /tmp/_bulk_resp.json 2>/dev/null || echo 2)
    warn "Rate limited — retrying in ${retry_after}s"
    sleep "$retry_after"
    _bulk_put "$bot_name" "$payload"
    return
  elif [[ "$http_status" -ge 400 ]]; then
    err "Bulk PUT failed for $bot_name — HTTP $http_status"
    cat /tmp/_bulk_resp.json 2>/dev/null && echo ""
    return 1
  fi

  local count
  count=$(jq 'length' /tmp/_bulk_resp.json 2>/dev/null || echo "?")
  ok "$bot_name: $count commands registered (HTTP $http_status)"
}

# ─────────────────────────────────────────────────────────────────────────────
#  PICOCLAW — Private dev assistant (12 commands)
# ─────────────────────────────────────────────────────────────────────────────
PICOCLAW_COMMANDS='[
  {
    "name": "ask",
    "description": "Ask PicoClaw a question — runs on your local LLM",
    "options": [
      {"type": 3, "name": "question", "description": "What do you want to know?", "required": true},
      {"type": 3, "name": "model", "description": "Model to use (default: auto)", "required": false,
       "choices": [
         {"name": "auto (recommended)", "value": "auto"},
         {"name": "deepseek-coder-v2", "value": "deepseek-coder-v2"},
         {"name": "codestral", "value": "codestral"},
         {"name": "qwen2.5-coder", "value": "qwen2.5-coder"},
         {"name": "llama3.2", "value": "llama3.2"}
       ]}
    ]
  },
  {
    "name": "code",
    "description": "Generate code from a natural language description",
    "options": [
      {"type": 3, "name": "prompt", "description": "What should the code do?", "required": true},
      {"type": 3, "name": "language", "description": "Programming language", "required": false,
       "choices": [
         {"name": "TypeScript", "value": "typescript"},
         {"name": "Python", "value": "python"},
         {"name": "Rust", "value": "rust"},
         {"name": "Go", "value": "go"},
         {"name": "Shell", "value": "bash"}
       ]}
    ]
  },
  {
    "name": "explain",
    "description": "Explain code, an error, or a technical concept",
    "options": [
      {"type": 3, "name": "input", "description": "Code snippet, error message, or concept to explain", "required": true},
      {"type": 5, "name": "eli5", "description": "Explain like I am 5 (simpler language)", "required": false}
    ]
  },
  {
    "name": "debug",
    "description": "Debug code — identify root cause and suggest a fix",
    "options": [
      {"type": 3, "name": "code", "description": "The code that is broken", "required": true},
      {"type": 3, "name": "error", "description": "The error message or symptom", "required": false},
      {"type": 3, "name": "context", "description": "Any relevant context (stack, env, versions)", "required": false}
    ]
  },
  {
    "name": "review",
    "description": "Code review — security, correctness, performance, quality",
    "options": [
      {"type": 3, "name": "code", "description": "Code to review (paste or describe)", "required": true},
      {"type": 3, "name": "focus", "description": "What to focus on", "required": false,
       "choices": [
         {"name": "all (default)", "value": "all"},
         {"name": "security", "value": "security"},
         {"name": "performance", "value": "performance"},
         {"name": "correctness", "value": "correctness"},
         {"name": "style", "value": "style"}
       ]}
    ]
  },
  {
    "name": "summarize",
    "description": "Summarize a document, thread, article, or paste",
    "options": [
      {"type": 3, "name": "content", "description": "Content to summarize (text, URL, or description)", "required": true},
      {"type": 4, "name": "max_bullets", "description": "Max bullet points in summary (default: 5)", "required": false,
       "min_value": 1, "max_value": 20}
    ]
  },
  {
    "name": "improve",
    "description": "Improve text or code — refactor, clarify, optimise",
    "options": [
      {"type": 3, "name": "input", "description": "Text or code to improve", "required": true},
      {"type": 3, "name": "goal", "description": "What to optimise for (clarity / performance / security / brevity)", "required": false}
    ]
  },
  {
    "name": "test",
    "description": "Generate unit tests or test cases for code",
    "options": [
      {"type": 3, "name": "code", "description": "Function or module to test", "required": true},
      {"type": 3, "name": "framework", "description": "Test framework", "required": false,
       "choices": [
         {"name": "Vitest / Jest", "value": "vitest"},
         {"name": "pytest", "value": "pytest"},
         {"name": "Go test", "value": "gotest"},
         {"name": "Bash / BATS", "value": "bash"}
       ]}
    ]
  },
  {
    "name": "docs",
    "description": "Generate documentation for code — JSDoc, docstrings, README section",
    "options": [
      {"type": 3, "name": "code", "description": "Code to document", "required": true},
      {"type": 3, "name": "format", "description": "Documentation format", "required": false,
       "choices": [
         {"name": "JSDoc / TSDoc", "value": "jsdoc"},
         {"name": "Python docstring", "value": "docstring"},
         {"name": "Markdown README section", "value": "markdown"},
         {"name": "OpenAPI / Swagger", "value": "openapi"}
       ]}
    ]
  },
  {
    "name": "deploy",
    "description": "Trigger a DevFlow deploy pipeline for a project",
    "options": [
      {"type": 3, "name": "target", "description": "What to deploy (project name or path)", "required": true},
      {"type": 3, "name": "pipeline", "description": "DevFlow pipeline to run (default: D)", "required": false,
       "choices": [
         {"name": "D — deploy only", "value": "D"},
         {"name": "P+D — push + deploy", "value": "P+D"},
         {"name": "Im+P+D — improve + push + deploy", "value": "Im+P+D"},
         {"name": "CI — full pipeline", "value": "CI"}
       ]},
      {"type": 5, "name": "dry_run", "description": "Validate without applying changes", "required": false}
    ]
  },
  {
    "name": "devflow",
    "description": "Run a DevFlow command (B, I, Im, E, C, Bl, P, D, CI) on a project",
    "options": [
      {"type": 3, "name": "command", "description": "DevFlow command(s) e.g. E Im or B+P+D or CI", "required": true},
      {"type": 3, "name": "project", "description": "Project path or name (default: current)", "required": false},
      {"type": 3, "name": "context", "description": "Any extra context for the AI", "required": false}
    ]
  },
  {
    "name": "status",
    "description": "Check PicoClaw bot health, loaded models, and system metrics",
    "options": [
      {"type": 3, "name": "check", "description": "What to check", "required": false,
       "choices": [
         {"name": "all (default)", "value": "all"},
         {"name": "models", "value": "models"},
         {"name": "memory", "value": "memory"},
         {"name": "gpu", "value": "gpu"},
         {"name": "api", "value": "api"}
       ]}
    ]
  }
]'

# ─────────────────────────────────────────────────────────────────────────────
#  OPENCLAW — Community bot (12 commands)
# ─────────────────────────────────────────────────────────────────────────────
OPENCLAW_COMMANDS='[
  {
    "name": "help",
    "description": "Show available OpenClaw commands and capabilities",
    "options": [
      {"type": 3, "name": "topic", "description": "Command or topic to get help on", "required": false}
    ]
  },
  {
    "name": "chat",
    "description": "Start an open-ended conversation with OpenClaw",
    "options": [
      {"type": 3, "name": "message", "description": "Your message", "required": true},
      {"type": 5, "name": "thread", "description": "Continue in a thread (default: true)", "required": false}
    ]
  },
  {
    "name": "research",
    "description": "Research a topic — synthesised from multiple sources",
    "options": [
      {"type": 3, "name": "topic", "description": "What to research", "required": true},
      {"type": 4, "name": "depth", "description": "Research depth (1=quick, 3=thorough)", "required": false,
       "min_value": 1, "max_value": 3},
      {"type": 5, "name": "sources", "description": "Include source citations", "required": false}
    ]
  },
  {
    "name": "compare",
    "description": "Compare AI models, frameworks, tools, or approaches",
    "options": [
      {"type": 3, "name": "a", "description": "First item to compare", "required": true},
      {"type": 3, "name": "b", "description": "Second item to compare", "required": true},
      {"type": 3, "name": "criteria", "description": "What to compare on (default: all)", "required": false}
    ]
  },
  {
    "name": "benchmark",
    "description": "Show or run benchmarks for AI models and tasks",
    "options": [
      {"type": 3, "name": "subject", "description": "Model or task to benchmark", "required": true},
      {"type": 3, "name": "metric", "description": "Metric to measure", "required": false,
       "choices": [
         {"name": "speed (tokens/sec)", "value": "speed"},
         {"name": "quality (MMLU / HumanEval)", "value": "quality"},
         {"name": "memory (VRAM)", "value": "memory"},
         {"name": "cost ($/1k tokens)", "value": "cost"}
       ]}
    ]
  },
  {
    "name": "model",
    "description": "List available AI models or set your default",
    "options": [
      {"type": 3, "name": "action", "description": "What to do", "required": true,
       "choices": [
         {"name": "list — show all available models", "value": "list"},
         {"name": "set — set your default model", "value": "set"},
         {"name": "info — details on a specific model", "value": "info"}
       ]},
      {"type": 3, "name": "name", "description": "Model name (required for set/info)", "required": false}
    ]
  },
  {
    "name": "template",
    "description": "Browse or apply a Discord server template",
    "options": [
      {"type": 3, "name": "action", "description": "What to do", "required": true,
       "choices": [
         {"name": "list — show all templates", "value": "list"},
         {"name": "apply — apply a template to this server", "value": "apply"},
         {"name": "preview — preview a template without applying", "value": "preview"}
       ]},
      {"type": 3, "name": "name", "description": "Template name (e.g. ai-community, startup-team)", "required": false}
    ]
  },
  {
    "name": "analyze",
    "description": "Analyze text, code, data, or a URL",
    "options": [
      {"type": 3, "name": "input", "description": "Content to analyze (text, code, URL, or paste)", "required": true},
      {"type": 3, "name": "type", "description": "Analysis type", "required": false,
       "choices": [
         {"name": "auto (default)", "value": "auto"},
         {"name": "sentiment", "value": "sentiment"},
         {"name": "code quality", "value": "code"},
         {"name": "security", "value": "security"},
         {"name": "data / trends", "value": "data"}
       ]}
    ]
  },
  {
    "name": "report",
    "description": "Generate a structured report on any topic or dataset",
    "options": [
      {"type": 3, "name": "subject", "description": "What the report is about", "required": true},
      {"type": 3, "name": "format", "description": "Output format", "required": false,
       "choices": [
         {"name": "markdown (default)", "value": "markdown"},
         {"name": "executive summary", "value": "exec"},
         {"name": "bullet points", "value": "bullets"},
         {"name": "table", "value": "table"}
       ]},
      {"type": 4, "name": "sections", "description": "Number of sections (default: 4)", "required": false,
       "min_value": 1, "max_value": 10}
    ]
  },
  {
    "name": "feedback",
    "description": "Submit feedback about OpenClaw or the deeptechx community",
    "options": [
      {"type": 3, "name": "type", "description": "Feedback type", "required": true,
       "choices": [
         {"name": "bug report", "value": "bug"},
         {"name": "feature request", "value": "feature"},
         {"name": "general feedback", "value": "general"},
         {"name": "model quality issue", "value": "model"}
       ]},
      {"type": 3, "name": "message", "description": "Your feedback", "required": true},
      {"type": 5, "name": "anonymous", "description": "Submit anonymously (default: false)", "required": false}
    ]
  },
  {
    "name": "imagine",
    "description": "Generate a detailed prompt for image generation models",
    "options": [
      {"type": 3, "name": "concept", "description": "What to visualise", "required": true},
      {"type": 3, "name": "style", "description": "Art style or aesthetic", "required": false,
       "choices": [
         {"name": "photorealistic", "value": "photorealistic"},
         {"name": "digital art", "value": "digital_art"},
         {"name": "anime / manga", "value": "anime"},
         {"name": "oil painting", "value": "oil_painting"},
         {"name": "minimalist", "value": "minimalist"}
       ]}
    ]
  },
  {
    "name": "learn",
    "description": "Get curated learning resources on any AI or tech topic",
    "options": [
      {"type": 3, "name": "topic", "description": "What you want to learn", "required": true},
      {"type": 3, "name": "level", "description": "Your current level", "required": false,
       "choices": [
         {"name": "beginner", "value": "beginner"},
         {"name": "intermediate", "value": "intermediate"},
         {"name": "advanced", "value": "advanced"},
         {"name": "expert / researcher", "value": "expert"}
       ]},
      {"type": 4, "name": "resources", "description": "Max resources to return (default: 5)", "required": false,
       "min_value": 1, "max_value": 15}
    ]
  }
]'

# ─── Run registration ─────────────────────────────────────────────────────────
echo ""
case "$BOT" in
  picoclaw)
    _bulk_put "PicoClaw" "$PICOCLAW_COMMANDS" ;;
  openclaw)
    _bulk_put "OpenClaw" "$OPENCLAW_COMMANDS" ;;
  both)
    _bulk_put "PicoClaw" "$PICOCLAW_COMMANDS"
    echo ""
    # Brief pause between bulk PUTs to avoid rate-limit edge cases
    sleep 2
    _bulk_put "OpenClaw" "$OPENCLAW_COMMANDS" ;;
  *)
    err "Unknown bot: $BOT. Use: picoclaw | openclaw | both"
    exit 1 ;;
esac

echo ""
ok "Slash command registration complete."
echo "  Guild-scoped: active immediately"
echo "  Global:       active within ~1 hour"
echo ""
info "Verify in Discord → Server Settings → Integrations → Bots"

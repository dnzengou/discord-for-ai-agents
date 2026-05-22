# deeptechx Discord Server — Setup Guide

> Clow Bots Ecosystem · PicoClaw + OpenClaw · 2026  
> 7 categories · 25 channels · 7 roles · 2 bots · AutoMod configured

---

## Quick-start checklist

- [ ] Run `bash deploy/setup_guide.sh` — configure bot tokens + public keys
- [ ] Invite PicoClaw and OpenClaw to the server (invite URLs shown by setup wizard)
- [ ] Apply the server template: `/discord apply the clow-ecosystem template`
- [ ] Register slash commands: `BOT_TOKEN=... APP_ID=... bash deploy/register_commands.sh both`
- [ ] Deploy bots: `bash deploy/deploy.sh`
- [ ] Post welcome message in #welcome (template below)
- [ ] Post community guidelines in #rules (template below)
- [ ] Configure AutoMod (configuration below)
- [ ] Grant yourself the Admin role
- [ ] Test both bots: `/status` (PicoClaw) · `/help` (OpenClaw)
- [ ] Set the `#announcements` channel as the system channel

---

## Role hierarchy

> Higher position = higher authority. Bot roles must be above roles they manage.

| Position | Role | Color | Permissions | Who gets it |
|----------|------|-------|-------------|-------------|
| 8 | 👑 **Admin** | `#ED4245` (red) | Administrator | Server owners + trusted admins |
| 7 | 🤖 **Bot Manager** | `#5865F2` (blurple) | Manage Roles, Manage Channels, Manage Messages, Kick/Ban, View Audit Log | Bot management team |
| 6 | 🔬 **Researcher** | `#57F287` (green) | Send Messages, Embed Links, Attach Files, Add Reactions, Use Slash Commands, Manage Threads | Active researchers with verified credentials |
| 5 | 💻 **Developer** | `#FEE75C` (yellow) | Send Messages, Embed Links, Attach Files, Add Reactions, Use Slash Commands, Manage Threads | Verified developers |
| 4 | 🎯 **Contributor** | `#EB459E` (pink) | Send Messages, Embed Links, Attach Files, Add Reactions, Use Slash Commands | Active community contributors |
| 3 | 👁 **Observer** | `#99AAB5` (grey) | View Channel, Read Message History, Use Slash Commands | Read-only community lurkers |
| 2 | 🌐 **Member** | — (default) | Standard Discord defaults | Everyone who joins |
| 1 | @everyone | — | View public channels, read history | All users |

**Bot role setup:**
- PicoClaw's bot role should be at position 7 (same as Bot Manager, or above)
- OpenClaw's bot role should be at position 7
- Both bots need: Manage Roles (below their own role), Manage Channels, Manage Messages, Read Message History, Send Messages, Embed Links, Use Slash Commands

---

## Channel architecture (25 channels)

### 📣 INFORMATION
*Read-only for most members. Admins + Bot Manager write here.*

| Channel | Type | Topic | Access |
|---------|------|-------|--------|
| `#welcome` | Text | First stop. Read the rules and introduce yourself. | View: Everyone · Write: Admin |
| `#rules` | Text | Community guidelines and code of conduct. | View: Everyone · Write: Admin |
| `#announcements` | Announcement | Official updates from the team. Follow to crosspost. | View: Everyone · Write: Admin + Bot Manager |
| `#bot-updates` | Announcement | PicoClaw and OpenClaw changelogs and status updates. | View: Everyone · Write: Bot Manager |
| `#roadmap` | Text | What's being built. What's next. Vote with reactions. | View: Everyone · Write: Admin |

### 🤖 CLAW BOTS
*Dedicated channels for bot interaction and support.*

| Channel | Type | Topic | Access |
|---------|------|-------|--------|
| `#picoclaw` | Text | Private AI assistant for developers. /ask /code /debug /devflow | View: Developer+ · Write: Developer+ |
| `#openclaw` | Text | Community AI assistant for everyone. /chat /research /compare /learn | View: Member+ · Write: Member+ |
| `#bot-feedback` | Forum | Report issues, suggest commands, share prompts that worked well. | View: Member+ · Post: Member+ |
| `#bot-status` | Text | Automated uptime + health alerts. | View: Everyone · Write: Bots only |
| `#playground` | Text | Test commands, experiment freely, no judgment. | View: Member+ · Write: Member+ |

### 🔬 RESEARCH
*For deep technical discussion and knowledge sharing.*

| Channel | Type | Topic | Access |
|---------|------|-------|--------|
| `#papers` | Text | Arxiv drops, preprints, and paper discussions. Include a one-liner summary. | View: Observer+ · Write: Contributor+ |
| `#experiments` | Forum | Share results, runs, ablations. Include: method · metric · result · code link. | View: Observer+ · Post: Developer+ |
| `#benchmarks` | Text | Model performance comparisons. Use /benchmark for data. | View: Observer+ · Write: Contributor+ |
| `#model-releases` | Text | New model releases, fine-tunes, quantizations. | View: Everyone · Write: Contributor+ |

### 💻 DEVELOPMENT
*Day-to-day engineering collaboration.*

| Channel | Type | Topic | Access |
|---------|------|-------|--------|
| `#general-dev` | Text | Engineering chat, questions, random code things. | View: Observer+ · Write: Developer+ |
| `#code-review` | Forum | Drop PR links. Ask for specific feedback. Tag reviewers. | View: Observer+ · Post: Developer+ |
| `#help` | Forum | Stuck? Ask here. Include: what you tried · error message · stack + versions. | View: Member+ · Post: Member+ |
| `#showcase` | Forum | Ship something? Demo it here. Ship early, ship often. | View: Everyone · Post: Contributor+ |

### 🚀 DEPLOYMENTS
*Operational visibility.*

| Channel | Type | Topic | Access |
|---------|------|-------|--------|
| `#deploys` | Text | Automated deploy log. Every production change appears here. | View: Developer+ · Write: Bots + Bot Manager |
| `#incidents` | Text | Active incidents and post-mortems. Ping @Bot Manager for urgent issues. | View: Developer+ · Write: Developer+ |

### 💬 COMMUNITY
*General social channels.*

| Channel | Type | Topic | Access |
|---------|------|-------|--------|
| `#introductions` | Text | New here? Tell us who you are and what you're building. | View: Member+ · Write: Member+ |
| `#general` | Text | Anything AI and tech. Hot takes welcome. | View: Member+ · Write: Member+ |
| `#reads-and-links` | Text | Articles, threads, videos worth sharing. Include a one-line take. | View: Member+ · Write: Member+ |

### 🔊 VOICE
*Live collaboration.*

| Channel | Type | Notes |
|---------|------|-------|
| `Standup` | Voice | Daily async standups. User limit: 20 |
| `Research Room` | Voice | Deep work sessions. User limit: 8 |
| `Dev Room` | Voice | Pair programming / debugging sessions. User limit: 6 |

---

## Permission overwrites

### #picoclaw — restrict to Developer+
```
@everyone: View Channel = DENY
@Member:   View Channel = DENY
@Contributor: View Channel = DENY
@Observer: View Channel = DENY
@Developer: View Channel = ALLOW, Send Messages = ALLOW
@Researcher: View Channel = ALLOW, Send Messages = ALLOW
@Admin: View Channel = ALLOW, Send Messages = ALLOW
```

### #deploys — bots write, humans read-only
```
@everyone: Send Messages = DENY
PicoClaw bot role: Send Messages = ALLOW
OpenClaw bot role: Send Messages = ALLOW
@Bot Manager: Send Messages = ALLOW
```

### #announcements — Admin/Bot Manager write only
```
@everyone: Send Messages = DENY
@Admin: Send Messages = ALLOW, Manage Messages = ALLOW
@Bot Manager: Send Messages = ALLOW
```

---

## AutoMod configuration

### Rule 1: Block slurs and hate speech
- Trigger: Keyword preset → Slurs
- Action: Block message
- Message: "Please keep it respectful. This content isn't allowed here."
- Exempt roles: Admin, Bot Manager

### Rule 2: Block invite spam
- Trigger: Keyword → `discord.gg/`, `discord.com/invite/`, `discordapp.com/invite/`
- Action: Block message
- Message: "Server invites need mod approval. DM a moderator."
- Exempt roles: Admin, Bot Manager

### Rule 3: Mention raid guard
- Trigger: Mention spam → 6+ unique mentions per message
- Action: Block message + Timeout 10 minutes
- Raid protection: enabled

### Rule 4: Block profanity (configurable)
- Trigger: Keyword preset → Profanity
- Action: Block message (or Warn — your call)
- Exempt channels: #playground
- Exempt roles: Admin

---

## Welcome message template

*Post in #welcome when server launches. Pin it.*

```
👋 Welcome to **deeptechx** — home of PicoClaw and OpenClaw.

We're a community of AI builders, researchers, and developers 
working with local and frontier language models.

**Get started:**
📜 Read the rules in #rules
👋 Introduce yourself in #introductions  
🤖 Try the bots: `/help` or `/ask`

**Bots available:**
→ **PicoClaw** — your private dev assistant (in #picoclaw)
   /ask · /code · /debug · /review · /devflow

→ **OpenClaw** — community AI assistant (in #openclaw)  
   /chat · /research · /compare · /learn

Questions? Ping @Bot Manager.
```

---

## Community guidelines template

*Post in #rules. Pin it.*

```
# deeptechx Community Guidelines

**1. Be direct, not dismissive**
Disagree with ideas, not people. Technical criticism is welcome; personal attacks are not.

**2. Show your work**
When asking for help, include what you tried, the error, your stack.
When sharing results, include the method and metrics — not just screenshots.

**3. No spam, no self-promo without value**
Promotional content belongs in #showcase (and must include a real demo or explanation).
DM-spamming members = immediate ban.

**4. No invite links without approval**
Post invite links in DMs to @Bot Manager first. Unapproved invites are auto-blocked.

**5. Keep it on-topic**
#picoclaw and #openclaw are for bot interaction.
#papers and #benchmarks are for research, not general chat.
#general and #off-topic exist for everything else.

**6. Bot outputs ≠ ground truth**
AI-generated content can be wrong. Verify before acting on code or technical claims.

**7. Respect the bots**
Don't attempt prompt injection, jailbreaks, or deliberate abuse of PicoClaw or OpenClaw.
Report issues in #bot-feedback instead.

**Moderation:**
Violations → Warning → Timeout → Ban, depending on severity.
Appeals: DM @Admin.
```

---

## Applying with the discord-for-ai-agents plugin

Once the plugin is installed and `/discord:setup` is complete:

```bash
# Apply the full server template (creates roles + channels + AutoMod)
/discord apply the clow-ecosystem template

# Or set up piece by piece:
/discord create role Admin — red, hoisted, administrator permission
/discord create role Developer — yellow, hoisted, send_messages manage_threads
/discord create category INFORMATION
/discord create channel announcements — announcement type, under INFORMATION
```

Or use `discord_server_snapshot` to get the current state before applying:
```
/discord take a server snapshot so we can see what's already there
```

---

## Post-launch verification checklist

- [ ] Both bots show as online (green dot)
- [ ] `/status` responds in #picoclaw
- [ ] `/help` responds in #openclaw
- [ ] `#bot-status` shows uptime heartbeat
- [ ] AutoMod test: send a message with 8+ @mentions (should be blocked)
- [ ] AutoMod test: send a discord.gg invite link (should be blocked)
- [ ] @Member cannot see #picoclaw
- [ ] @Developer can see #picoclaw
- [ ] Roles appear in the sidebar with correct colors and hoisting
- [ ] Welcome message pinned in #welcome
- [ ] Rules message pinned in #rules
- [ ] `/discord apply the clow-ecosystem template` runs without errors

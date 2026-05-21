# Building a Server from a Natural-Language Brief

Use this when the user gives an open-ended brief — *"make me a Magic: The Gathering trading server"*, *"set up a Discord for my book club"*, *"build a community for indie game devs."* The actual design + apply work goes to the **discord-architect** sub-agent. You're the orchestrator: confirm the active guild, spawn the agent, relay the result.

## Step 1 — Confirm the active guild

Call `discord_get_active_guild`.

- If `isError: true` ("no active guild") → tell the user to run `/discord:setup` first and **stop**.
- Otherwise, anchor the conversation on `<guild.name>` (id `<guild.id>`).

**Empty-guild check**: briefly remind the user that `discord_apply_template` is create-only — it won't clear out an existing server. If `<guild.name>` already has structure, they'll get a mostly-skipped result. Suggest using a fresh test guild for first-time builds.

## Step 2 — Capture the brief

If the user provided a brief inline (e.g., `/discord make me a Magic: The Gathering trading server`), use it as-is.

Otherwise, ask:

> What kind of server do you want? Describe the community in your own words — be specific about the vibe, what people will do there, and any roles or channels you definitely want.

Don't ask follow-ups here — leave clarifications to the architect.

## Step 3 — Spawn the architect

Use the **Agent** tool with:

- `subagent_type: "discord:discord-architect"`
- `description`: short, like `"Design <community-type> server"`
- `prompt`: the brief verbatim plus the active guild context. Format:

```
Brief from user: <user brief>

Active guild: <guild.name> (id: <guild.id>)

Design a template spec for this community. Dry-run via discord_apply_template, present the preview to the user via AskUserQuestion, and apply on approval. Return a final summary of what was created.
```

The architect will:

1. Optionally ask one clarifying question if the brief is ambiguous
2. Design a spec matching the templateSpecSchema
3. Dry-run via `discord_apply_template` with `dry_run: true`
4. Present the preview and call `AskUserQuestion` for approval
5. Apply on approval (or revise, or cancel)
6. Return a final summary

## Step 4 — Relay the result

When the architect returns, summarize the outcome to the user in 2–3 sentences:

> The architect built **<theme>** in **`<guild.name>`**: created **n** roles, **n** categories, **n** channels. <Anything skipped or failed.>

If the architect cancelled or hit failures, surface the reason directly so the user can decide next steps.

## Step 5 — Suggest next steps

After a successful build, offer:

> Want me to:
>
> - **Reorder** roles or channels (`discord_modify_role_positions` / `discord_modify_channel_positions`)
> - **Set channel-specific permission overwrites** (e.g., gate `subs-only` behind a role)
> - **Send a welcome embed** to `#announcements`
> - **Schedule a recurring event** in one of the new voice channels
> - **Add a layer** — give me a follow-up like "add a marketplace category for trading"

## Notes

- **One agent invocation per brief.** Don't loop or re-spawn — if the user wants major changes after apply, take a follow-up brief and spawn again.
- **The architect handles dry-run + apply itself** — don't call `discord_apply_template` from the orchestrator directly.
- **If the architect fails to design** (e.g., spec validation rejects), surface the error and ask the user to refine the brief, then re-spawn.
- **The architect runs in the foreground** so its `AskUserQuestion` calls reach the user. Don't pass `run_in_background: true` to the Agent tool.

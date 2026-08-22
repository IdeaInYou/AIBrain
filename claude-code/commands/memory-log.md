---
description: Write a note to long-term memory (episode or decision)
allowed-tools: Bash(curl:*), Bash(jq:*), Bash(source:*)
argument-hint: <what happened, in any language>
---

Write this to long-term memory:

$ARGUMENTS

Steps:

1. Decide whether it is an **episode** (a work session: what / why / outcome) or a
   **fact** (decision, preference, todo, or stable fact about a system).
2. Translate it into English. Keep identifiers, file paths, service names, and
   error messages verbatim.
3. Build a JSON object matching the shape in `~/.claude/prompts/extract.txt` —
   `episode` and/or `facts`, plus `"project"` if you can tell which project this is.
4. POST it:

   ```bash
   source ~/.claude/hooks/lib.sh && echo '<json>' | mem_post /api/ingest
   ```

5. Report the returned `episode_id` and fact tally in one line. Do not paste the JSON back.

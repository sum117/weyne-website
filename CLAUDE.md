# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The canonical, tool-agnostic instructions live in AGENTS.md and are imported
below — edit that file, not this one, when guidance changes.

@AGENTS.md

## Claude Code notes

- Verification loop: finish substantive changes by running `bun run check`
  (or the failing subset while iterating) and report its actual output.
- For visual work, compare against `docs/design-handoff/screenshots/` and
  `docs/design-handoff/DESIGN_SPEC.md` instead of styling from memory —
  pixel-exact fidelity to the handoff beats Tailwind defaults here.
- This machine is Windows/PowerShell; prefer Bun scripts over raw shell
  one-liners so commands stay portable with CI (Linux).

# .arch/ — Context Engineering for doc-qa

> AI-Powered Product — Hexagonal (ports + adapters) + Pipeline chains

This directory contains architecture context files for AI-assisted development.
The AI reads these files to generate code that fits your system's architecture,
follows your patterns, avoids known gotchas, and calls APIs correctly.

## How to Use

### Claude Projects
1. Copy `SYSTEM.md` into your Project instructions
2. Upload `INDEX.md` and all `.graph` files as project knowledge
3. Upload relevant `.skill` and `.api` files as project knowledge

### Cursor / Windsurf
1. Copy `SYSTEM.md` into `.cursorrules`
2. Add rule: "Read .arch/INDEX.md to resolve context for each prompt"

### Claude Code
1. Add `SYSTEM.md` content to your `CLAUDE.md` instructions
2. Claude Code reads `.arch/` files automatically as needed

## File Map

| File | Purpose | Update When |
|------|---------|-------------|
| SYSTEM.md | Rules + $reserved words | New convention or rule |
| INDEX.md | Keyword → node/skill routing | New feature or dependency |
| clusters/*.graph | Architecture structure (v2 notation) | Feature added/changed |
| skills/*.skill | Package gotchas + patterns | Dependency upgrade or new gotcha |
| apis/*.api | API contracts (endpoints + types) | Dependency version bump |

## Maintenance

- **Monthly**: Check .skill freshness. Update for dependency upgrades.
- **Per feature**: Add .graph cluster. Update INDEX.md keywords.
- **Per gotcha**: When AI-generated code needs a fix, add WRONG/RIGHT/WHY to the .skill.
- **Per deploy**: Regenerate .api files from your latest API specs.

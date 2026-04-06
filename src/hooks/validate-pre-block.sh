#!/bin/sh
# Validates that a [PRE] block was declared for the current file operation.
# Called by Claude Code PreToolUse hooks on Write and Edit tool calls.
#
# Checks: /tmp/.archkit-pre-$$ for the last declared PRE target.
# If no PRE block was declared, outputs a warning.
#
# To register a PRE block, the PostToolUse hook on Bash captures
# [PRE] blocks from the conversation and writes the target to the temp file.

PRE_FILE="/tmp/.archkit-pre-$$"

# Skip for test files, config files, and non-source files
if echo "$TOOL_INPUT" | grep -qE '\.(test|spec|config|json|md|yaml|yml|lock)'; then
  exit 0
fi

# Skip for files outside src/
if ! echo "$TOOL_INPUT" | grep -q 'src/'; then
  exit 0
fi

if [ ! -f "$PRE_FILE" ]; then
  echo "[ARCHKIT] WARNING: No [PRE] block declared before this file change."
  echo "[ARCHKIT] Output a [PRE] block with target, feature, layer, and checks before writing code."
  echo "[ARCHKIT] See SYSTEM.md — Structured I/O section."
  exit 0
fi

# Check if the PRE target matches this file (loose check)
LAST_TARGET=$(cat "$PRE_FILE" 2>/dev/null)
if [ -n "$LAST_TARGET" ]; then
  # Clear after use — each file change needs its own PRE
  rm -f "$PRE_FILE"
fi

exit 0

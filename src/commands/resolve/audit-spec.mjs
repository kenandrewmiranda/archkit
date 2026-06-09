// Audits a spec/PRD against the source tree: parses `- [ ] REQ-...` requirements
// and reports which appear to have corresponding code. This is requirement
// COVERAGE — distinct from archkit_prd_check, which scores archetype/mode drift
// of a PRD vs SYSTEM.md. Mirrors verify-wiring.mjs/warmup.mjs: a single
// run-style JSON export shared by the resolve CLI dispatch and the MCP handler
// (no logic fork).

import fs from "fs";
import path from "path";
import * as log from "../../lib/logger.mjs";
import { parseRequirements, checkCoverage, formatCoverageReport } from "../../lib/spec-tracker.mjs";

const REQ_FORMAT_HINT = "Requirement lines must look like `- [ ] REQ-001: Description` (or a `| REQ-001 | ... |` table row).";

// archDir is accepted for signature parity with the other resolve/*Json
// exports (the MCP handler resolves it via requireArchDir to guarantee we're in
// an archkit project) — the audit itself only needs specFile + srcDir.
export function runAuditSpecJson({ archDir, specFile, srcDir = "src" }) {
  if (!specFile) {
    return {
      error: "No spec file provided",
      suggestion: `Pass a spec/PRD path. ${REQ_FORMAT_HINT}`,
      nextStep: "Re-run with a specFile path pointing at a doc containing `- [ ] REQ-...` lines.",
    };
  }

  const resolvedSpec = path.resolve(specFile);
  if (!fs.existsSync(resolvedSpec)) {
    return {
      error: `Spec file not found: ${specFile}`,
      suggestion: `Check the path is correct and the file exists. ${REQ_FORMAT_HINT}`,
      nextStep: "Re-run archkit_audit_spec with a valid specFile path.",
    };
  }

  log.resolve(`Auditing spec: ${specFile} against ${srcDir}`);
  const reqs = parseRequirements(resolvedSpec);
  if (reqs.length === 0) {
    return {
      error: "No requirements found in spec",
      specFile,
      suggestion: `Add at least one requirement line. ${REQ_FORMAT_HINT}`,
      nextStep: "Add `- [ ] REQ-...` lines to the spec, then re-run archkit_audit_spec.",
    };
  }

  log.resolve(`Found ${reqs.length} requirements`);
  const report = formatCoverageReport(checkCoverage(reqs, path.resolve(srcDir)));

  const nextStep = report.uncovered > 0
    ? `${report.covered}/${report.total} requirements covered (${report.uncovered} uncovered, ${report.coveragePercent}%). Implement or verify the uncovered REQs, then re-audit.`
    : `All ${report.total} requirements show code coverage (${report.coveragePercent}%). Confirm each uncovered-to-covered match is real before relying on it.`;

  return { ...report, specFile, srcDir, nextStep };
}

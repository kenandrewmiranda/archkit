// Feature completeness checks.
// Flags implementation files that are missing their corresponding test,
// seed data, or integration test.

import fs from "fs";
import path from "path";

export function checkFeatureCompleteness(code, filepath) {
  const findings = [];

  // Skip test files, config, types-only files
  if (/\.(test|spec)\./i.test(filepath)) return findings;
  if (/\.(config|types|dto|entity|model|validation|schema)\./i.test(filepath)) return findings;

  // Only check implementation files (service, controller, handler, chain)
  const isImpl = /\.(service|controller|repository|handler|chain|route|router)\./i.test(filepath);
  if (!isImpl) return findings;

  // Check for corresponding test file
  const dir = path.dirname(filepath);
  const base = path.basename(filepath).replace(/\.(ts|tsx|js|mjs)$/, "");
  const testPatterns = [
    `${base}.test.ts`, `${base}.test.js`,
    `${base}.spec.ts`, `${base}.spec.js`,
    `__tests__/${base}.test.ts`, `__tests__/${base}.test.js`,
  ];

  const hasTest = testPatterns.some(tp => {
    const testPath = path.join(dir, tp);
    return fs.existsSync(testPath);
  });

  if (!hasTest) {
    findings.push({
      severity: "warning",
      type: "completeness",
      message: `No test file found for ${path.basename(filepath)}`,
      fix: `Create ${base}.test.ts with unit tests (service) or integration tests (controller/handler).`,
      reason: "Implementation without tests is untested code in production. Ref: Martin Fowler — Test Pyramid.",
    });
  }

  // Check if this is a controller/handler — should have integration test content
  if (hasTest && /\.(controller|handler|route|router)\./i.test(filepath)) {
    const testFile = testPatterns.find(tp => fs.existsSync(path.join(dir, tp)));
    if (testFile) {
      const testContent = fs.readFileSync(path.join(dir, testFile), "utf8");
      // Integration test should make HTTP requests, not just unit test
      const hasHttpTest = /supertest|request\(|fetch\(|\.get\(|\.post\(|\.put\(|\.delete\(/i.test(testContent);
      if (!hasHttpTest) {
        findings.push({
          severity: "info",
          type: "completeness",
          message: `Test file for ${path.basename(filepath)} may lack integration tests (no HTTP assertions found)`,
          fix: "Add integration test that verifies the API endpoint returns correct status codes and response shape.",
          reason: "Integration tests verify component interaction through real boundaries. Ref: Fowler — IntegrationTest.",
        });
      }
    }
  }

  return findings;
}

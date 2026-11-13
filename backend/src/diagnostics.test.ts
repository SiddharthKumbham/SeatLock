import assert from "node:assert/strict";
import test from "node:test";
import { safeErrorDetails } from "./diagnostics.js";

test("startup diagnostics retain the failure code and redact connection secrets", () => {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgresql://example:private-password@localhost:5432/example";
  try {
    const error = Object.assign(new Error(`Connection to ${process.env.DATABASE_URL} failed; token=private-token`), { code: "42P01" });
    const details = safeErrorDetails(error);
    assert.equal(details.type, "Error");
    assert.equal(details.code, "42P01");
    assert.match(details.message, /Connection to \[redacted\] failed/);
    assert.doesNotMatch(JSON.stringify(details), /private-password|private-token/);
    assert.ok(details.stack.length > 0);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
});

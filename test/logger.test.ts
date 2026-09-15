import assert from "node:assert/strict";
import test from "node:test";
import { redactLogMessage } from "../src/logger/Logger.js";

test("logs redact credentials and authentication query values", () => {
  const redacted = redactLogMessage(
    "https://example.test/callback?ticket=secret-ticket&code=auth-code Authorization: Bearer secret Cookie: JSESSIONID=secret"
  );
  assert.doesNotMatch(redacted, /secret-ticket|auth-code|Bearer secret|JSESSIONID=secret/);
  assert.match(redacted, /\[REDACTED\]/);
});

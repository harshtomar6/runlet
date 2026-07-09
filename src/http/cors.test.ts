import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "./app";

// Default (CORS_ORIGINS unset) is "*", so browser clients work out of the box.
test("CORS: a cross-origin request gets an allow-origin header", async () => {
  const res = await createApp().request("/health", { headers: { origin: "https://app.example.com" } });
  assert.equal(res.headers.get("access-control-allow-origin"), "*");
});

test("CORS: OPTIONS preflight is answered with the allowed methods", async () => {
  const res = await createApp().request("/workflows", {
    method: "OPTIONS",
    headers: {
      origin: "https://app.example.com",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization,content-type",
    },
  });
  assert.equal(res.status, 204);
  assert.match(res.headers.get("access-control-allow-methods") ?? "", /POST/);
});

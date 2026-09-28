import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { defaultConnectors } from "./default";

async function webhook(status: number, body: string): Promise<{ url: string; close: () => void }> {
  const server = createServer((_req, res) => {
    res.statusCode = status;
    res.end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/hook`, close: () => server.close() };
}

test("slack.post via webhook fails when Slack rejects the post", async () => {
  const hook = await webhook(404, "no_service");
  try {
    await assert.rejects(
      defaultConnectors().slack.post({ channel: "#x", text: "hi", webhookUrl: hook.url }),
      /Slack webhook failed: HTTP 404 no_service/,
    );
  } finally {
    hook.close();
  }
});

test("slack.post via webhook reports ok when Slack accepts the post", async () => {
  const hook = await webhook(200, "ok");
  try {
    assert.deepEqual(await defaultConnectors().slack.post({ channel: "#x", text: "hi", webhookUrl: hook.url }), {
      ok: true,
      dryRun: false,
    });
  } finally {
    hook.close();
  }
});

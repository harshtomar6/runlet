import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { appOf, defineNode, listNodes, toCatalogEntry, toCatalogGroups } from "./index";

test("catalog entries carry an app id derived from the type prefix", () => {
  const email = listNodes().find((n) => n.type === "email.send");
  assert.ok(email);
  assert.equal(toCatalogEntry(email).app, "email");
});

test("toCatalogGroups groups node types by app", () => {
  const groups = toCatalogGroups(listNodes());
  const byApp = new Map(groups.map((g) => [g.app, g]));

  // starter catalog groups
  for (const app of ["email", "slack", "http", "control", "trigger", "data"]) {
    assert.ok(byApp.has(app), `missing group ${app}`);
  }
  // every node appears in exactly one group; totals match the flat list
  const total = groups.reduce((n, g) => n + g.nodes.length, 0);
  assert.equal(total, listNodes().length);

  const trigger = byApp.get("trigger");
  assert.ok(trigger);
  assert.equal(trigger.label, "Triggers"); // group label from the node category
  assert.ok(trigger.nodes.some((n) => n.type === "trigger.event"));
});

test("explicit app overrides the type-prefix default", () => {
  const node = defineNode({
    type: "gsheets.appendRow",
    app: "google-sheets",
    kind: "action",
    category: "Google Sheets",
    label: "Append Row",
    inputSchema: z.object({ spreadsheetId: z.string() }),
    outputs: ["success"],
  });
  assert.equal(appOf(node), "google-sheets");
  assert.equal(toCatalogEntry(node).app, "google-sheets");
});

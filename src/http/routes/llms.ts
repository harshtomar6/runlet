import { Hono } from "hono";
import { LLMS_TXT } from "../llms-content";

/**
 * Public `/llms.txt` — serves the LLM-oriented build guide (WORKFLOW_API.md)
 * as plain text, following the llmstxt.org convention. Point any AI at this URL
 * and it can build workflows against this API from natural language.
 */
export const llms = new Hono();

llms.get("/", (c) => {
  c.header("cache-control", "public, max-age=3600");
  return c.text(LLMS_TXT);
});

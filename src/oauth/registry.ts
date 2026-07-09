import { slackProvider } from "./slack";
import type { OAuthProvider } from "./types";

/** Registered OAuth providers, keyed by id. Add Google/Notion/etc. here. */
export const providers: Record<string, OAuthProvider> = {
  [slackProvider.id]: slackProvider,
};

export function getProvider(id: string): OAuthProvider | undefined {
  return providers[id];
}

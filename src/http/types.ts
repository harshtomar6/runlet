/** Hono environment: variables set by middleware and read by handlers. */
export interface AppEnv {
  Variables: {
    ownerId: string;
    requestId: string;
  };
}

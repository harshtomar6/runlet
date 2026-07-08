/** Raised by an adapter when a port method is intentionally unsupported. */
export class UnsupportedOperation extends Error {
  constructor(op: string, adapter: string) {
    super(`Operation "${op}" is not supported by the "${adapter}" adapter`);
    this.name = "UnsupportedOperation";
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

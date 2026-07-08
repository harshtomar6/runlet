/** Application error carrying an HTTP status + machine-readable code. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** 400 raised when a workflow graph fails structural validation. */
export class ValidationFailed extends ApiError {
  constructor(errors: unknown) {
    super(400, "validation_failed", "Workflow graph validation failed", errors);
    this.name = "ValidationFailed";
  }
}

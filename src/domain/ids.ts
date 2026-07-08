import { ulid } from "ulid";

/** App-generated, sortable, store-agnostic identifiers. */
export const newId = (): string => ulid();

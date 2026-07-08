import "./catalog"; // registers the starter catalog (side-effect)

export { defineNode, toCatalogEntry } from "./define";
export type { CatalogEntry, NodeDefinition, NodeKind } from "./define";
export { getNode, hasNode, listNodes } from "./registry";

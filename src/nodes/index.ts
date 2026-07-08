import "./catalog"; // registers the starter catalog (side-effect)

export { appOf, defineNode, toCatalogEntry, toCatalogGroups } from "./define";
export type { CatalogEntry, CatalogGroup, NodeDefinition, NodeKind } from "./define";
export { getNode, hasNode, listNodes } from "./registry";

import type { NodeDefinition } from "./define";

const registry = new Map<string, NodeDefinition>();

export function registerNode(def: NodeDefinition): void {
  if (registry.has(def.type)) {
    throw new Error(`Node type already registered: ${def.type}`);
  }
  registry.set(def.type, def);
}

export function getNode(type: string): NodeDefinition | undefined {
  return registry.get(type);
}

export function hasNode(type: string): boolean {
  return registry.has(type);
}

export function listNodes(): NodeDefinition[] {
  return [...registry.values()].sort((a, b) => a.type.localeCompare(b.type));
}

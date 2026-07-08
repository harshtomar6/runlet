import { registerNode } from "../registry";
import { actionNodes } from "./actions";
import { controlNodes } from "./control";
import { dataNodes } from "./data";
import { triggerNodes } from "./triggers";

/** Side-effect: registers the starter catalog on import. */
for (const def of [...triggerNodes, ...actionNodes, ...controlNodes, ...dataNodes]) {
  registerNode(def);
}

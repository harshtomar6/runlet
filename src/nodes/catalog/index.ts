import { registerNode } from "../registry";
import { actionNodes } from "./actions";
import { controlNodes } from "./control";
import { dataNodes } from "./data";
import { triggerNodes } from "./triggers";
import { utilNodes } from "./util";

/** Side-effect: registers the starter catalog on import. */
for (const def of [...triggerNodes, ...actionNodes, ...controlNodes, ...dataNodes, ...utilNodes]) {
  registerNode(def);
}

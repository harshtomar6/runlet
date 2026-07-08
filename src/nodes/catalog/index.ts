import { registerNode } from "../registry";
import { actionNodes } from "./actions";
import { aiNodes } from "./ai";
import { controlNodes } from "./control";
import { dataNodes } from "./data";
import { triggerNodes } from "./triggers";
import { utilNodes } from "./util";

/** Side-effect: registers the starter catalog on import. */
for (const def of [
  ...triggerNodes,
  ...actionNodes,
  ...aiNodes,
  ...controlNodes,
  ...dataNodes,
  ...utilNodes,
]) {
  registerNode(def);
}

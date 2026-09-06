import { PortableAgentInstance, useModel, usePersistentState } from "../../../packages/agent-runtime/src/index.ts";
const instance = new PortableAgentInstance({ id: "nodepod-portable" });
let setCount: ((update: (count: number) => number) => void) | undefined;
function Teacher() {
  useModel("local/test");
  const [count, setter] = usePersistentState("count", 0);
  setCount = setter;
  return `Completed probes: ${count}`;
}
if (instance.render(Teacher).system !== "Completed probes: 0") throw new Error("Initial frame missing");
setCount!((count) => count + 1);
if (instance.render(Teacher).system !== "Completed probes: 1") throw new Error("State did not survive render");
console.log("PORTABLE_NODEPOD_RESULT=ok");

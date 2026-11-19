import type { Meta, StoryObj } from "@storybook/react-vite";
import { SimulationRenderer } from "../SimulationRenderer";

const meta = {
  title:"Learning/Simulation phone controls",
  component:SimulationRenderer,
  decorators:[Story=><div style={{width:"min(320px,100%)"}}><Story /></div>],
  args:{node:{type:"simulation",id:"sweep",title:"A sampled sweep",
    parameters:[{id:"x",label:"Selected horizontal axis with a long variable name",min:-2,max:2,step:1,value:0}],
    readouts:[{id:"y",label:"Observed readout with an undefined sample",expr:"1/x"}]}}
} satisfies Meta<typeof SimulationRenderer>;
export default meta;
export const Discontinuous:StoryObj<typeof meta> = {};

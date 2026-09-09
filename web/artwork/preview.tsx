import React from "react";
import {createRoot} from "react-dom/client";
import {KeatingBot, type KeatingBotState} from "../src/components/KeatingBot";
import {AppStatusScreen, type AppStatus} from "../src/components/AppStatusScreen";
const states:KeatingBotState[]=["idle","waving","listening","thinking","speaking","success"];
function Gallery(){
 const [view,setView]=React.useState<AppStatus|"animation">((new URLSearchParams(location.search).get("view") as AppStatus)||"animation");
 if(view!=="animation") return <><div className="controls" style={{padding:16}}><button onClick={()=>setView("animation")}>Animations</button>{(["loading","404","403","500","offline"] as AppStatus[]).map(s=><button key={s} onClick={()=>setView(s)}>{s}</button>)}</div><AppStatusScreen status={view} onRetry={()=>setView("loading")}/></>;
 return <AnimationGallery onStatus={setView}/>;
}
function AnimationGallery({onStatus}:{onStatus:(s:AppStatus)=>void}){
 const [state,setState]=React.useState<KeatingBotState>("waving");
 const [frame,setFrame]=React.useState<number|undefined>();
 const count=state==="waving"?12:state==="speaking"?8:4;
 return <main><h1>Keatingbot in motion</h1><p>Twelve greeting frames · four thinking frames · eight speaking mouth shapes</p>
 <div className="controls">{(["loading","404","403","500","offline"] as AppStatus[]).map(s=><button key={s} onClick={()=>onStatus(s)}>{s} page</button>)}</div>
 <div className="controls">{states.map(s=><button key={s} onClick={()=>{setState(s);setFrame(undefined)}} aria-pressed={state===s}>{s}</button>)}
 <button onClick={()=>document.documentElement.dataset.motion=document.documentElement.dataset.motion==="reduce"?"":"reduce"}>Toggle reduced motion</button></div>
 <section className="stage"><KeatingBot state={state} variant="body" size={220} frame={frame}/><div><h2>{state}</h2><KeatingBot state={state} size={112} frame={frame}/><KeatingBot state={state} size={40} frame={frame}/></div></section>
 <div className="controls"><button onClick={()=>setFrame(undefined)}>Play loop</button>
 {Array.from({length:count},(_,i)=><button key={i} aria-pressed={frame===i} onClick={()=>setFrame(i)}>Frame {i+1}</button>)}</div>
 {["light","dark"].map(theme=><section key={theme} className={"gallery "+theme}>{states.map(s=><div key={s}><KeatingBot variant="body" state={s} size={136}/><KeatingBot state={s} size={44}/><p>{s}</p></div>)}</section>)}</main>;
}
createRoot(document.getElementById("root")!).render(<Gallery/>);

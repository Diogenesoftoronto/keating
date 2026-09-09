const input=document.querySelector('#search');
const results=document.querySelector('#results');
let index;
input.addEventListener('input',async()=>{
 const query=input.value.trim().toLowerCase();
 if(!query){results.hidden=true;results.replaceChildren();return;}
 try {index ||= await fetch('/search.json').then(r=>{if(!r.ok)throw Error();return r.json()});}
 catch {results.hidden=false;results.textContent='Search could not load. Browse the navigation instead.';return;}
 if(input.value.trim().toLowerCase()!==query)return;
 const words=query.split(/\s+/);
 const matches=index.filter(p=>words.every(w=>(p.title+' '+p.description+' '+p.text).toLowerCase().includes(w))).sort((a,b)=>Number(b.title.toLowerCase().includes(query))-Number(a.title.toLowerCase().includes(query))).slice(0,8);
 results.replaceChildren();results.hidden=false;
 const count=document.createElement('p');count.textContent=matches.length?`${matches.length} matching guides`:'No guides found. Try “tools”, “models”, or “courses”.';results.append(count);
 for(const p of matches){const a=document.createElement('a');a.href=p.url;const title=document.createElement('strong');title.textContent=p.title;const description=document.createElement('span');description.textContent=p.description;a.append(title,description);results.append(a);}
});
input.addEventListener('keydown',event=>{if(event.key==='Escape'){input.value='';results.hidden=true;}});

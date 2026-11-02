// SPDX-License-Identifier: GPL-3.0-only
// Passive frequency-dependent round-trip impedance loss. Each biquad is a cut,
// never a boost; targets are amplitude T60 seconds of physical string modes.
export function response(c,w){const a=Math.cos(w),b=-Math.sin(w),a2=Math.cos(2*w),b2=-Math.sin(2*w),nr=c.b0+c.b1*a+c.b2*a2,ni=c.b1*b+c.b2*b2,dr=1+c.a1*a+c.a2*a2,di=c.a1*b+c.a2*b2,den=dr*dr+di*di;return {re:(nr*dr+ni*di)/den,im:(ni*dr-nr*di)/den};}
function cut(fs,hz,q,db){const w=2*Math.PI*hz/fs,A=10**(-db/40),alpha=Math.sin(w)/(2*q),den=1+alpha/A;return {b0:(1+alpha*A)/den,b1:-2*Math.cos(w)/den,b2:(1-alpha*A)/den,a1:-2*Math.cos(w)/den,a2:(1-alpha/A)/den};}
export function designLoopLoss(fs,f0,B,targets){
 if(!Array.isArray(targets)||!targets.length||targets.some(t=>typeof t!=='number'||!Number.isFinite(t)||t<=0))throw Error('Invalid partial decay targets');
 const ts=targets.slice(0,24).map(t=>Math.max(.08,Math.min(40,t))),freq=ts.map((_,i)=>(i+1)*f0*Math.sqrt((1+B*(i+1)**2)/(1+B))).filter(f=>f<fs*.42),desired=freq.map((_,i)=>60/(f0*ts[i]));
 if(!freq.length||ts.some(t=>!Number.isFinite(t)))throw Error('Invalid partial decay targets');
 const attenuation=(pole,f)=>-20*Math.log10((1-pole)/Math.sqrt(1+pole*pole-2*pole*Math.cos(2*Math.PI*f/fs)));
 let lo=0,hi=.95;for(let i=0;i<36;i++){const p=(lo+hi)/2;if(freq.every((f,j)=>attenuation(p,f)<desired[j]*.75))lo=p;else hi=p;}
 const pole=lo,baseDb=Math.max(0,Math.min(...desired.map((d,i)=>d-attenuation(pole,freq[i])))*.8),target=desired.map((d,i)=>Math.max(0,d-baseDb-attenuation(pole,freq[i]))),unit=freq.map((f,i)=>cut(fs,f,Math.max(12,(i+1)*1.5),1)),matrix=freq.map(f=>unit.map(c=>{const z=response(c,2*Math.PI*f/fs);return -20*Math.log10(Math.hypot(z.re,z.im));})),weights=freq.map(()=>0);
 for(let pass=0;pass<24;pass++)for(let j=0;j<freq.length;j++){let xy=0,xx=0;for(let i=0;i<freq.length;i++){const other=matrix[i].reduce((s,v,k)=>s+(k===j?0:v*weights[k]),0);xy+=matrix[i][j]*(target[i]-other);xx+=matrix[i][j]**2;}weights[j]=Math.max(0,xy/Math.max(1e-12,xx));}
 return {pole,gain:10**(-baseDb/20),cuts:freq.map((f,i)=>cut(fs,f,Math.max(12,(i+1)*1.5),weights[i])),frequencies:freq,targets:ts,baseDb};
}
export class LossBank{
 constructor(spec){this.filters=spec.cuts.map(c=>({...c,x1:0,x2:0,y1:0,y2:0}));}
 run(v){for(const c of this.filters){const y=c.b0*v+c.b1*c.x1+c.b2*c.x2-c.a1*c.y1-c.a2*c.y2;c.x2=c.x1;c.x1=v;c.y2=c.y1;c.y1=y;v=y;}return v;}
}

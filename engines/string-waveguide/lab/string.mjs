// SPDX-License-Identifier: GPL-3.0-only
import {rng,clamp} from './dsp.mjs';
import {designLoopLoss,LossBank,response} from './loss.mjs';
// Bidirectional velocity-wave network. Delays use lossless first-order allpass
// fractional interpolation; shunt contact junctions are passive for k in [0,.5].
class Allpass{
 constructor(a){this.a=a;this.x=0;this.y=0;}
 run(x){const y=this.a*x+this.x-this.a*this.y;this.x=x;this.y=y;return y;}
}
class Delay{
 constructor(d,initial){this.buf=new Float64Array(Math.ceil(d)+8);this.i=0;this.ap=new Allpass(0);this.set(d);
  for(let k=1;k<this.buf.length;k++)this.buf[(this.buf.length-k)%this.buf.length]=initial(Math.min(1,k/d));
  this.ap.x=initial(1);this.ap.y=initial(1);
 }
 set(d){this.d=Math.max(1.01,d);this.n=Math.floor(this.d);const f=this.d-this.n;this.ap.a=(1-f)/(1+f);}
 read(){return this.ap.run(this.buf[(this.i-this.n+this.buf.length)%this.buf.length]);}
 write(v){this.buf[this.i]=v;this.i=(this.i+1)%this.buf.length;}
}
function fdPhase(d,w){const n=Math.floor(d),f=d-n;return n*w+2*Math.atan(f*Math.tan(w/2));}
function contactGain(c,t){if(t<c.startS||t>=c.endS)return 0;return c.amount*Math.min(1,(t-c.startS)/c.rampS,(c.endS-t)/c.rampS);}
class Body{
 constructor(modes,fs){this.dt=1/fs;this.m=modes.map(m=>{const dt=this.dt,w=2*Math.PI*m.frequencyHz,g=2*Math.log(1000)/m.t60S,den=1+g*dt/2+w*w*dt*dt/4;return {...m,q:0,v:0,a:(1-g*dt/2-w*w*dt*dt/4)/den,d:w*w*dt/den,b:dt/(m.massKg*den)};});}
 port(incoming,Z,frame,modeRadiation){let free=0,b=0;for(const m of this.m){m.free=.5*((1+m.a)*m.v-m.d*m.q);free+=m.coupling*m.free;b+=.5*m.b*m.coupling**2;}
  const vm=(free+2*b*Z*incoming)/(1+2*b*Z),F=2*Z*(incoming-vm);let out=0;
  for(let j=0;j<this.m.length;j++){const m=this.m[j],v1=m.a*m.v-m.d*m.q+m.b*m.coupling*F,v=m.coupling*.5*(v1+m.v);out+=m.radiationGain*v;if(modeRadiation)modeRadiation[j][frame]+=v;m.q+=this.dt*.5*(m.v+v1);m.v=v1;}
  return {reflected:2*vm-incoming,radiation:out,force:F};
 }
}
export function solveString(r,{retainWaves=true,retainModes=false}={}){
 const fs=r.output.sampleRate,N=Math.round(fs*r.output.durationS),rand=rng(r.seed),L=r.lengthM,f=r.frequencyHz,c=2*L*f/Math.sqrt(1+r.B),Z=Math.sqrt(r.tensionN*r.string.linearDensityKgM);
 const p=clamp(r.pluck.positionRatio+(rand()-.5)*.012,.025,.95),F=r.pluck.forceN*r.note.velocity*(.96+.08*rand()),height=F*L*p*(1-p)/r.tensionN;
 if(height/L>.025)throw Error('Pluck exceeds small-slope model');
 const positions=[0,L],contacts=r.contacts.filter(v=>v.amount>0&&(!v.stringId||v.stringId===r.note.stringId));
 // Optional withdrawal of the holding force acts at the physical pick junction.
 // The old rounded spatial initial condition alone releases instantaneously.
 const releaseTime=r.pluck.releaseTimeS??0,pickPosition=p*L;if(releaseTime>0)positions.push(pickPosition);
 if(r.gesture&&['hammer','pull'].includes(r.gesture.type))positions.push(L*.798,L*.802);
 for(const ct of contacts){positions.push(clamp(ct.positionM-ct.widthM*.25,.001,L-.001));positions.push(clamp(ct.positionM+ct.widthM*.25,.001,L-.001));}
 positions.sort((a,b)=>a-b);const nodes=positions.filter((x,i)=>!i||x-positions[i-1]>.0002),ratios=nodes.slice(1).map((v,i)=>(v-nodes[i])/L);
 const pickJunction=releaseTime>0?nodes.findIndex(v=>Math.abs(v-pickPosition)<.0002):-1;
 // Four allpasses, cubic low-frequency phase-delay fit to the physical B target.
 const w=2*Math.PI*f/fs,count=4,target=6*(fs/f)*r.B/(count*w*w);let lo=1,hi=100;
 for(let i=0;i<40;i++){const v=(lo+hi)/2;if(v*(v*v-1)>target)hi=v;else lo=v;}
 const dispR=Math.min((lo+hi)/2,fs/f*.35/count),dispA=(1-dispR)/(1+dispR),disp=Array.from({length:count},()=>new Allpass(dispA));
 const gamma=Math.log(1000)/r.string.loss.t60LowS,fh=Math.min(3000,fs*.25),targetMag=Math.exp(-gamma*r.string.loss.highLoss*((fh/1000)**1.5-(f/1000)**1.5)/f);
 lo=0;hi=.98;for(let i=0;i<40;i++){const a=(lo+hi)/2,mag=(1-a)/Math.sqrt(1+a*a-2*a*Math.cos(2*Math.PI*fh/fs));if(mag>targetMag)lo=a;else hi=a;}
 const lossSpec=r.string.loss.partialT60S?designLoopLoss(fs,f,r.B,r.string.loss.partialT60S):null,pole=lossSpec?.pole??(lo+hi)/2,lossMag=(1-pole)/Math.sqrt(1+pole*pole-2*pole*Math.cos(w)),gain=lossSpec?.gain??Math.min(.999999,Math.exp(-gamma/f)/lossMag),lossPhase=Math.atan2(pole*Math.sin(w),1-pole*Math.cos(w)),cutPhase=lossSpec?.cuts.reduce((s,c)=>{const z=response(c,w);return s-Math.atan2(z.im,z.re);},0)??0;
 const totalPhase=d=>2*ratios.reduce((s,v)=>s+fdPhase(Math.max(1.01,d*v/2),w),0)+count*2*Math.atan(dispR*Math.tan(w/2))+lossPhase+cutPhase;
 lo=2*ratios.length+1;hi=fs/f;for(let i=0;i<48;i++){const d=(lo+hi)/2;if(totalPhase(d)>2*Math.PI)hi=d;else lo=d;}
 const delay=(lo+hi)/2;if(totalPhase(delay)>2*Math.PI+.03)throw Error('Contact geometry exceeds supported waveguide resolution');
 // Rounded pick contact smooths the slope discontinuity, not a noise-loop exciter.
 const smooth=Math.max(.0002,r.pluck.contactWidthM!==undefined?r.pluck.contactWidthM/L:r.pluck.contactTimeS*c/L),slope=x=>{const a=height/(p*L),b=-height/((1-p)*L);return a+(b-a)*(.5+.5*Math.tanh((x/L-p)/smooth));};
 const pols=[{weight:Math.cos(r.pluck.directionRad),detune:1},{weight:Math.sin(r.pluck.directionRad),detune:1.0008}];
 const radiation=new Float64Array(N),modeRadiation=retainModes?r.bodyModes.map(()=>new Float32Array(N)):null,waveData=[],trajectory=new Float32Array(N),initialScale=r.gesture?2**(-r.gesture.fromSemitones/12):1;
 const pickAudit=releaseTime>0&&!r.gesture?{forceWorkJ:0,shuntDissipationJ:0,waveWorkJ:0,maxPowerResidualW:0}:null;
 for(let pi=0;pi<pols.length;pi++){
  const pol=pols[pi],body=new Body(r.bodyModes,fs),noiseRand=rng((r.seed+pi*1013904223)>>>0),right=[],left=[],histR=[],histL=[];
  for(let j=0;j<ratios.length;j++){const a=nodes[j],b=nodes[j+1],d=delay*ratios[j]/2/pol.detune;right.push(new Delay(d*Math.max(1,initialScale),u=>-.5*c*slope(a+u*(b-a))*pol.weight));left.push(new Delay(d*Math.max(1,initialScale),u=>.5*c*slope(b-u*(b-a))*pol.weight));right[j].set(d*initialScale);left[j].set(d*initialScale);histR.push(new Float32Array(N));histL.push(new Float32Array(N));}
  const filters=disp.map(a=>new Allpass(a.a)),lossBank=lossSpec?new LossBank(lossSpec):null;let lp=0,energy=0,noiseLP=0;
  if(releaseTime>0){const held=-.5*c*slope(0)*pol.weight;for(const ap of filters){ap.x=held;ap.y=held;}lp=held;if(lossBank)for(const cut of lossBank.filters){cut.x1=held;cut.x2=held;cut.y1=held;cut.y2=held;}}
  const incomingR=new Float64Array(right.length),incomingL=new Float64Array(left.length),outR=new Float64Array(right.length),outL=new Float64Array(left.length);
  for(let i=0;i<N;i++){
   const t=i/fs;
   for(let j=0;j<right.length;j++){incomingR[j]=right[j].read();incomingL[j]=left[j].read();}
   const b=body.port(incomingL[0],Z,i,modeRadiation);outR[0]=r.kind==='acoustic'?b.reflected:-incomingL[0];radiation[i]+=b.radiation;
   outL[left.length-1]=-incomingR[right.length-1];
   for(let j=1;j<nodes.length-1;j++){
    let amount=0;for(const ct of contacts)if(Math.abs(nodes[j]-ct.positionM)<ct.widthM*.4+.0002)amount=Math.max(amount,contactGain(ct,t));
    const a=incomingR[j-1],b=incomingL[j],k=.48*amount;
    outL[j-1]=b-k*(a+b);outR[j]=a-k*(a+b);
    if(r.gesture&&['hammer','pull'].includes(r.gesture.type)&&Math.abs(nodes[j]-.8*L)<.02*L){const u=(t-r.gesture.startS)/.003;if(u>=0&&u<1){const impulse=F*Math.sin(Math.PI*u)/(2*Z)*(r.gesture.type==='pull'?-1:1);outL[j-1]+=impulse;outR[j]+=impulse;}}
    if(j===pickJunction&&t<releaseTime){const appliedForce=F*(1-(r.pluck.releaseSnapFraction??0))*(1-t/releaseTime)*pol.weight,holding=F*(1-(r.pluck.releaseSnapFraction??0))*(1-t/releaseTime)/(2*Z)*pol.weight*(1-k);outL[j-1]+=holding;outR[j]+=holding;
     if(pickAudit){const velocity=a+outL[j-1],forcePower=appliedForce*velocity,shuntPower=2*Z*k/(1-k)*velocity**2,wavePower=Z*(outL[j-1]**2+outR[j]**2-a*a-b*b);pickAudit.forceWorkJ+=forcePower/fs;pickAudit.shuntDissipationJ+=shuntPower/fs;pickAudit.waveWorkJ+=wavePower/fs;pickAudit.maxPowerResidualW=Math.max(pickAudit.maxPowerResidualW,Math.abs(wavePower-forcePower+shuntPower));}
    }
   }
   let v=outR[0];for(const ap of filters)v=ap.run(v);lp=(1-pole)*v+pole*lp;
   const release=t>r.note.gateS?Math.exp(-Math.log(1000)/(f*.12)):1;
   outR[0]=(lossBank?lossBank.run(lp):lp)*gain*release;
   // Small-slope quasi-static tension feedback from travelling-wave energy.
   energy+=.001*((incomingL[0]**2+incomingR.at(-1)**2)-energy);
   if((i&63)===0){const deltaT=Math.min(r.tensionN*.03,r.string.axialStiffnessN*energy/(c*c));let scale=1/Math.sqrt(1+deltaT/r.tensionN);
    if(r.gesture){const g=r.gesture,u=clamp((t-g.startS)/(g.endS-g.startS),0,1),progress=u*u*(3-2*u);scale*=2**(-g.fromSemitones*(1-progress)/12);}
    for(let j=0;j<right.length;j++){right[j].set(delay*ratios[j]/2/pol.detune*scale);left[j].set(delay*ratios[j]/2/pol.detune*scale);}}
   if(pi===0)trajectory[i]=right[0].d/(delay*ratios[0]/2/pol.detune);
   const pickEnv=Math.exp(-t/.003),releaseEnv=t>r.note.gateS?Math.exp(-(t-r.note.gateS)/.005):0;
   noiseLP+=.3*((noiseRand()*2-1)-noiseLP);outR[0]+=r.pluck.noise*F*noiseLP*(pickEnv+releaseEnv*.15)*pol.weight;
   for(let j=0;j<right.length;j++){histR[j][i]=outR[j];histL[j][i]=outL[j];right[j].write(outR[j]);left[j].write(outL[j]);}
   if(!Number.isFinite(outR[0])||Math.abs(outR[0])>100)throw Error('Unstable physical state');
  }
  waveData.push({right:histR,left:histL,weight:pi===0?1:.65});
 }
 return {sampleRate:fs,frames:N,nodes,delay,ratios,trajectory,waves:waveData,radiation,...(modeRadiation?{modeRadiation}:{}),diagnostics:{delaySamples:delay,dispersionAllpass:dispA,lossPole:pole,lossGain:gain,initialHeightM:height,physicalB:r.B,gesture:r.gesture,initialLengthM:L*(r.gesture?.type==='bend'?1:initialScale),provisional:true,...(pickAudit?{pickJunctionEnergy:pickAudit}:{})}};
}
function interp(a,index){if(index<0||index>=a.length)return 0;const k=Math.floor(index),f=index-k;return a[k]*(1-f)+(a[k+1]??a[k])*f;}
export function observePickup(s,r){
 const y=new Float64Array(s.frames),fs=s.sampleRate,x=r.pickup.positionM,width=r.pickup.apertureM;let lp=0,dc=0,x1=0,x2=0,y1=0,y2=0;const alpha=1-Math.exp(-2*Math.PI*r.pickup.loadHz/fs),hp=r.pickup.couplingTimeConstantS===undefined?1-Math.exp(-2*Math.PI*20/fs):1-Math.exp(-1/(r.pickup.couplingTimeConstantS*fs));
 const w=2*Math.PI*Math.min(r.pickup.resonanceHz??5500,fs*.45)/fs,cos=Math.cos(w),a=Math.sin(w)/(2*(r.pickup.resonanceQ??.707)),den=1+a,b0=(1-cos)/2/den,b1=(1-cos)/den,b2=b0,a1=-2*cos/den,a2=(1-a)/den;
 for(let i=0;i<y.length;i++){let v=0;
  for(const p of s.waves){for(const shift of [-.5,0,.5]){const pos=clamp(x+shift*width,.0001,r.lengthM-.0001);let j=s.nodes.findIndex((n,k)=>k<s.nodes.length-1&&pos>=n&&pos<=s.nodes[k+1]);if(j<0)j=s.nodes.length-2;
   const d=s.delay*(s.trajectory?.[i]??1)/2/r.lengthM,dr=(pos-s.nodes[j])*d,dl=(s.nodes[j+1]-pos)*d;
   v+=p.weight*(interp(p.right[j],i-dr)+interp(p.left[j],i-dl))/3;
  }}const resonant=b0*v+b1*x1+b2*x2-a1*y1-a2*y2;x2=x1;x1=v;y2=y1;y1=resonant;lp+=alpha*(resonant-lp);dc+=hp*(lp-dc);y[i]=(lp-dc)*r.outputGain*(r.pickup.gain??1);
 }return y;
}

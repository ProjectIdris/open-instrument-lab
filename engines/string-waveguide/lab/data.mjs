// SPDX-License-Identifier: GPL-3.0-only
import {clamp} from './dsp.mjs';
export const midiHz=m=>440*2**((m-69)/12);
const pi=Math.PI;
function preset(id,L,opens,tensions,gauges,kind){
 return {id,name:id,family:'plucked',scaleLengthM:L,fretCount:24,kind,dataStatus:'provisional textbook/manufacturer-typical policy; not a measured instrument',
 strings:opens.map((m,i)=>{const d=gauges[i]*.0254,wound=kind==='bass'||i<(kind==='acoustic'?4:3),core=d*(wound?.44:1);return {id:'s'+(i+1),openMidi:m,linearDensityKgM:tensions[i]/(2*L*midiHz(m))**2,diameterM:d,axialStiffnessN:2e11*pi*core**2/4,effectiveBendingStiffnessNm2:2e11*pi*core**4/64,loss:{t60LowS:kind==='acoustic'?4.8:kind==='bass'?6:7,highLoss:kind==='acoustic'?2:1.2},provisional:['linearDensityKgM','effectiveBendingStiffnessNm2','axialStiffnessN','loss']} ;}),
 pickup:{positionM:kind==='bass'?.14:.12,apertureM:.012,loadHz:12000,resonanceHz:kind==='bass'?3500:5500,resonanceQ:.707},
 bodyModes:kind==='acoustic'?[{frequencyHz:105,t60S:.32,massKg:.45,coupling:.3,radiationGain:.7},{frequencyHz:205,t60S:.42,massKg:.22,coupling:.25,radiationGain:1},{frequencyHz:395,t60S:.24,massKg:.12,coupling:.2,radiationGain:.6},{frequencyHz:710,t60S:.15,massKg:.08,coupling:.12,radiationGain:.4}]:[],
 outputGain:kind==='acoustic'?4:kind==='bass'?.24:.32};
}
export const instruments={
 acoustic:preset('lab-steel',.64516,[40,45,50,55,59,64],[106,125,133,132,104,104],[.053,.042,.032,.024,.016,.012],'acoustic'),
 electric:preset('lab-electric',.6477,[40,45,50,55,59,64],[76,81,73,74,68,72],[.046,.036,.026,.017,.013,.010],'electric'),
 bass:preset('lab-bass',.8636,[28,33,38,43],[180,190,190,165],[.100,.080,.065,.045],'bass')
};
// A separate five-string assembly keeps the four-string baseline byte-stable.
// Wound core/EI is unknown: this B string is an explicit effective prior, not
// the bending stiffness of a solid rod with the published outer diameter.
instruments.bass5={...structuredClone(instruments.bass),id:'lab-bass-five',name:'Five-string picked bass',
 strings:[{id:'s1',openMidi:23,linearDensityKgM:.05,diameterM:.003302,
 axialStiffnessN:10000,effectiveBendingStiffnessNm2:.003,
 loss:{t60LowS:6,highLoss:1.2},provisional:['linearDensityKgM','effectiveBendingStiffnessNm2','axialStiffnessN','loss']},
 ...structuredClone(instruments.bass.strings).map((s,i)=>({...s,id:'s'+(i+2)}))]};
function bounded(x,name,lo,hi){if(typeof x!=='number'||!Number.isFinite(x)||x<lo||x>hi)throw Error(name+' outside '+lo+'..'+hi);return x;}
function playerVelocity(pluck,velocity){
 const points=pluck?.velocityPoints;if(points===undefined)return {};
 const limits={positionM:[.001,1],forceN:[0,5],contactWidthM:[.00005,.02],noise:[0,.2],releaseTimeS:[0,.02],releaseSnapFraction:[0,1]};
 if(!Array.isArray(points)||points.length<2||points.length>16)throw Error('Invalid player velocity points');
 const keys=Object.keys(points[0]).filter(k=>k!=='velocity');
 points.forEach((p,i)=>{bounded(p.velocity,'velocity points',0,1);if(i&&p.velocity<=points[i-1].velocity)throw Error('Unordered player velocity points');
  if(Object.keys(p).some(k=>k!=='velocity'&&!keys.includes(k))||keys.some(k=>!limits[k]||typeof p[k]!=='number'))throw Error('Inconsistent player velocity points');
  for(const k of keys)bounded(p[k],'velocity points '+k,...limits[k]);
 });
 const lo=points.filter(p=>p.velocity<=velocity).at(-1)??points[0],hi=points.find(p=>p.velocity>=velocity)??points.at(-1),mix=lo===hi?0:(velocity-lo.velocity)/(hi.velocity-lo.velocity);
 return Object.fromEntries(keys.map(k=>[k,lo===hi?lo[k]:k==='contactWidthM'?clamp(Math.exp((1-mix)*Math.log(lo[k])+mix*Math.log(hi[k])),Math.min(lo[k],hi[k]),Math.max(lo[k],hi[k])):(1-mix)*lo[k]+mix*hi[k]]));
}
export function resolveRecipe(model,recipe={}){
 const fs=bounded(recipe.output?.sampleRate??48000,'sampleRate',8000,96000),durationS=bounded(recipe.output?.durationS??4,'durationS',.02,30);
 const capo={fret:0,pressureN:0,stretchM:0,...recipe.capo};bounded(capo.fret,'capo fret',0,model.fretCount);if(!Number.isInteger(capo.fret))throw Error('Integer capo required');bounded(capo.pressureN,'capo pressure',0,100);bounded(capo.stretchM,'capo stretch',0,.001);
 const tuning=model.strings.map(s=>{const t=recipe.strings?.find(t=>t.id===s.id);return {...s,openMidi:bounded(t?.openPitchMidi??s.openMidi,'tuning',s.openMidi-12,s.openMidi+7),tuningCents:bounded(t?.tuningCents??0,'tuning cents',-100,100)};});
 const n={midi:tuning[0].openMidi+capo.fret,velocity:.6,gateS:durationS,...recipe.note};bounded(n.midi,'midi',0,127);bounded(n.velocity,'velocity',0,1);bounded(n.gateS,'gateS',0,30);
 const candidates=tuning.filter(s=>n.midi>=s.openMidi+capo.fret&&n.midi<=s.openMidi+model.fretCount);
 const s=n.stringId?tuning.find(s=>s.id===n.stringId):candidates.at(-1);if(!s||!candidates.includes(s))throw Error('Pitch is outside the physical string/fret range');
 const fret=n.midi-s.openMidi;if(n.fret!==undefined&&n.fret!==fret-capo.fret)throw Error('Fret/pitch disagreement');
 const L=model.scaleLengthM*2**(-fret/12),openF=midiHz(s.openMidi+s.tuningCents/100),mu=s.linearDensityKgM,EI=s.effectiveBendingStiffnessNm2;
 if(!(mu>0)||!(EI>=0)||!(s.axialStiffnessN>0))throw Error('Invalid physical string');
 const T=mu*(2*model.scaleLengthM*openF)**2-pi*pi*EI/model.scaleLengthM**2;
 const deltaT=capo.fret? s.axialStiffnessN*(capo.stretchM+capo.pressureN*1e-8)/model.scaleLengthM:0;
 const tensionN=bounded(T+deltaT,'tensionN',1,600),B=pi*pi*EI/(tensionN*L*L),frequencyHz=Math.sqrt((tensionN+pi*pi*EI/L**2)/mu)/(2*L);
 const pluck={positionRatio:.2,forceN:.65,directionRad:.4,contactTimeS:.0008,noise:.012,...model.pluck,...playerVelocity(model.pluck,n.velocity),...s.pluck,...playerVelocity(s.pluck,n.velocity),...recipe.pluck};
 delete pluck.velocityPoints;
 if(pluck.positionM!==undefined&&recipe.pluck?.positionRatio===undefined)pluck.positionRatio=bounded(pluck.positionM,'pluck distance',.001,L*.9)/L;
 if(pluck.contactWidthM!==undefined)bounded(pluck.contactWidthM,'pick contact width',.00005,.02);
 if(pluck.releaseTimeS!==undefined){bounded(pluck.releaseTimeS,'pick release time',0,.02);if(pluck.releaseTimeS===0)delete pluck.releaseTimeS;}
 if(pluck.releaseSnapFraction!==undefined){bounded(pluck.releaseSnapFraction,'pick release snap fraction',0,1);if(!pluck.releaseTimeS)delete pluck.releaseSnapFraction;}
 bounded(pluck.positionRatio,'pluck position',.03,.9);bounded(pluck.forceN,'pluck force',0,5);bounded(pluck.contactTimeS,'contact time',.00005,.02);bounded(pluck.directionRad,'direction',-pi,pi);bounded(pluck.noise,'pick noise',0,.2);
 const contacts=(recipe.contacts??[]).map(c=>{const v={kind:'palm',positionM:.02,widthM:.01,amount:0,startS:0,rampS:.005,endS:30,...c};if(!['palm','fretting','choke'].includes(v.kind))throw Error('Unknown contact');bounded(v.positionM,'contact position',.001,L*.98);bounded(v.widthM,'contact width',.0001,L*.3);bounded(v.amount,'mute amount',0,1);bounded(v.startS,'contact start',0,30);bounded(v.endS,'contact end',v.startS,30);bounded(v.rampS,'contact ramp',.001,1);return v;});
 const pickup={...model.pickup,...recipe.pickup};bounded(pickup.positionM,'pickup position',.001,L*.98);bounded(pickup.apertureM,'pickup aperture',.0001,L*.5);bounded(pickup.loadHz,'pickup load',100,20000);bounded(pickup.resonanceHz??5500,'pickup resonance',300,18000);bounded(pickup.resonanceQ??.707,'pickup resonance Q',.3,4);
 if(pickup.couplingTimeConstantS!==undefined)bounded(pickup.couplingTimeConstantS,'pickup coupling RC',.0001,.1);
 const stringGain=pickup.stringGain??{};if(!stringGain||typeof stringGain!=='object'||Array.isArray(stringGain))throw Error('Invalid pickup string gain');
 for(const [id,gain] of Object.entries(stringGain)){if(!tuning.some(s=>s.id===id))throw Error('Unknown pickup string gain');bounded(gain,'pickup string gain',0,8);}
 pickup.gain=bounded((pickup.gain??1)*(stringGain[s.id]??1),'pickup gain',0,8);delete pickup.stringGain;
 const gesture=recipe.gesture?{type:'slide',fromSemitones:-2,startS:.06,endS:.18,...recipe.gesture}:null;
 if(gesture){if(!['slide','bend','hammer','pull'].includes(gesture.type))throw Error('Unknown gesture');bounded(gesture.fromSemitones,'gesture interval',-7,7);bounded(gesture.startS,'gesture start',0,5);bounded(gesture.endS,'gesture end',gesture.startS+.001,10);}
 let string=s;const profile=s.loss.partialT60ByMidi;
 if(profile?.length){const midi=(s.loss.referenceOpenMidi??s.openMidi)+fret,sorted=profile.slice().sort((a,b)=>a.midi-b.midi),lo=sorted.filter(p=>p.midi<=midi).at(-1)??sorted[0],hi=sorted.find(p=>p.midi>=midi)??sorted.at(-1),mix=hi.midi===lo.midi?0:(midi-lo.midi)/(hi.midi-lo.midi),partialT60S=lo.t60S.map((t,i)=>Math.exp((1-mix)*Math.log(t)+mix*Math.log(hi.t60S[i]??t)));string={...s,loss:{...s.loss,partialT60S}};}
 if(model.bodyRadiation&&!['velocity','acceleration'].includes(model.bodyRadiation.type))throw Error('Unknown body radiation observation');
 return {schemaVersion:1,instrumentId:model.id,strings:tuning,capo,pluck,contacts,pickup,gesture,note:{...n,stringId:s.id,fret:fret-capo.fret},seed:recipe.seed??1,output:{sampleRate:fs,durationS},lengthM:L,tensionN,frequencyHz,B,string,kind:model.kind,outputGain:model.outputGain,bodyModes:model.bodyModes,bodyRadiation:model.bodyRadiation??null,dataStatus:model.dataStatus,dataEvidence:model.dataEvidence??[]};
}

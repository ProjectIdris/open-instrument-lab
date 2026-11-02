// SPDX-License-Identifier: GPL-3.0-only
// Low-ka monopole observation: pressure is proportional to the time derivative
// of radiating volume velocity. Geometric/acoustic scale is the fixed gain.
export function observeBody(state,r){
 const x=state.radiation,y=new Float64Array(x.length),acceleration=r.bodyRadiation?.type==='acceleration',gain=r.outputGain;
 for(let i=0;i<x.length;i++)y[i]=(acceleration?(x[i]-(i?x[i-1]:0))*state.sampleRate:x[i])*gain;
 return y;
}

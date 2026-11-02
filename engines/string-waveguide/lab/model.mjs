// SPDX-License-Identifier: GPL-3.0-only
import {resolveRecipe} from './data.mjs';import {solveString,observePickup} from './string.mjs';
import {observeBody} from './body.mjs';
export function createModel(instrumentData){return structuredClone(instrumentData);}
export function renderNote(model,recipe={}){
 const resolved=resolveRecipe(model,recipe),state=solveString(resolved);
 const dry=resolved.kind==='acoustic'?observeBody(state,resolved):observePickup(state,resolved),pcm=dry.slice();
 return {pcm,dry,sampleRate:state.sampleRate,resolved,diagnostics:state.diagnostics,state};
}

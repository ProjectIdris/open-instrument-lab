// SPDX-License-Identifier: GPL-3.0-only
export function fft(re,im,inverse=false){
 const n=re.length;if(n<2||(n&(n-1))||im.length!==n)throw Error('FFT length must be power of two');
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
 for(let len=2;len<=n;len*=2){const a=2*Math.PI/len*(inverse?1:-1),wr=Math.cos(a),wi=Math.sin(a),half=len/2;
  for(let i=0;i<n;i+=len){let cr=1,ci=0;for(let k=0;k<half;k++){const l=i+k,r=l+half,x=re[r]*cr-im[r]*ci,y=re[r]*ci+im[r]*cr;
   re[r]=re[l]-x;im[r]=im[l]-y;re[l]+=x;im[l]+=y;const z=cr*wr-ci*wi;ci=cr*wi+ci*wr;cr=z;}}
 }if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
}
export function spectrum(x,fs,n=8192){
 const re=new Float64Array(n),im=new Float64Array(n),count=Math.min(x.length,n);let sum=0;
 for(let i=0;i<count;i++){const w=.5-.5*Math.cos(2*Math.PI*i/Math.max(1,count-1));re[i]=x[i]*w;sum+=w;}
 fft(re,im);const mag=Float64Array.from({length:n/2+1},(_,i)=>2*Math.hypot(re[i],im[i])/Math.max(sum,1));return {mag,binHz:fs/n};
}
export function rng(seed=1){let s=seed>>>0;return ()=>{s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
export const rms=x=>Math.sqrt(x.reduce((s,v)=>s+v*v,0)/Math.max(1,x.length));
export function peak(x){let p=0;for(const v of x)p=Math.max(p,Math.abs(v));return p;}
export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function regression(xs,ys){const n=xs.length;if(n<3)return null;let sx=0,sy=0,sxx=0,sxy=0;
 for(let i=0;i<n;i++){sx+=xs[i];sy+=ys[i];sxx+=xs[i]**2;sxy+=xs[i]*ys[i];}const den=n*sxx-sx*sx;if(!den)return null;
 const slope=(n*sxy-sx*sy)/den,intercept=(sy-slope*sx)/n,mean=sy/n;let err=0,ss=0;
 for(let i=0;i<n;i++){err+=(ys[i]-intercept-slope*xs[i])**2;ss+=(ys[i]-mean)**2;}return {slope,intercept,r2:ss?1-err/ss:0,n};
}

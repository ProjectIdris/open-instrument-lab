// SPDX-License-Identifier: GPL-3.0-only
// The drum workbench engine and the membrane physics under it: a head's modes from its tension, size and mass,
// the air that loads it, and what a strike excites.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AIR_DENSITY, MEMBRANE_MODES, addedMassFactor, besselJ, besselZero, membraneModes, modalMassFactor,
} from '../engines/physics.mjs';

const mode =(m, n) => MEMBRANE_MODES.find((x) => x.m === m && x.n === n);

test('the Bessel function and its zeros are the known ones', () => {
  assert.ok(Math.abs(besselJ(0, 1) - 0.7651976866) < 1e-9);
  assert.ok(Math.abs(besselJ(1, 2.404825557695773) - 0.5191474973) < 1e-9);
  assert.ok(Math.abs(besselJ(2, 5) - 0.0465651163) < 1e-9);
  const zeros = { '0,1': 2.404826, '1,1': 3.831706, '2,1': 5.135622, '0,2': 5.520078, '3,1': 6.380162, '1,2': 7.015587 };
  for (const [key, want] of Object.entries(zeros)) {
    const [m, n] = key.split(',').map(Number);
    assert.ok(Math.abs(besselZero(m, n) - want) < 1e-5, `${key}: ${besselZero(m, n)}`);
  }
  assert.deepEqual(MEMBRANE_MODES.slice(0, 4).map((x) => `${x.m},${x.n}`), ['0,1', '1,1', '2,1', '0,2']);
});

test('with no air a head sounds at the ideal membrane frequencies: higher with tension, lower with size and mass', () => {
  const base = { tensionNPerM: 3000, arealKgM2: 0.264, radiusM: 0.178, airDensity: 0 };
  const hz = (extra = {}) => membraneModes({ ...base, ...extra }).find((x) => x.m === 0 && x.n === 1).hz;
  const ideal = (2.404826 / (2 * Math.PI * 0.178)) * Math.sqrt(3000 / 0.264);
  assert.ok(Math.abs(hz() / ideal - 1) < 1e-6, `${hz()} against ${ideal}`);
  assert.ok(Math.abs(hz({ tensionNPerM: 12000 }) / hz() - 2) < 1e-9, 'four times the tension is an octave up');
  assert.ok(Math.abs(hz({ radiusM: 0.356 }) / hz() - 0.5) < 1e-9, 'twice the diameter is an octave down');
  assert.ok(Math.abs(hz({ arealKgM2: 0.264 * 4 }) / hz() - 0.5) < 1e-9, 'four times the mass is an octave down');
  const ratios = membraneModes(base).slice(0, 4).map((x) => x.hz / ideal);
  assert.deepEqual(ratios.map((r) => Math.round(r * 100) / 100), [1, 1.59, 2.14, 2.3], 'the familiar 1 : 1.59 : 2.14 : 2.30');
});

test('the air mass is the Rayleigh one: 8/3 ρa³ for a piston, and the Hankel integral agrees with the double integral', () => {
  // the same formula for a piston (shape 1, whose transform is J1(κ)/κ) is Rayleigh's 8/3
  let piston = 0;
  for (let i = 0; i < 4000; i++) { const k = (i + 0.5) * 0.02; piston += (besselJ(1, k) / k) ** 2 * 0.02; }
  assert.ok(Math.abs(2 * Math.PI * piston - 8 / 3) < 5e-3, `piston: ${2 * Math.PI * piston}`);
  // direct double integral of the (0,1) shape over the head, with the 1/distance singularity taken out by polar coordinates round each point
  const alpha = besselZero(0, 1);
  const table = Float64Array.from({ length: 4001 }, (_, i) => besselJ(0, (alpha * i) / 4000));
  const phi = (r) => { if (r >= 1) return 0; const x = r * 4000; const i = Math.floor(x); return table[i] + (table[i + 1] - table[i]) * (x - i); };
  let total = 0;
  const nr = 160;
  const nt = 192;
  const np = 160;
  for (let i = 0; i < nr; i++) {
    const r = (i + 0.5) / nr;
    let inner = 0;
    for (let j = 0; j < nt; j++) {
      const t = (2 * Math.PI * (j + 0.5)) / nt;
      const cx = Math.cos(t);
      const sx = Math.sin(t);
      const rho = -r * cx + Math.sqrt(1 - r * r * sx * sx);
      for (let k = 0; k < np; k++) {
        const d = (rho * (k + 0.5)) / np;
        inner += phi(Math.hypot(r + d * cx, d * sx)) * (rho / np) * (2 * Math.PI / nt);
      }
    }
    total += phi(r) * inner * r / nr;
  }
  const hankel = addedMassFactor(mode(0, 1));
  assert.ok(Math.abs(total / hankel - 1) < 0.01, `double integral ${total}, Hankel ${hankel}`);
  // a head is light, so air matters: a lot for the lowest mode, less for the rest
  const modes = membraneModes({ tensionNPerM: 3000, arealKgM2: 0.264, radiusM: 0.178 });
  const f01 = modes.find((x) => x.m === 0 && x.n === 1);
  assert.ok(f01.hz / f01.vacuumHz > 0.6 && f01.hz / f01.vacuumHz < 0.8, `lowest mode ${f01.hz / f01.vacuumHz} of its vacuum pitch`);
  const f11 = modes.find((x) => x.m === 1 && x.n === 1);
  assert.ok(f11.hz / f11.vacuumHz > f01.hz / f01.vacuumHz, 'the next mode is held down less');
  for (const x of modes) assert.ok(x.hz < x.vacuumHz && x.loading > 0);
  assert.ok(modalMassFactor(mode(0, 1)) > 0.8 && modalMassFactor(mode(0, 1)) < 0.9);
  assert.equal(AIR_DENSITY, 1.2);
});

test('a heavier head is held down less by the air, and a closed shell lifts only the modes that move its volume', () => {
  const open = (extra) => membraneModes({ tensionNPerM: 3000, arealKgM2: 0.264, radiusM: 0.178, ...extra });
  const at = (list, m, n) => list.find((x) => x.m === m && x.n === n).hz;
  const light = open({});
  const heavy = open({ arealKgM2: 0.264 * 3, tensionNPerM: 3000 * 3 }); // same wave speed, three times the mass
  assert.ok(at(heavy, 0, 1) / at(light, 0, 1) > 1 - 1e-9, 'more mass, the same wave speed: the air matters less, so the pitch is no lower');
  const shallow = open({ closed: true, depthM: 0.1 });
  const deep = open({ closed: true, depthM: 0.4 });
  assert.ok(at(shallow, 0, 1) > at(deep, 0, 1) && at(deep, 0, 1) > at(light, 0, 1), 'a closed shell lifts the lowest mode, a shallow one more');
  assert.ok(at(shallow, 0, 2) > at(light, 0, 2));
  // modes with a nodal diameter move no volume, so only the one-sided air loading changes them
  const oneSide = at(deep, 1, 1) / at(light, 1, 1);
  assert.ok(oneSide > 1 && oneSide < 1.2, `(1,1) in a closed shell: ${oneSide}`);
  assert.ok(Math.abs(at(shallow, 1, 1) - at(deep, 1, 1)) < 1e-9, 'its depth does not matter to a mode that moves no volume');
});

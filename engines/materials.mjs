// SPDX-License-Identifier: GPL-3.0-only
// The starter materials library (materials.json) and helpers for engines.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('./materials.json', import.meta.url));
const library = JSON.parse(readFileSync(file, 'utf8'));

export const materials = library.materials;
export const about = library.about;

export function byId(id) {
  return materials.find((m) => m.id === id);
}

/** Options for a `choice` parameter: the library (optionally one family, or a list of them) plus 'custom'. */
export function materialOptions(family) {
  const families = family === undefined ? null : [].concat(family);
  const list = materials.filter((m) => !families || families.includes(m.family));
  return [...list.map((m) => ({ value: m.id, label: m.name })), { value: 'custom', label: 'Custom (type your own)' }];
}

/**
 * Density in kg/m³ and Young's modulus in Pa for a choice. `custom` takes the
 * typed values, given in kg/m³ and GPa as the UI shows them.
 */
export function resolveMaterial(id, customDensityKgM3, customModulusGPa) {
  if (id === 'custom') return { densityKgM3: customDensityKgM3, youngModulusPa: customModulusGPa * 1e9 };
  const m = byId(id);
  if (!m) throw new Error(`unknown material ${id}`);
  return { densityKgM3: m.densityKgM3, youngModulusPa: m.youngModulusPa };
}

/** Two number parameters for typing a material by hand; only shown for 'custom'. */
export function customMaterialParams({ group, idParam, prefix = '', layer = 'plain', density = 7850, modulusGPa = 200 }) {
  return [
    {
      id: prefix ? `${prefix}CustomDensity` : 'customDensity', type: 'number', layer, group, label: 'Density',
      help: 'Mass per volume of your own material. Water is 1000; most woods are 350 to 900; steel is about 7800.',
      unit: 'kg/m³', min: 50, max: 20000, scale: 'log', step: 10, default: density, visibleWhen: { [idParam]: ['custom'] },
    },
    {
      id: prefix ? `${prefix}CustomModulus` : 'customModulus', type: 'number', layer, group, label: 'Stiffness (Young’s modulus)',
      help: 'How strongly the material resists stretching and bending. Soft plastics are 1 to 3; woods 8 to 15 along the grain; aluminium 69; steel about 200.',
      unit: 'GPa', min: 0.1, max: 600, scale: 'log', step: 0.1, default: modulusGPa, visibleWhen: { [idParam]: ['custom'] },
    },
  ];
}

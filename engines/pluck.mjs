// SPDX-License-Identifier: GPL-3.0-only
// The width of whatever plucks the string, from the "soft finger to hard pick" setting.
//
// The string is pulled aside by something with a width: the flesh of a thumb
// (about 14 mm across where it meets the string), a nail (a few millimetres) or the
// edge of a pick (under a millimetre). The corner it makes in the string is
// rounded over about that width, and the rounding takes away the overtones
// whose half wavelength on the string is shorter than it. The width is a
// length, so it does not depend on the note: the same pick takes the same
// overtones away from a low string and a high one.
const SOFT_WIDTH_M = 0.014;
const HARD_WIDTH_M = 0.0005;

/** Width of the plucking thing in metres: 0 is a soft thumb, 1 a hard pick. */
export function pluckWidthM(hardness) {
  const h = Math.min(1, Math.max(0, hardness));
  return SOFT_WIDTH_M * (HARD_WIDTH_M / SOFT_WIDTH_M) ** h;
}

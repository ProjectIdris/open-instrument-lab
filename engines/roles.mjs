// SPDX-License-Identifier: GPL-3.0-only
// Roles: what the workbench does with a part or a parameter. An engine tags the
// parts and parameters in its schema with a `role`; the bench, the contract check
// and the page all find them by role, so an engine's own ids can be anything.
// Shared by the server and the page (the page gets it as /shared/roles.mjs).

/**
 * Where each role lives in a schema.
 * `partId[role]`   the id of the part with that role;
 * `shared[role]`   the id of the shared parameter with that role (`sharedRole[id]` the other way);
 * `part[partRole][role]` and `partRole[partRole][id]` the same for the parameters of one part.
 */
export function roleMaps(schema) {
  const partId = {};
  const partRoleOfId = {};
  for (const part of schema.parts ?? []) if (part.role) { partId[part.role] = part.id; partRoleOfId[part.id] = part.role; }
  const shared = {};
  const sharedRole = {};
  const part = {};
  const partRole = {};
  for (const p of schema.params) {
    if (!p.role) continue;
    if (p.part === undefined) { shared[p.role] = p.id; sharedRole[p.id] = p.role; continue; }
    const owner = partRoleOfId[p.part];
    if (!owner) continue;
    (part[owner] ??= {})[p.role] = p.id;
    (partRole[owner] ??= {})[p.id] = p.role;
  }
  return { partId, partRoleOfId, shared, sharedRole, part, partRole };
}

const rename = (values, table) => Object.fromEntries(Object.entries(values).map(([key, value]) => [table[key] ?? key, value]));
const invert = (table) => Object.fromEntries(Object.entries(table).map(([key, value]) => [value, key]));

/** Shared values keyed by id, as an engine has them, to the same values keyed by role where there is one. */
export const sharedToRoles = (maps, values) => rename(values, maps.sharedRole);
export const sharedToIds = (maps, values) => rename(values, invert(maps.sharedRole));
/** The values of one part (strings, frets…) in the same two forms. */
export const partToRoles = (maps, partRole, values) => rename(values, maps.partRole[partRole] ?? {});
export const partToIds = (maps, partRole, values) => rename(values, invert(maps.partRole[partRole] ?? {}));

/**
 * The controls for these parameters, as a form schema keyed by role (what the bench keeps) in place of id, with any
 * "only when" condition naming the role too. A parameter with no role keeps its id.
 */
export function formSchema(schema, maps, params) {
  const table = { ...maps.sharedRole };
  for (const ids of Object.values(maps.partRole)) Object.assign(table, ids);
  const name = (id) => table[id] ?? id;
  return {
    groups: schema.groups,
    params: params.map((p) => ({
      ...p,
      id: name(p.id),
      layer: 'plain',
      ...(p.visibleWhen ? { visibleWhen: Object.fromEntries(Object.entries(p.visibleWhen).map(([id, allowed]) => [name(id), allowed])) } : {}),
    })),
  };
}

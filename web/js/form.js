// SPDX-License-Identifier: GPL-3.0-only
// Builds the controls from an engine's schema. Nothing here knows about any
// particular instrument: a new parameter in a schema simply appears.
import { isVisible } from '/shared/schema.mjs';

const SLIDER_STEPS = 1000;

function toSlider(param, value) {
  if (param.scale === 'log') return (Math.log(value / param.min) / Math.log(param.max / param.min)) * SLIDER_STEPS;
  return ((value - param.min) / (param.max - param.min)) * SLIDER_STEPS;
}

function fromSlider(param, position) {
  const t = position / SLIDER_STEPS;
  let value = param.scale === 'log' ? param.min * (param.max / param.min) ** t : param.min + t * (param.max - param.min);
  if (param.integer) value = Math.round(value);
  else if (param.step) value = Math.round(value / param.step) * param.step;
  return Math.min(param.max, Math.max(param.min, Number(value.toPrecision(6))));
}

function decimals(param) {
  if (param.integer) return 0;
  const step = param.step ?? (param.max - param.min) / 100;
  return Math.min(4, Math.max(0, Math.ceil(-Math.log10(step))));
}

export function formatValue(param, value) {
  return `${value.toFixed(decimals(param))}${param.unit ? ` ${param.unit}` : ''}`;
}

function element(tag, attributes = {}, text) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (key === 'class') node.className = value;
    else node.setAttribute(key, value);
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Fill the two containers with controls for `schema`.
 * Returns { update(values) }, which redraws values and hides parameters that do not apply.
 */
export function buildForm({ schema, plainEl, advancedEl, values, onInput, onCommit }) {
  plainEl.replaceChildren();
  advancedEl.replaceChildren();
  const current = { ...values };
  const rows = new Map();
  const groupTitles = [];

  for (const layer of ['plain', 'advanced']) {
    const container = layer === 'plain' ? plainEl : advancedEl;
    for (const group of schema.groups) {
      const params = schema.params.filter((p) => p.layer === layer && p.group === group.id);
      if (!params.length) continue;
      const title = element('h3', { class: 'group-title' }, group.label);
      container.append(title);
      const groupRows = [];
      for (const param of params) {
        const row = buildControl(param, current, onInput, onCommit);
        container.append(row.node);
        rows.set(param.id, row);
        groupRows.push(row);
      }
      groupTitles.push({ title, groupRows, param: params });
    }
  }

  function update(next) {
    Object.assign(current, next);
    for (const [id, row] of rows) {
      row.set(current[id]);
      row.node.hidden = !isVisible(row.param, current);
    }
    for (const { title, groupRows } of groupTitles) title.hidden = groupRows.every((r) => r.node.hidden);
  }
  update({});
  return { update };
}

function buildControl(param, current, onInput, onCommit) {
  const id = `ctl-${param.id}`;
  const node = element('div', { class: 'control' });
  const head = element('div', { class: 'control-head' });
  const label = element('label', { for: id }, param.label);
  const valueText = element('span', { class: 'value' });
  head.append(label, valueText);
  const help = element('p', { class: 'help' }, param.help);
  let set;

  if (param.type === 'number') {
    const slider = element('input', { id, type: 'range', min: '0', max: String(SLIDER_STEPS), step: '1' });
    const entry = element('input', { type: 'number', class: 'number-entry', min: String(param.min), max: String(param.max), step: String(param.step ?? 'any'), 'aria-label': `${param.label}, type a value` });
    valueText.append(entry);
    if (param.unit) valueText.append(document.createTextNode(` ${param.unit}`));
    set = (value) => {
      slider.value = String(toSlider(param, value));
      if (document.activeElement !== entry) entry.value = value.toFixed(decimals(param));
    };
    slider.addEventListener('input', () => {
      const value = fromSlider(param, Number(slider.value));
      current[param.id] = value;
      entry.value = value.toFixed(decimals(param));
      onInput(param.id, value);
    });
    slider.addEventListener('change', () => onCommit(param.id, current[param.id]));
    entry.addEventListener('change', () => {
      let value = Number(entry.value);
      if (!Number.isFinite(value)) value = current[param.id];
      value = Math.min(param.max, Math.max(param.min, param.integer ? Math.round(value) : value));
      current[param.id] = value;
      set(value);
      onInput(param.id, value);
      onCommit(param.id, value);
    });
    node.append(head, slider, help);
  } else if (param.type === 'choice') {
    const select = element('select', { id });
    for (const option of param.options) select.append(element('option', { value: option.value }, option.label));
    set = (value) => { select.value = value; valueText.textContent = ''; };
    select.addEventListener('change', () => { current[param.id] = select.value; onInput(param.id, select.value); onCommit(param.id, select.value); });
    node.append(head, select, help);
  } else {
    const box = element('input', { id, type: 'checkbox' });
    set = (value) => { box.checked = value; valueText.textContent = value ? 'on' : 'off'; };
    box.addEventListener('change', () => { current[param.id] = box.checked; valueText.textContent = box.checked ? 'on' : 'off'; onInput(param.id, box.checked); onCommit(param.id, box.checked); });
    node.append(head, box, help);
  }
  return { node, param, set };
}

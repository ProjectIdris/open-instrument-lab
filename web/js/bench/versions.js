// SPDX-License-Identifier: GPL-3.0-only
// The versions of an instrument kept on the shelf while you work, so you can flip between two of them (A/B).
// A version is the instrument document and its undo history. Nothing here touches the page.
// The one on the bench is `active`; its latest state is handed in whenever the bench changes hands.

export const MAX_VERSIONS = 8;

let nextId = 1;
const copyOf = (doc) => structuredClone(doc);

export class Versions {
  constructor() {
    this.list = [];
    this.activeId = null;
    this.previousId = null;
    this.numbered = 0;
  }

  get count() { return this.list.length; }

  get active() { return this.list.find((v) => v.id === this.activeId) ?? null; }

  #add(doc, history) {
    const version = { id: nextId++, number: ++this.numbered, doc: copyOf(doc), history: history.slice() };
    this.list.push(version);
    return version;
  }

  /** Remember the bench's latest state in the version that is on it. */
  #store({ doc, history }) {
    const active = this.active;
    if (!active) return;
    active.doc = copyOf(doc);
    active.history = history.slice();
  }

  /** True when the shelf has room for `n` more versions. Nothing is ever taken off the shelf to make room: the one who made them chooses. */
  hasRoom(n = 1) { return this.list.length + n <= MAX_VERSIONS; }

  /**
   * The instrument on the bench is kept as it is, and a copy of it goes on the bench. Returns the copy, or null (and
   * changes nothing) if the shelf is full: a version here may be the only copy of someone's work.
   */
  duplicate(capture) {
    if (!this.hasRoom(this.active ? 1 : 2)) return null;
    if (!this.active) this.activeId = this.#add(capture.doc, capture.history).id;
    else this.#store(capture);
    const copy = this.#add({ ...capture.doc, name: `${capture.doc.name} copy`.slice(0, 80) }, capture.history);
    this.previousId = this.activeId;
    this.activeId = copy.id;
    return copy;
  }

  /**
   * Another instrument is about to replace the one on the bench (opened from the gallery or a file). If a version is on
   * the bench its latest state is kept first, and the new instrument goes on the shelf as a version of its own, so A/B
   * brings the edited one back. Returns the new version, or null (and changes nothing) if the shelf is full.
   */
  adopt(capture, doc) {
    if (!this.active) return null;
    if (!this.hasRoom(1)) return null;
    this.#store(capture);
    const version = this.#add(doc, []);
    this.previousId = this.activeId;
    this.activeId = version.id;
    return version;
  }

  /** Put another version on the bench. Returns it, or null if it is not here or is already on the bench. */
  switchTo(id, capture) {
    const target = this.list.find((v) => v.id === id);
    if (!target || id === this.activeId) return null;
    this.#store(capture);
    this.previousId = this.activeId;
    this.activeId = id;
    return target;
  }

  /** A/B: back to the version used just before this one. */
  compare(capture) {
    if (this.list.length < 2) return null;
    const other = this.list.find((v) => v.id === this.previousId) ?? this.list.find((v) => v.id !== this.activeId);
    return this.switchTo(other.id, capture);
  }

  /** Take a version off the shelf. The one on the bench stays. */
  remove(id) {
    if (id === this.activeId) return false;
    const at = this.list.findIndex((v) => v.id === id);
    if (at < 0) return false;
    this.list.splice(at, 1);
    if (this.previousId === id) this.previousId = null;
    return true;
  }
}

// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createUndoStack,
  isArrowKeyTarget,
  isEditableTarget,
  isUndoShortcut,
  opensKeyboard,
} from "./undo";

describe("Rückgängig-Liste", () => {
  it("nimmt die jüngste Aktion zuerst zurück, jede nur einmal", () => {
    const stack = createUndoStack();
    const first = vi.fn();
    const second = vi.fn();
    stack.push("eins", first);
    const entry = stack.push("zwei", second);
    expect(stack.pop()?.message).toBe("zwei");
    // Toast-Knopf nach ⌘Z: schon benutzt
    expect(stack.take(entry.id)).toBeUndefined();
    expect(stack.pop()?.message).toBe("eins");
    expect(stack.pop()).toBeUndefined();
  });

  it("Toast-Knopf nimmt genau seinen Eintrag heraus", () => {
    const stack = createUndoStack();
    const a = stack.push("a", () => {});
    stack.push("b", () => {});
    expect(stack.take(a.id)?.message).toBe("a");
    expect(stack.size()).toBe(1);
    expect(stack.pop()?.message).toBe("b");
  });

  it("hält höchstens die letzten N Aktionen", () => {
    const stack = createUndoStack(3);
    for (const name of ["1", "2", "3", "4"]) stack.push(name, () => {});
    expect(stack.size()).toBe(3);
    expect([stack.pop(), stack.pop(), stack.pop()].map((e) => e?.message)).toEqual(["4", "3", "2"]);
  });
});

describe("⌘Z außerhalb von Textfeldern", () => {
  it("erkennt Textfelder und Editoren (die behalten ihr eigenes ⌘Z)", () => {
    document.body.innerHTML = `
      <input id="text" />
      <input id="check" type="checkbox" />
      <textarea id="area"></textarea>
      <div contenteditable="true"><p id="inside">Text</p></div>
      <div contenteditable><p id="bare">Text</p></div>
      <div contenteditable="false"><p id="off">Text</p></div>
      <button id="button">Knopf</button>`;
    const byId = (id: string) => document.getElementById(id);
    expect(isEditableTarget(byId("text"))).toBe(true);
    expect(isEditableTarget(byId("area"))).toBe(true);
    expect(isEditableTarget(byId("inside"))).toBe(true);
    expect(isEditableTarget(byId("bare"))).toBe(true);
    expect(isEditableTarget(byId("off"))).toBe(false);
    expect(isEditableTarget(byId("check"))).toBe(false);
    expect(isEditableTarget(byId("button"))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("Tastatur am Handy nur bei Text – nicht bei Uhrzeit, Datum, Auswahl, Häkchen (Leiste unten)", () => {
    document.body.innerHTML = `
      <input id="text" />
      <input id="search" type="search" />
      <input id="number" type="number" />
      <input id="time" type="time" />
      <input id="date" type="date" />
      <input id="check" type="checkbox" />
      <select id="select"><option>a</option></select>
      <textarea id="area"></textarea>
      <div contenteditable="true"><p id="inside">Text</p></div>`;
    const byId = (id: string) => document.getElementById(id);
    for (const id of ["text", "search", "number", "area", "inside"]) {
      expect(opensKeyboard(byId(id))).toBe(true);
    }
    for (const id of ["time", "date", "check", "select"]) {
      expect(opensKeyboard(byId(id))).toBe(false);
    }
    expect(opensKeyboard(document.body)).toBe(false);
    expect(opensKeyboard(null)).toBe(false);
  });

  it("⌘Z und Strg+Z, nicht ⌘⇧Z", () => {
    const key = { key: "z", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };
    expect(isUndoShortcut({ ...key, metaKey: true })).toBe(true);
    expect(isUndoShortcut({ ...key, ctrlKey: true, key: "Z" })).toBe(true);
    expect(isUndoShortcut({ ...key, metaKey: true, shiftKey: true })).toBe(false);
    expect(isUndoShortcut(key)).toBe(false);
  });
});

describe("Pfeiltasten-Ziel (Review Teil B, U-2)", () => {
  it("Scroll-Bereiche, Umschalter und Knöpfe behalten ←/→, Fließtext nicht", () => {
    document.body.innerHTML = `
      <section data-tab-scroll="zeitachse" tabindex="0"><div id="in-axis"></div></section>
      <div role="radiogroup"><button role="radio" id="radio">Woche</button></div>
      <p id="text">Text</p>`;
    const byId = (id: string) => document.getElementById(id);
    expect(isArrowKeyTarget(byId("in-axis"))).toBe(true);
    expect(isArrowKeyTarget(byId("radio"))).toBe(true);
    expect(isArrowKeyTarget(byId("text"))).toBe(false);
    expect(isArrowKeyTarget(null)).toBe(false);
  });
});

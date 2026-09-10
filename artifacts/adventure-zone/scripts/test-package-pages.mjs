import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const source = readFileSync(new URL('../public/adventure-zone-site.js', import.meta.url), 'utf8');
function mount(path = '/', tag = 'adventure-zone-site') {
  const dom = new JSDOM('<body></body>', { url: `https://www.the-adventure-zone.com${path}`, runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true });
  w.HTMLElement.prototype.scrollIntoView = function () {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event('close')); };
  w.eval(source);
  const element = w.document.createElement(tag);
  w.document.body.append(element);
  return { dom, w, element, root: element.shadowRoot };
}

test('package link opens matching details and booking selects that package', () => {
  const { dom, w, root } = mount();
  try {
    const link = root.querySelector('[data-package-open="pirates-rebellion"]');
    assert.ok(link, 'package has a real link');
    assert.equal(link.getAttribute('href'), '/pirates-rebellion-package');
    link.click();
    const dialog = root.querySelector('.package-dialog');
    assert.equal(dialog.open, true);
    assert.match(dialog.textContent, /Pirate's Rebellion/);
    assert.equal(w.document.body.style.overflow, 'hidden');
    dialog.querySelector('[data-package-book]').click();
    assert.equal(dialog.open, false);
    assert.equal(root.querySelector('[name="packageInterest"]').value, "Pirate's Rebellion");
    assert.equal(w.document.body.style.overflow, '');
  } finally { dom.window.close(); }
});

test('closing restores prior scroll state and returns focus to the opener', () => {
  const { dom, w, root } = mount();
  try {
    w.document.body.style.overflow = 'auto';
    const link = root.querySelector('[data-package-open="adventure-zone"]');
    assert.ok(link);
    link.focus(); link.click();
    root.querySelector('[data-package-close]').click();
    assert.equal(root.activeElement, link);
    assert.equal(w.document.body.style.overflow, 'auto');
  } finally { dom.window.close(); }
});

test('direct package page renders its own heading and preselects inquiry', () => {
  const { dom, root } = mount('/warriors-playground-package', 'adventure-zone-package');
  try {
    assert.ok(root, 'standalone package element is registered');
    assert.equal(root.querySelector('h1').textContent, "Warrior's Playground");
    assert.equal(root.querySelector('[name="packageInterest"]').value, "Warrior's Playground");
    assert.equal(root.querySelector('.hero'), null);
    assert.match(root.textContent, /Ammo sold separately/);
  } finally { dom.window.close(); }
});

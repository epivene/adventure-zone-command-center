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

test('foam party promo is featured inside Epic Packages before the package cards', () => {
  const { dom, root } = mount();
  try {
    const packages = root.querySelector('#packages');
    const foamParty = packages.querySelector('#foam-party');
    const packageGrid = packages.querySelector('.package-grid');
    assert.ok(foamParty, 'foam party promo is rendered inside Epic Packages');
    assert.ok(foamParty.compareDocumentPosition(packageGrid) & 4, 'foam party promo precedes the package cards');
    assert.equal(root.querySelector('.how #foam-party'), null);
  } finally { dom.window.close(); }
});

test('foam party promo uses the approved artwork and links to contact', () => {
  const { dom, root } = mount();
  try {
    const foamParty = root.querySelector('#foam-party');
    const link = foamParty.querySelector('a');
    const image = foamParty.querySelector('img');
    assert.equal(link.getAttribute('href'), '#contact');
    assert.equal(image.src, 'https://static.wixstatic.com/media/0e6e2c_c43dd0a344e2430d8881ed0cb8f84da9~mv2.png');
    assert.match(image.alt, /Foam Party add-on.*Only \$3,500/i);
    assert.doesNotMatch(foamParty.textContent, /Pricing increases|Only one Foam Party booking/i);
  } finally { dom.window.close(); }
});

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

test('all package videos appear before About and each package page shows its matching video', () => {
  const home = mount();
  try {
    assert.equal(home.root.querySelectorAll('#videos iframe').length, 3);
    assert.ok(home.root.querySelector('#videos').compareDocumentPosition(home.root.querySelector('#about')) & 4);
    assert.doesNotMatch(home.root.textContent, /fully immersive/i);
  } finally { home.dom.window.close(); }
  for (const [path, id] of [['adventure-zone-package', 'MWD0SdAWZpc'], ['pirates-rebellion-package', 'tgjwa1LvghI'], ['warriors-playground-package', '-xTjCJz9RmI']]) {
    const page = mount('/' + path, 'adventure-zone-package');
    try {
      const player = page.root.querySelector('.package-detail iframe');
      assert.equal(new URL(player.src).pathname, '/embed/' + id);
      assert.ok(player.compareDocumentPosition(page.root.querySelector('#package-detail-title')) & 4);
    } finally { page.dom.window.close(); }
  }
});

test('closing package video removes the player so playback stops', () => {
  const { dom, root } = mount();
  try {
    const link = root.querySelector('[data-package-open="weekend-warriors"]');
    link.click();
    assert.match(root.querySelector('.package-dialog iframe').src, /-xTjCJz9RmI/);
    root.querySelector('[data-package-close]').click();
    assert.equal(root.querySelector('.package-dialog iframe'), null);
    link.click();
    assert.ok(root.querySelector('.package-dialog iframe'));
  } finally { dom.window.close(); }
});

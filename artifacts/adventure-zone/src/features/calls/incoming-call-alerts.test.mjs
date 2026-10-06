import { test } from 'vitest';
import assert from 'node:assert/strict';
import { createIncomingCallAlerts } from './incoming-call-alerts.ts';

function fixture(permission = 'granted', soundFails = false) {
  const events = [];
  const notices = [];
  let click;
  const alerts = createIncomingCallAlerts({
    prepareSound: async () => { if (soundFails) throw new Error('blocked'); },
    permission: () => permission,
    requestPermission: async () => permission,
    ring: () => { events.push('ring'); return () => events.push('silenced'); },
    notify: (id, onClick) => { notices.push(id); click = onClick; return () => events.push('closed'); },
    reveal: () => events.push('revealed'),
  });
  return { alerts, events, notices, click: () => click() };
}
test('an incoming call rings and opens a desktop alert; repeat renders do not duplicate it', async () => {
  const f = fixture(); await f.alerts.prepare();
  f.alerts.start('call-a'); f.alerts.start('call-a');
  assert.deepEqual(f.events, ['ring']);
  assert.deepEqual(f.notices, ['call-a']);
  f.click(); assert.deepEqual(f.events, ['ring', 'revealed']);
});
test('answer or caller cancellation silences and closes alerts exactly once', async () => {
  const f = fixture(); await f.alerts.prepare(); f.alerts.start('call-a');
  f.alerts.stop(); f.alerts.stop();
  assert.deepEqual(f.events, ['ring', 'silenced', 'closed']);
});
test('a new call replaces the previous alert', async () => {
  const f = fixture(); await f.alerts.prepare(); f.alerts.start('a'); f.alerts.start('b');
  assert.deepEqual(f.events, ['ring', 'silenced', 'closed', 'ring']);
  assert.deepEqual(f.notices, ['a', 'b']);
});
test('blocked notifications still allow the ringtone and report the limitation', async () => {
  const f = fixture('denied'); const warnings = await f.alerts.prepare();
  f.alerts.start('a');
  assert.equal(warnings.some(w => w.includes('notification')), true);
  assert.deepEqual(f.events, ['ring']); assert.deepEqual(f.notices, []);
});
test('blocked audio still shows a notification and reports missing ringtone', async () => {
  const f = fixture('granted', true); const warnings = await f.alerts.prepare();
  f.alerts.start('a');
  assert.equal(warnings.some(w => w.includes('sound')), true);
  assert.deepEqual(f.events, []); assert.deepEqual(f.notices, ['a']);
});
test('notification failure does not stop the audible alert', async () => {
  const f = fixture(); await f.alerts.prepare();
  const alerts = createIncomingCallAlerts({
    prepareSound: async () => {}, permission: () => 'granted',
    requestPermission: async () => 'granted',
    ring: () => () => {}, notify: () => { throw new Error('OS blocked'); },
    reveal: () => {},
  });
  await alerts.prepare();
  assert.equal(alerts.start('a').some(w => w.includes('notification')), true);
});

test('sound becomes ready while the desktop permission prompt is still pending', async () => {
  const events = [];
  let grant;
  const permission = new Promise(resolve => { grant = resolve; });
  const alerts = createIncomingCallAlerts({
    prepareSound: async () => {}, permission: () => 'default',
    requestPermission: () => permission,
    ring: () => { events.push('ring'); return () => {}; },
    notify: () => () => {}, reveal: () => {},
  });
  const preparing = alerts.prepare();
  await Promise.resolve(); await Promise.resolve();
  alerts.start('a');
  assert.deepEqual(events, ['ring']);
  grant('granted'); await preparing;
});

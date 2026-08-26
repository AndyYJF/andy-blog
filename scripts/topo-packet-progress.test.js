import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOPO_MAX_DT_SEC,
  TOPO_PACKET_SPEED,
  advanceOffsetDist,
  clampFrameDt,
  packetPhase,
  packetPointDistance,
} from '../astro/src/lib/topo-packet-progress.ts';

function travel(framesMs, initialOffset = 0) {
  let last;
  let offset = initialOffset;
  for (const now of framesMs) {
    const dt = last === undefined ? 0 : clampFrameDt(now, last);
    last = now;
    offset = advanceOffsetDist(offset, dt);
  }
  return offset;
}

test('clamps a multi-minute background gap to 50ms', () => {
  assert.equal(clampFrameDt(300_000, 0), TOPO_MAX_DT_SEC);
  assert.equal(clampFrameDt(16.7, 0), 0.0167);
  assert.equal(clampFrameDt(10, 20), 0);
  assert.equal(clampFrameDt(Number.NaN, 0), 0);
});

test('a 5-minute now jump advances one clamped step, not wall-clock zip', () => {
  const afterSit = travel([0, 300_000]);
  assert.equal(afterSit, TOPO_PACKET_SPEED * TOPO_MAX_DT_SEC);
  const oldZip = (300_000 / 1000) * TOPO_PACKET_SPEED;
  assert.ok(afterSit < oldZip / 100);
});

test('speed after a simulated 5-minute pause stays within 20% of the first second', () => {
  const fps = 60;
  const step = 1000 / fps;
  const firstSecond = Array.from({ length: fps + 1 }, (_, i) => i * step);
  const dist0 = travel(firstSecond);
  const rate0 = dist0 / 1;

  const paused = [...firstSecond, firstSecond.at(-1) + 300_000];
  const afterPause = Array.from({ length: fps + 1 }, (_, i) => paused.at(-1) + i * step);
  const distPause = travel([...paused, ...afterPause.slice(1)]);
  const distAfter = distPause - travel(paused);
  const rate1 = distAfter / 1;

  assert.ok(Math.abs(rate1 - rate0) / rate0 < 0.2, `rate0=${rate0} rate1=${rate1}`);
  assert.ok(Math.abs(rate0 - TOPO_PACKET_SPEED) / TOPO_PACKET_SPEED < 0.05);
});

test('shrinking getTotalLength does not divide accumulated wall time', () => {
  const offset = advanceOffsetDist(0, 5);
  const shortLen = 8;
  const phase = packetPhase(offset, shortLen, 180);
  assert.ok(phase !== null);
  const oldU = ((5 * TOPO_PACKET_SPEED) / shortLen) % 1;
  assert.notEqual(phase, oldU);
  assert.ok(oldU > 0.5 || (5 * TOPO_PACKET_SPEED) / shortLen > 1);
});

test('unusable path length skips the packet', () => {
  assert.equal(packetPhase(10, 0), null);
  assert.equal(packetPhase(10, Number.NaN), null);
  assert.equal(packetPhase(10, 120, 0), null);
});

test('reverse packets sample from the far end of the current path', () => {
  assert.equal(packetPointDistance(0.25, 200, false), 50);
  assert.equal(packetPointDistance(0.25, 200, true), 150);
});

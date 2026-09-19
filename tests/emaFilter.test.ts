import test from 'node:test';
import assert from 'node:assert/strict';
import { EmaFilter3D } from '../src/services/vision/emaFilter.ts';
import { type Point3D } from '../src/services/piano/keyEngine.ts';

test('EmaFilter3D - initializes first point without distortion', () => {
  const filter = new EmaFilter3D(0.5);
  const raw: Point3D = { x: 0.5, y: 0.6, z: -0.03 };

  const smoothed = filter.filter('finger-1', raw);
  assert.equal(smoothed.x, 0.5);
  assert.equal(smoothed.y, 0.6);
  assert.equal(smoothed.z, -0.03);
});

test('EmaFilter3D - dampens sudden single-frame spikes', () => {
  const filter = new EmaFilter3D(0.5);
  filter.filter('finger-1', { x: 0.5, y: 0.5, z: 0.0 });

  // Sudden spike on x from 0.5 to 0.9
  const smoothed = filter.filter('finger-1', { x: 0.9, y: 0.5, z: 0.0 });

  // With alpha=0.5: 0.5 * 0.9 + 0.5 * 0.5 = 0.70 (spikes dampened by half)
  assert.ok(Math.abs(smoothed.x - 0.70) < 0.0001, `Expected ~0.70, got ${smoothed.x}`);
});

test('EmaFilter3D - converges to steady state over consecutive identical frames', () => {
  const filter = new EmaFilter3D(0.5);
  filter.filter('finger-1', { x: 0.0, y: 0.0, z: 0.0 });

  let point: Point3D = { x: 1.0, y: 1.0, z: 1.0 };
  for (let i = 0; i < 10; i++) {
    point = filter.filter('finger-1', { x: 1.0, y: 1.0, z: 1.0 });
  }

  // After 10 iterations at alpha=0.5, error is 0.5^10 ~ 0.00097
  assert.ok(Math.abs(point.x - 1.0) < 0.002);
});

test('EmaFilter3D - tracks multiple fingers independently', () => {
  const filter = new EmaFilter3D(0.5);
  const f1 = filter.filter('left_index', { x: 0.2, y: 0.2, z: 0.0 });
  const f2 = filter.filter('right_index', { x: 0.8, y: 0.8, z: 0.0 });

  assert.equal(f1.x, 0.2);
  assert.equal(f2.x, 0.8);

  const nextF1 = filter.filter('left_index', { x: 0.4, y: 0.2, z: 0.0 });
  assert.ok(Math.abs(nextF1.x - 0.3) < 0.0001);
  assert.equal(filter.get('right_index')?.x, 0.8);
});

test('EmaFilter3D - prunes inactive fingers to prevent memory leaks', () => {
  const filter = new EmaFilter3D(0.5);
  filter.filter('finger-1', { x: 0.5, y: 0.5, z: 0.0 });
  filter.filter('finger-2', { x: 0.6, y: 0.6, z: 0.0 });

  filter.prune(new Set(['finger-1']));
  assert.notEqual(filter.get('finger-1'), null);
  assert.equal(filter.get('finger-2'), null);
});

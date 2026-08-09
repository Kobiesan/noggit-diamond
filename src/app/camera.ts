/**
 * Fly camera: right-mouse-drag to look, WASD to move, Q/E down/up,
 * Shift for speed boost, mouse wheel to change base speed.
 */

import * as THREE from 'three';

export class FlyCamera {
  readonly camera: THREE.PerspectiveCamera;
  private yaw = -Math.PI / 4;
  private pitch = -0.5;
  private keys = new Set<string>();
  private looking = false;
  speed = 60; // yards/sec

  constructor(private canvas: HTMLCanvasElement) {
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 6000);
    this.camera.position.set(-40, 80, -40);
    this.camera.rotation.order = 'YXZ';

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 2) {
        this.looking = true;
        canvas.setPointerCapture(e.pointerId);
      }
    });
    canvas.addEventListener('pointerup', (e) => {
      if (e.button === 2) this.looking = false;
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.looking) return;
      this.yaw -= e.movementX * 0.0032;
      this.pitch -= e.movementY * 0.0032;
      this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.speed *= e.deltaY < 0 ? 1.2 : 1 / 1.2;
        this.speed = Math.max(5, Math.min(1200, this.speed));
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if (isTypingTarget(e.target)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  get isLooking(): boolean {
    return this.looking;
  }

  /** Position the camera to overlook a map point. */
  focusOn(mx: number, my: number, mz: number, distance = 120): void {
    this.camera.position.set(mx - distance * 0.6, my + distance * 0.8, mz - distance * 0.6);
    this.yaw = -Math.PI / 4 - Math.PI / 2;
    this.pitch = -0.6;
  }

  update(dt: number): void {
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    const boost = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 4 : 1;
    const v = this.speed * boost * dt;
    const forward = new THREE.Vector3(0, 0, -1).applyEuler(this.camera.rotation);
    const right = new THREE.Vector3(1, 0, 0).applyEuler(this.camera.rotation);
    if (this.keys.has('KeyW')) this.camera.position.addScaledVector(forward, v);
    if (this.keys.has('KeyS')) this.camera.position.addScaledVector(forward, -v);
    if (this.keys.has('KeyD')) this.camera.position.addScaledVector(right, v);
    if (this.keys.has('KeyA')) this.camera.position.addScaledVector(right, -v);
    if (this.keys.has('KeyE')) this.camera.position.y += v;
    if (this.keys.has('KeyQ')) this.camera.position.y -= v;
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }
}

/** True when a form element has focus (keys should not move the camera). */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
}

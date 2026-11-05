// Skinned, animated humans with procedural combat poses layered on top.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { makeCharacter, animateCharacter } from './actors.js';

const T = { gltf: null };
export async function loadHumans(url) {
  try {
    T.gltf = await new GLTFLoader().loadAsync(url);
    T.gltf.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    return true;
  } catch (e) {
    console.warn('Character model failed to load, using simple figures', e);
    return false;
  }
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
// Rotate `bone` so the direction from it to `child` points along `dir` (world space), blended by w.
function pointBone(bone, child, dir, w) {
  if (w <= 0.001) return;
  bone.getWorldPosition(_a); child.getWorldPosition(_b);
  const cur = _b.sub(_a).normalize();
  _q.setFromUnitVectors(cur, dir);
  bone.getWorldQuaternion(_q2);
  _q.multiply(_q2);
  bone.parent.getWorldQuaternion(_q3).invert();
  _q3.multiply(_q);
  bone.quaternion.slerp(_q3, w);
  bone.updateMatrixWorld(true);
}
const ease = (x) => x * x * (3 - 2 * x);

export class Human {
  // look: { tint: hex, simple: {skin,top,pants,hair} }
  constructor(scene, look = {}) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.hp = look.hp ?? 60; this.maxHp = this.hp;
    this.dead = false; this.deadT = 0;
    this.speed = 0; this.punchT = 0; this.swingT = 0; this.hitT = 0; this.aim = null;
    this.radius = 0.42;
    if (T.gltf) {
      const root = SkeletonUtils.clone(T.gltf.scene);
      root.rotation.y = Math.PI; // the model faces -Z; our forward is +Z
      const tint = new THREE.Color(look.tint ?? 0xffffff);
      root.traverse((o) => {
        if (o.isMesh) {
          o.material = o.material.clone();
          if (o.material.name === 'VanguardBodyMat') o.material.color.copy(tint);
          o.castShadow = true;
        }
      });
      this.group.add(root);
      this.root = root;
      this.mixer = new THREE.AnimationMixer(root);
      const clip = (n) => T.gltf.animations.find((a) => a.name === n);
      this.acts = {};
      for (const n of ['Idle', 'Walk', 'Run']) { const a = this.mixer.clipAction(clip(n)); a.play(); a.setEffectiveWeight(n === 'Idle' ? 1 : 0); this.acts[n] = a; }
      this.mixer.update(Math.random() * 2);
      const b = (n) => root.getObjectByName('mixamorig' + n);
      this.bones = {
        spine: b('Spine1'), spine2: b('Spine2'), head: b('Head'),
        rArm: b('RightArm'), rFore: b('RightForeArm'), rHand: b('RightHand'), rMid: b('RightHandMiddle1'),
        lArm: b('LeftArm'), lFore: b('LeftForeArm'), lHand: b('LeftHand'), lMid: b('LeftHandMiddle1'),
      };
    } else {
      this.simple = makeCharacter(look.simple || { skin: 0xc68642, top: look.tint ?? 0x3b6ea5, pants: 0x22223b, hair: 0x1b1b1b });
      this.group.add(this.simple);
      this.phase = 0;
    }
  }
  get pos() { return this.group.position; }
  get heading() { return this.group.rotation.y; }
  set heading(h) { this.group.rotation.y = h; }

  punch() { if (this.punchT <= 0) { this.punchT = 0.38; return true; } return false; }
  swing() { if (this.swingT <= 0) { this.swingT = 0.55; return true; } return false; }
  hurt() { this.hitT = 0.25; }

  // world position of the right hand (for muzzles and weapons)
  handPos(out) {
    if (this.bones) return this.bones.rHand.getWorldPosition(out);
    return out.set(0, 1.25, 0.5).applyQuaternion(this.group.quaternion).add(this.group.position);
  }

  die(fx = 0, fz = 0) {
    if (this.dead) return;
    this.dead = true; this.deadT = 0; this.hp = 0;
    this.fall = { fx, fz, t: 0 };
  }

  update(dt, moveSpeed) {
    this.speed = moveSpeed;
    if (this.dead) {
      const f = this.fall; f.t = Math.min(1, f.t + dt * 2.2);
      this.group.rotation.x = -ease(f.t) * Math.PI / 2;
      this.group.position.y = ease(f.t) * 0.25;
      if (this.mixer) { this.mixer.update(0); }
      this.deadT += dt;
      return;
    }
    this.punchT = Math.max(0, this.punchT - dt);
    this.swingT = Math.max(0, this.swingT - dt);
    this.hitT = Math.max(0, this.hitT - dt);
    if (this.mixer) {
      const s = moveSpeed;
      const wIdle = Math.max(0, 1 - s / 1.6), wRun = Math.min(1, Math.max(0, (s - 3.2) / 2.5));
      const wWalk = Math.max(0, 1 - wIdle - wRun);
      this.acts.Idle.setEffectiveWeight(wIdle);
      this.acts.Walk.setEffectiveWeight(wWalk); this.acts.Walk.timeScale = Math.max(0.6, s / 1.7);
      this.acts.Run.setEffectiveWeight(wRun); this.acts.Run.timeScale = Math.max(0.7, s / 6.2);
      this.mixer.update(dt);
      this.group.updateMatrixWorld(true);
      this._overlay();
    } else {
      this.phase += dt * moveSpeed * 1.7;
      animateCharacter(this.simple, this.phase, moveSpeed > 0.2 ? Math.min(0.9, 0.4 + moveSpeed / 10) : 0);
      const p = this.simple.userData.parts;
      if (this.aim) { p.armR.rotation.x = -Math.PI / 2 + this.aim.pitch; p.armL.rotation.x = -Math.PI / 2.3 + this.aim.pitch; }
      if (this.punchT > 0) p.armR.rotation.x = -Math.PI / 2 * Math.sin((1 - this.punchT / 0.38) * Math.PI);
      if (this.swingT > 0) p.armR.rotation.x = -2.5 + (1 - this.swingT / 0.55) * 3;
    }
  }

  _overlay() {
    const B = this.bones, g = this.group;
    const fwd = _dir.set(Math.sin(g.rotation.y), 0, Math.cos(g.rotation.y));
    const right = _right.set(-fwd.z, 0, fwd.x);
    if (this.hitT > 0) {
      const k = Math.sin((this.hitT / 0.25) * Math.PI) * 0.35;
      B.spine.rotateX(-k); B.spine.updateMatrixWorld(true);
    }
    if (this.aim) {
      const d = _aimDir.copy(fwd).multiplyScalar(Math.cos(this.aim.pitch)).setY(Math.sin(this.aim.pitch)).normalize();
      pointBone(B.rArm, B.rFore, d, 1); pointBone(B.rFore, B.rHand, d, 1);
      if (this.aim.twoHand) {
        const l = _l.copy(d).addScaledVector(right, 0.55).normalize();
        pointBone(B.lArm, B.lFore, l, 1);
        const l2 = _l2.copy(d).addScaledVector(right, 0.9).normalize();
        pointBone(B.lFore, B.lHand, l2, 1);
      }
    }
    if (this.punchT > 0) {
      const ph = 1 - this.punchT / 0.38, w = Math.sin(ph * Math.PI);
      const d = _aimDir.copy(fwd).addScaledVector(right, -0.15).setY(0.12).normalize();
      pointBone(B.rArm, B.rFore, d, w); pointBone(B.rFore, B.rHand, d, w);
      B.spine2.rotateY(-0.35 * w); B.spine2.updateMatrixWorld(true);
    }
    if (this.swingT > 0) {
      const ph = 1 - this.swingT / 0.55, a = -1.2 + ease(ph) * 2.6;
      const d = _aimDir.copy(fwd).multiplyScalar(Math.cos(a)).addScaledVector(right, Math.sin(a)).setY(0.25 - ph * 0.3).normalize();
      const w = Math.sin(ph * Math.PI) * 0.9 + 0.1;
      pointBone(B.rArm, B.rFore, d, w); pointBone(B.rFore, B.rHand, d, w);
    }
  }

  remove() { this.scene.remove(this.group); }
}
const _dir = new THREE.Vector3(), _right = new THREE.Vector3(), _aimDir = new THREE.Vector3(), _l = new THREE.Vector3(), _l2 = new THREE.Vector3();

// ---------- weapon meshes ----------
const gunMetal = new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.8, roughness: 0.35 });
const gunGrip = new THREE.MeshStandardMaterial({ color: 0x3a2a1e, metalness: 0.1, roughness: 0.7 });
const batWood = new THREE.MeshStandardMaterial({ color: 0xb08a5a, roughness: 0.6 });
function part(geo, mat, x, y, z) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; return m; }
export function makeWeaponMesh(id) {
  const g = new THREE.Group();
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  if (id === 'pistol') {
    g.add(part(B(0.045, 0.05, 0.22), gunMetal, 0, 0.03, 0.08));
    g.add(part(B(0.04, 0.11, 0.05), gunGrip, 0, -0.04, -0.01));
  } else if (id === 'smg') {
    g.add(part(B(0.06, 0.08, 0.38), gunMetal, 0, 0.03, 0.12));
    g.add(part(B(0.04, 0.14, 0.04), gunMetal, 0, -0.06, 0.12));
    g.add(part(B(0.04, 0.1, 0.05), gunGrip, 0, -0.05, 0.0));
    g.add(part(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8).rotateX(Math.PI / 2), gunMetal, 0, 0.04, 0.36));
  } else if (id === 'shotgun') {
    g.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.62, 8).rotateX(Math.PI / 2), gunMetal, 0, 0.04, 0.25));
    g.add(part(B(0.06, 0.07, 0.3), gunGrip, 0, 0.0, -0.08));
    g.add(part(B(0.05, 0.05, 0.16), gunGrip, 0, 0.0, 0.24));
  } else if (id === 'bat') {
    g.add(part(new THREE.CylinderGeometry(0.05, 0.022, 0.85, 10).rotateX(Math.PI / 2), batWood, 0, 0, 0.36));
  }
  return g;
}

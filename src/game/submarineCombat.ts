import * as THREE from 'three';
import { ParticlePool, sampleOceanWaveHeight } from './oceanAndSky';
import { SoundEngine } from './audio';
import { TitanicShipRig } from './shipBuilder';
import { MathUtils, setEulerXYZ } from './threeHelpers';
import { VesselId } from './types';

interface UBoatEntity {
  id: number;
  group: THREE.Group;
  propPort: THREE.Object3D;
  propStbd: THREE.Object3D;
  beaconMat: THREE.MeshBasicMaterial;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  headingRad: number;
  speed: number;
  hp: number;
  maxHp: number;
  sunk: boolean;
  sinkTimer: number;
  sinkRoll: number;
  sinkPitch: number;
  torpedoCooldown: number;
  warned: boolean;
}

interface ShellEntity {
  mesh: THREE.Mesh;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  flightTime: number;
  willHit: boolean;
  targetSubId: number;
}

export interface TorpedoEntity {
  mesh: THREE.Group;
  prop: THREE.Object3D;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  headingRad: number;
  age: number;
  maxLife: number;
  warned: boolean;
  evadeChecked: boolean;
}

export interface CombatUpdateResult {
  threatWarning: string | null;
  hazardSide: number;
  eventText: string | null;
  scoreDelta: number;
  submarinesSunkDelta: number;
  activeTorpedoes: number;
  torpedoHit: {
    hitX: number;
    hitZ: number;
    sideSign: number;
    isBow: boolean;
  } | null;
}

// Module-level scratch vectors (zero per-frame GC)
const _vGunWorld = new THREE.Vector3();
const _vMuzzleWorld = new THREE.Vector3();

export class SubmarineCombatSystem {
  private readonly scene: THREE.Scene;
  private readonly particles: ParticlePool;
  private readonly sound: SoundEngine;
  private readonly isSoftwareGl: boolean;

  private active = false;
  private activeVessel: VesselId = 'titanic';
  private nextSubId = 1;

  // Ship Forecastle Deck Gun + Crew attached to ship.bowContent
  private readonly deckGunRoot = new THREE.Group();
  private readonly gunMountGroup = new THREE.Group();
  private readonly gunBarrelGroup = new THREE.Group();
  private readonly gunBarrelMesh: THREE.Mesh;
  private readonly gunnerA: THREE.Group;
  private readonly gunnerB: THREE.Group;
  private gunYaw = 0;
  private gunPitch = 0.08;
  private gunRecoil = 0;
  private gunFireCooldown = 2.0;

  // Shared materials & geometries
  private readonly subHullMat: THREE.MeshStandardMaterial;
  private readonly subDeckMat: THREE.MeshStandardMaterial;
  private readonly subBronzeMat: THREE.MeshStandardMaterial;
  private readonly gunSteelMat: THREE.MeshStandardMaterial;
  private readonly gunBrassMat: THREE.MeshStandardMaterial;
  private readonly crewNavyMat: THREE.MeshStandardMaterial;
  private readonly crewSkinMat: THREE.MeshStandardMaterial;
  private readonly shellMat: THREE.MeshBasicMaterial;
  private readonly torpedoBodyMat: THREE.MeshStandardMaterial;
  private readonly torpedoHeadMat: THREE.MeshStandardMaterial;

  private readonly shellGeo: THREE.SphereGeometry;
  private readonly torpedoBodyGeo: THREE.CylinderGeometry;
  private readonly torpedoHeadGeo: THREE.ConeGeometry;
  private readonly torpedoFinGeo: THREE.BoxGeometry;
  private readonly subSharedGeos: THREE.BufferGeometry[] = [];

  private readonly submarines: UBoatEntity[] = [];
  private readonly shells: ShellEntity[] = [];
  public readonly torpedoes: TorpedoEntity[] = [];

  private readonly maxSubmarines: number;

  constructor(scene: THREE.Scene, particles: ParticlePool, sound: SoundEngine, isSoftwareGl: boolean) {
    this.scene = scene;
    this.particles = particles;
    this.sound = sound;
    this.isSoftwareGl = isSoftwareGl;
    this.maxSubmarines = isSoftwareGl ? 3 : 5;

    this.subHullMat = new THREE.MeshStandardMaterial({
      color: 0x3b4652,
      roughness: 0.56,
      metalness: 0.65,
    });
    this.subDeckMat = new THREE.MeshStandardMaterial({
      color: 0x262d36,
      roughness: 0.72,
      metalness: 0.38,
    });
    this.subBronzeMat = new THREE.MeshStandardMaterial({
      color: 0xb68a3e,
      roughness: 0.34,
      metalness: 0.88,
    });
    this.gunSteelMat = new THREE.MeshStandardMaterial({
      color: 0x3c444f,
      roughness: 0.42,
      metalness: 0.78,
    });
    this.gunBrassMat = new THREE.MeshStandardMaterial({
      color: 0xc99c46,
      roughness: 0.32,
      metalness: 0.85,
    });
    this.crewNavyMat = new THREE.MeshStandardMaterial({
      color: 0x1a2840,
      roughness: 0.75,
      metalness: 0.08,
    });
    this.crewSkinMat = new THREE.MeshStandardMaterial({
      color: 0xe3b896,
      roughness: 0.68,
      metalness: 0.02,
    });
    this.shellMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
    });
    this.torpedoBodyMat = new THREE.MeshStandardMaterial({
      color: 0x2d3a46,
      roughness: 0.38,
      metalness: 0.82,
    });
    this.torpedoHeadMat = new THREE.MeshStandardMaterial({
      color: 0xc88d3a,
      roughness: 0.3,
      metalness: 0.88,
    });

    this.shellGeo = new THREE.SphereGeometry(0.24, 8, 6);
    this.torpedoBodyGeo = new THREE.CylinderGeometry(0.26, 0.24, 4.8, 10);
    this.torpedoBodyGeo.rotateX(Math.PI / 2);
    this.torpedoHeadGeo = new THREE.ConeGeometry(0.26, 0.8, 10);
    this.torpedoHeadGeo.rotateX(-Math.PI / 2);
    this.torpedoFinGeo = new THREE.BoxGeometry(0.75, 0.06, 0.45);

    // Build Forecastle 4-inch Naval Deck Gun + 2 Crewmen
    this.deckGunRoot.name = 'forecastle_deck_gun';
    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(0.68, 0.88, 0.95, 14),
      this.gunSteelMat,
    );
    pedestal.position.y = 0.48;
    this.deckGunRoot.add(pedestal);

    const turretRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.78, 0.78, 0.14, 14),
      this.gunBrassMat,
    );
    turretRing.position.y = 0.96;
    this.deckGunRoot.add(turretRing);

    this.gunMountGroup.position.set(0, 1.05, 0);
    this.deckGunRoot.add(this.gunMountGroup);

    const shieldFront = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 1.15, 0.14),
      this.gunSteelMat,
    );
    shieldFront.position.set(0, 0.45, -0.45);
    this.gunMountGroup.add(shieldFront);

    const shieldLeft = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 1.05, 1.25),
      this.gunSteelMat,
    );
    shieldLeft.position.set(-0.74, 0.42, 0.14);
    this.gunMountGroup.add(shieldLeft);

    const shieldRight = shieldLeft.clone();
    shieldRight.position.x = 0.74;
    this.gunMountGroup.add(shieldRight);

    const breech = new THREE.Mesh(
      new THREE.BoxGeometry(0.44, 0.42, 1.15),
      this.gunSteelMat,
    );
    breech.position.set(0, 0.35, 0.15);
    this.gunMountGroup.add(breech);

    this.gunBarrelGroup.position.set(0, 0.45, -0.3);
    this.gunMountGroup.add(this.gunBarrelGroup);

    const barrelGeo = new THREE.CylinderGeometry(0.11, 0.17, 4.1, 12);
    barrelGeo.rotateX(Math.PI / 2);
    this.gunBarrelMesh = new THREE.Mesh(barrelGeo, this.gunSteelMat);
    this.gunBarrelMesh.position.set(0, 0, -2.0);
    this.gunBarrelGroup.add(this.gunBarrelMesh);

    const muzzleCollar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.145, 0.145, 0.24, 12),
      this.gunBrassMat,
    );
    muzzleCollar.rotation.x = Math.PI / 2;
    muzzleCollar.position.set(0, 0, -3.95);
    this.gunBarrelGroup.add(muzzleCollar);

    this.gunnerA = this.buildGunnerMesh();
    this.gunnerA.position.set(-1.12, 0, 0.35);
    this.gunMountGroup.add(this.gunnerA);

    this.gunnerB = this.buildGunnerMesh();
    this.gunnerB.position.set(1.12, 0, 0.48);
    this.gunMountGroup.add(this.gunnerB);

    this.deckGunRoot.visible = false;
  }

  private buildGunnerMesh(): THREE.Group {
    const g = new THREE.Group();
    const legGeo = new THREE.CylinderGeometry(0.11, 0.085, 0.78, 10);
    for (const side of [-0.09, 0.09]) {
      const leg = new THREE.Mesh(legGeo, this.crewNavyMat);
      leg.position.set(side, 0.39, 0);
      g.add(leg);
    }
    const coatPts = [
      new THREE.Vector2(0.175, 0.0),
      new THREE.Vector2(0.155, 0.22),
      new THREE.Vector2(0.195, 0.48),
      new THREE.Vector2(0.215, 0.64),
      new THREE.Vector2(0.09, 0.72),
    ];
    const torsoGeo = new THREE.LatheGeometry(coatPts, 12);
    torsoGeo.scale(1.12, 1.0, 0.78);
    const torso = new THREE.Mesh(torsoGeo, this.crewNavyMat);
    torso.position.y = 0.74;
    g.add(torso);
    for (const side of [-0.22, 0.22]) {
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.42, 4, 8), this.crewNavyMat);
      arm.position.set(side, 1.12, -0.08);
      arm.rotation.x = 0.55;
      arm.rotation.z = side > 0 ? -0.14 : 0.14;
      g.add(arm);
    }
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.118, 10, 10), this.crewSkinMat);
    head.scale.set(0.92, 1.1, 0.98);
    head.position.y = 1.54;
    g.add(head);
    const cap = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.11, 0),
      new THREE.Vector2(0.12, 0.04),
      new THREE.Vector2(0.145, 0.085),
      new THREE.Vector2(0, 0.105),
    ], 12), this.crewNavyMat);
    cap.position.y = 1.61;
    g.add(cap);
    const visor = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.13, 0.015, 10, 1, false, 0, Math.PI * 0.78), this.gunSteelMat);
    visor.position.set(0, 1.61, -0.02);
    visor.rotation.y = -Math.PI * 0.89;
    g.add(visor);
    return g;
  }

  private trackSubGeo<T extends THREE.BufferGeometry>(geo: T): T {
    this.subSharedGeos.push(geo);
    return geo;
  }

  private buildUBoatMesh(): {
    group: THREE.Group;
    propPort: THREE.Object3D;
    propStbd: THREE.Object3D;
    beaconMat: THREE.MeshBasicMaterial;
  } {
    const group = new THREE.Group();
    group.name = 'german_uboat';

    // 54m Lofted Teardrop Pressure Hull (-27 bow to +27 stern)
    const hullProfile: THREE.Vector2[] = [];
    const stations = 22;
    for (let i = 0; i <= stations; i++) {
      const t = i / stations; // 0 = bow (-27), 1 = stern (+27)
      const zY = (t - 0.5) * 54;
      let r: number;
      if (t < 0.22) {
        r = Math.pow(t / 0.22, 0.52) * 2.38;
      } else if (t > 0.68) {
        r = Math.pow((1 - t) / 0.32, 0.68) * 2.38;
      } else {
        r = 2.38 + Math.sin(((t - 0.22) / 0.46) * Math.PI) * 0.12;
      }
      hullProfile.push(new THREE.Vector2(Math.max(0.08, r), zY));
    }
    const hullGeo = this.trackSubGeo(new THREE.LatheGeometry(hullProfile, 18));
    hullGeo.rotateX(Math.PI / 2);
    hullGeo.scale(0.92, 0.96, 1.0);
    const hull = new THREE.Mesh(hullGeo, this.subHullMat);
    hull.position.set(0, -0.75, 0);
    group.add(hull);

    // Sculpted Saddle Ballast Tank Blisters along Port & Starboard flanks
    const tankProfile: THREE.Vector2[] = [
      new THREE.Vector2(0.05, -18.5),
      new THREE.Vector2(0.85, -15.5),
      new THREE.Vector2(1.16, -9.0),
      new THREE.Vector2(1.16, 8.5),
      new THREE.Vector2(0.75, 14.5),
      new THREE.Vector2(0.05, 17.5),
    ];
    const tankGeo = this.trackSubGeo(new THREE.LatheGeometry(tankProfile, 12));
    tankGeo.rotateX(Math.PI / 2);
    tankGeo.scale(0.85, 0.95, 1.0);
    for (const side of [-1, 1] as const) {
      const saddle = new THREE.Mesh(tankGeo, this.subDeckMat);
      saddle.position.set(side * 1.85, -0.92, 0);
      group.add(saddle);
    }

    // Tapered Extruded Slotted Casing Deck
    const deckShape = new THREE.Shape();
    deckShape.moveTo(0, -24.5);
    deckShape.quadraticCurveTo(1.25, -18.0, 1.38, -7.0);
    deckShape.lineTo(1.36, 11.0);
    deckShape.quadraticCurveTo(0.95, 20.5, 0, 24.5);
    deckShape.quadraticCurveTo(-0.95, 20.5, -1.36, 11.0);
    deckShape.lineTo(-1.38, -7.0);
    deckShape.quadraticCurveTo(-1.25, -18.0, 0, -24.5);
    const deckGeo = this.trackSubGeo(
      new THREE.ExtrudeGeometry(deckShape, {
        depth: 0.42,
        bevelEnabled: true,
        bevelThickness: 0.08,
        bevelSize: 0.06,
        bevelSegments: 2,
      }),
    );
    deckGeo.rotateX(Math.PI / 2);
    const deck = new THREE.Mesh(deckGeo, this.subDeckMat);
    deck.position.set(0, 1.62, 0);
    group.add(deck);

    // Bow Net-Cutter Saw Fin & Limber Flood Slots
    const cutterShape = new THREE.Shape();
    cutterShape.moveTo(0, 0);
    cutterShape.lineTo(1.8, 0.95);
    cutterShape.lineTo(2.1, 0);
    cutterShape.closePath();
    const cutterGeo = this.trackSubGeo(new THREE.ExtrudeGeometry(cutterShape, { depth: 0.08, bevelEnabled: false }));
    cutterGeo.rotateY(Math.PI / 2);
    const cutter = new THREE.Mesh(cutterGeo, this.subDeckMat);
    cutter.position.set(-0.04, 1.15, -25.8);
    group.add(cutter);

    // Airfoil Beveled Conning Tower (Sail) + Wintergarden AA Platform
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0, -4.2);
    sailShape.quadraticCurveTo(1.08, -2.5, 1.05, 0.4);
    sailShape.quadraticCurveTo(0.88, 3.2, 0, 4.6);
    sailShape.quadraticCurveTo(-0.88, 3.2, -1.05, 0.4);
    sailShape.quadraticCurveTo(-1.08, -2.5, 0, -4.2);
    const sailGeo = this.trackSubGeo(
      new THREE.ExtrudeGeometry(sailShape, {
        depth: 3.1,
        bevelEnabled: true,
        bevelThickness: 0.16,
        bevelSize: 0.12,
        bevelSegments: 2,
      }),
    );
    sailGeo.rotateX(Math.PI / 2);
    const tower = new THREE.Mesh(sailGeo, this.subHullMat);
    tower.position.set(0, 4.45, -1.2);
    group.add(tower);

    // Upper Conning Bridge Bulwark & Aft AA Wintergarden Step
    const bridgeGeo = this.trackSubGeo(
      new THREE.ExtrudeGeometry(sailShape, { depth: 0.48, bevelEnabled: true, bevelThickness: 0.06, bevelSize: 0.08, bevelSegments: 1 }),
    );
    bridgeGeo.rotateX(Math.PI / 2);
    bridgeGeo.scale(1.06, 1.0, 0.85);
    const bridgeRim = new THREE.Mesh(bridgeGeo, this.subDeckMat);
    bridgeRim.position.set(0, 4.85, -1.6);
    group.add(bridgeRim);

    const wintergarden = new THREE.Mesh(
      this.trackSubGeo(new THREE.CylinderGeometry(0.98, 0.92, 1.25, 14)),
      this.subDeckMat,
    );
    wintergarden.scale.set(0.95, 1.0, 1.35);
    wintergarden.position.set(0, 3.15, 2.5);
    group.add(wintergarden);

    // Twin Periscopes, UZO Optical Stand, RDF Loop & Twin 20mm AA Flak Barrels
    const scopeGeo = this.trackSubGeo(new THREE.CylinderGeometry(0.065, 0.09, 2.8, 10));
    const scopeA = new THREE.Mesh(scopeGeo, this.subBronzeMat);
    scopeA.position.set(-0.22, 6.0, -2.1);
    group.add(scopeA);
    const scopeB = new THREE.Mesh(scopeGeo, this.gunSteelMat);
    scopeB.position.set(0.22, 5.45, -1.0);
    group.add(scopeB);

    const dfLoop = new THREE.Mesh(
      this.trackSubGeo(new THREE.TorusGeometry(0.32, 0.035, 6, 16)),
      this.subBronzeMat,
    );
    dfLoop.position.set(0, 5.42, -3.5);
    group.add(dfLoop);

    const flakBarrelGeo = this.trackSubGeo(new THREE.CylinderGeometry(0.035, 0.05, 1.65, 8));
    flakBarrelGeo.rotateX(Math.PI / 2 - 0.32);
    for (const fx of [-0.14, 0.14]) {
      const flak = new THREE.Mesh(flakBarrelGeo, this.gunSteelMat);
      flak.position.set(fx, 4.05, 3.1);
      group.add(flak);
    }

    // Subtle Conning Tower Running Beacon
    const beaconMat = new THREE.MeshBasicMaterial({ color: 0xff5a36 });
    const beacon = new THREE.Mesh(this.trackSubGeo(new THREE.SphereGeometry(0.18, 10, 8)), beaconMat);
    beacon.position.set(0, 5.05, -4.3);
    group.add(beacon);

    // Detailed 8.8cm Fore Deck Gun with Shield, Cradle & Barrel Collar
    const uGunBase = new THREE.Mesh(this.trackSubGeo(new THREE.CylinderGeometry(0.34, 0.46, 0.68, 12)), this.gunSteelMat);
    uGunBase.position.set(0, 1.92, -9.2);
    group.add(uGunBase);
    const uGunShield = new THREE.Mesh(this.trackSubGeo(new THREE.BoxGeometry(0.95, 0.72, 0.12)), this.subDeckMat);
    uGunShield.position.set(0, 2.38, -9.55);
    uGunShield.rotation.x = -0.25;
    group.add(uGunShield);
    const uGunBarrel = new THREE.Mesh(this.trackSubGeo(new THREE.CylinderGeometry(0.075, 0.13, 2.85, 10)), this.gunSteelMat);
    uGunBarrel.rotation.x = Math.PI / 2 - 0.08;
    uGunBarrel.position.set(0, 2.34, -10.55);
    group.add(uGunBarrel);

    // Tapered Hydroplanes & Streamlined Rudder + Twin Skewed Hydrofoil Bronze Props
    const planeShape = new THREE.Shape();
    planeShape.moveTo(-2.7, -0.35);
    planeShape.lineTo(2.7, -0.35);
    planeShape.lineTo(2.2, 0.55);
    planeShape.lineTo(-2.2, 0.55);
    planeShape.closePath();
    const hydroGeo = this.trackSubGeo(new THREE.ExtrudeGeometry(planeShape, { depth: 0.14, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 1 }));
    hydroGeo.rotateX(Math.PI / 2);
    const hydroplane = new THREE.Mesh(hydroGeo, this.subDeckMat);
    hydroplane.position.set(0, -0.7, 23.4);
    group.add(hydroplane);

    const rudderShape = new THREE.Shape();
    rudderShape.moveTo(0, -1.4);
    rudderShape.lineTo(1.5, -1.1);
    rudderShape.lineTo(1.65, 1.15);
    rudderShape.lineTo(0, 1.35);
    rudderShape.closePath();
    const rudderGeo = this.trackSubGeo(new THREE.ExtrudeGeometry(rudderShape, { depth: 0.18, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 }));
    rudderGeo.rotateY(-Math.PI / 2);
    const rudder = new THREE.Mesh(rudderGeo, this.subDeckMat);
    rudder.position.set(0.09, -0.65, 25.0);
    group.add(rudder);

    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, 0);
    bladeShape.quadraticCurveTo(0.26, 0.35, 0.18, 0.72);
    bladeShape.quadraticCurveTo(0, 0.86, -0.18, 0.62);
    bladeShape.quadraticCurveTo(-0.22, 0.25, 0, 0);
    const bladeGeo = this.trackSubGeo(new THREE.ExtrudeGeometry(bladeShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 1 }));
    const hubGeo = this.trackSubGeo(new THREE.CylinderGeometry(0.16, 0.22, 0.45, 10));
    hubGeo.rotateX(Math.PI / 2);

    const makeProp = (x: number): THREE.Group => {
      const p = new THREE.Group();
      p.position.set(x, -0.95, 24.9);
      const hub = new THREE.Mesh(hubGeo, this.subBronzeMat);
      p.add(hub);
      for (let b = 0; b < 3; b++) {
        const piv = new THREE.Group();
        piv.rotation.z = (b * Math.PI * 2) / 3;
        const blade = new THREE.Mesh(bladeGeo, this.subBronzeMat);
        blade.rotation.y = 0.52;
        blade.position.y = 0.1;
        piv.add(blade);
        p.add(piv);
      }
      group.add(p);
      return p;
    };

    const propPort = makeProp(-1.15);
    const propStbd = makeProp(1.15);

    this.scene.add(group);
    return { group, propPort, propStbd, beaconMat };
  }

  private buildTorpedoMesh(): { mesh: THREE.Group; prop: THREE.Object3D } {
    const mesh = new THREE.Group();
    const body = new THREE.Mesh(this.torpedoBodyGeo, this.torpedoBodyMat);
    mesh.add(body);
    const head = new THREE.Mesh(this.torpedoHeadGeo, this.torpedoHeadMat);
    head.position.z = -2.8;
    mesh.add(head);
    const finH = new THREE.Mesh(this.torpedoFinGeo, this.torpedoHeadMat);
    finH.position.z = 2.25;
    mesh.add(finH);
    const finV = new THREE.Mesh(this.torpedoFinGeo, this.torpedoHeadMat);
    finV.rotation.z = Math.PI / 2;
    finV.position.z = 2.25;
    mesh.add(finV);

    const prop = new THREE.Group();
    prop.position.z = 2.52;
    const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.05), this.subBronzeMat);
    const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.62, 0.05), this.subBronzeMat);
    prop.add(b1, b2);
    mesh.add(prop);

    this.scene.add(mesh);
    return { mesh, prop };
  }

  public setActiveShip(vesselId: VesselId, shipRig: TitanicShipRig): void {
    this.activeVessel = vesselId;
    this.active = vesselId === 'britannic';

    this.deckGunRoot.removeFromParent();
    if (this.active) {
      // Positioned cleanly on Britannic's forward forecastle deck (visible forward from Wheelhouse)
      this.deckGunRoot.position.set(0, 9.3, -39.0);
      this.deckGunRoot.visible = true;
      shipRig.bowContent.add(this.deckGunRoot);
    } else {
      this.deckGunRoot.visible = false;
    }
  }

  public getActiveSubmarines(): ReadonlyArray<{ x: number; z: number; sunk: boolean }> {
    return this.submarines.filter((s) => !s.sunk);
  }

  public isEnabled(): boolean {
    return this.active;
  }

  public clearAllEntities(): void {
    for (let i = 0; i < this.submarines.length; i++) {
      this.scene.remove(this.submarines[i].group);
      this.submarines[i].beaconMat.dispose();
    }
    this.submarines.length = 0;

    for (let i = 0; i < this.shells.length; i++) {
      this.scene.remove(this.shells[i].mesh);
    }
    this.shells.length = 0;

    for (let i = 0; i < this.torpedoes.length; i++) {
      this.scene.remove(this.torpedoes[i].mesh);
    }
    this.torpedoes.length = 0;

    this.gunYaw = 0;
    this.gunPitch = 0.08;
    this.gunRecoil = 0;
    this.gunFireCooldown = 2.2;
  }

  public seedPatrolSquadron(shipX: number, shipZ: number, startInNight: boolean): void {
    this.clearAllEntities();
    if (!this.active) return;

    const baseZ = startInNight ? shipZ - 340 : -920;
    for (let i = 0; i < this.maxSubmarines; i++) {
      const zPos = baseZ - i * 440 - Math.random() * 140;
      const laneSide = i % 2 === 0 ? -1 : 1;
      const xPos = shipX * 0.25 + laneSide * (75 + Math.random() * 115);
      this.spawnSubmarineAt(xPos, zPos);
    }
  }

  private spawnSubmarineAt(x: number, z: number): void {
    const built = this.buildUBoatMesh();
    const hp = this.activeVessel === 'britannic' ? 3 : 2;
    const heading = (Math.random() - 0.5) * 0.8 + (x > 0 ? -0.35 : 0.35);
    const speed = 7.5 + Math.random() * 3.5;

    built.group.position.set(x, 0, z);
    this.submarines.push({
      id: this.nextSubId++,
      group: built.group,
      propPort: built.propPort,
      propStbd: built.propStbd,
      beaconMat: built.beaconMat,
      x,
      y: 0,
      z,
      vx: Math.sin(heading) * speed,
      vz: Math.cos(heading) * speed,
      headingRad: heading,
      speed,
      hp,
      maxHp: hp,
      sunk: false,
      sinkTimer: 0,
      sinkRoll: 0,
      sinkPitch: 0,
      torpedoCooldown: 4.5 + Math.random() * 3.5,
      warned: false,
    });
  }

  public getAutopilotObstacles(): Array<{ x: number; z: number; vx: number; vz: number; radius: number }> {
    const list: Array<{ x: number; z: number; vx: number; vz: number; radius: number }> = [];
    for (let i = 0; i < this.submarines.length; i++) {
      const s = this.submarines[i];
      if (!s.sunk) list.push({ x: s.x, z: s.z, vx: s.vx, vz: s.vz, radius: 16 });
    }
    for (let i = 0; i < this.torpedoes.length; i++) {
      const t = this.torpedoes[i];
      list.push({ x: t.x, z: t.z, vx: t.vx, vz: t.vz, radius: 9 });
    }
    return list;
  }

  public update(
    dt: number,
    simTime: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    shipSpeedKnots: number,
    nightMix: number,
    activeHullCheckPoints: Array<{ zLocal: number; radius: number }>,
    allowCombatActions: boolean,
  ): CombatUpdateResult {
    const result: CombatUpdateResult = {
      threatWarning: null,
      hazardSide: 0,
      eventText: null,
      scoreDelta: 0,
      submarinesSunkDelta: 0,
      activeTorpedoes: this.torpedoes.length,
      torpedoHit: null,
    };

    if (!this.active) return result;

    const fwdX = Math.sin(headingRad);
    const fwdZ = -Math.cos(headingRad);
    const rightX = Math.cos(headingRad);
    const rightZ = Math.sin(headingRad);
    const shipWorldSpeed = shipSpeedKnots * 2.15;

    let closestWarnDist = Infinity;
    let bestTargetSub: UBoatEntity | null = null;
    let bestTargetDist = Infinity;

    // -----------------------------------------------------------------------
    // 1. Update U-Boat Squadron (Patrol, Wave Bobbing, Prop Spin, Torpedo Fire)
    // -----------------------------------------------------------------------
    for (let i = this.submarines.length - 1; i >= 0; i--) {
      const sub = this.submarines[i];
      const waveY = sampleOceanWaveHeight(sub.x, sub.z, simTime);

      if (sub.sunk) {
        sub.sinkTimer += dt;
        sub.sinkPitch = MathUtils.damp(sub.sinkPitch, -0.68, 1.4, dt);
        sub.sinkRoll = MathUtils.damp(sub.sinkRoll, 0.55, 1.2, dt);
        sub.y -= (2.4 + sub.sinkTimer * 1.1) * dt;
        sub.group.position.set(sub.x, sub.y, sub.z);
        setEulerXYZ(sub.group, sub.sinkPitch, -sub.headingRad, sub.sinkRoll);
        if (Math.random() < 0.35 && sub.y > -12) {
          this.particles.emit(
            sub.x + (Math.random() - 0.5) * 8,
            Math.max(-2, sub.y + 1.5),
            sub.z + (Math.random() - 0.5) * 8,
            (Math.random() - 0.5) * 2,
            2.4 + Math.random() * 2.5,
            (Math.random() - 0.5) * 2,
            0.55,
            1.2,
            -2.4,
            0xbfe9ff,
          );
        }
        if (sub.sinkTimer > 9.5 || sub.y < -30) {
          this.scene.remove(sub.group);
          sub.beaconMat.dispose();
          this.submarines.splice(i, 1);
          // Respawn fresh U-boat patrol ahead in Atlantic lane
          const spawnZ = Math.min(-900, shipZ - 1150 - Math.random() * 550);
          const spawnX = shipX + (Math.random() < 0.5 ? -1 : 1) * (95 + Math.random() * 145);
          this.spawnSubmarineAt(spawnX, spawnZ);
        }
        continue;
      }

      // Gently steer U-boat to stalk toward ship corridor without colliding recklessly
      const dxToShip = shipX - sub.x;
      const dzToShip = shipZ - sub.z;
      const distToShip = Math.hypot(dxToShip, dzToShip);

      if (distToShip > 90 && distToShip < 650) {
        const desiredHeading = Math.atan2(dxToShip, dzToShip);
        let diff = desiredHeading - sub.headingRad;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        sub.headingRad += MathUtils.clamp(diff, -0.25 * dt, 0.25 * dt);
      }

      sub.vx = Math.sin(sub.headingRad) * sub.speed;
      sub.vz = Math.cos(sub.headingRad) * sub.speed;
      sub.x += sub.vx * dt;
      sub.z += sub.vz * dt;
      sub.y = waveY;

      sub.group.position.set(sub.x, sub.y, sub.z);
      const wavePitch = Math.sin(simTime * 1.4 + sub.id) * 0.018;
      const waveRoll = Math.cos(simTime * 1.1 + sub.id) * 0.024;
      setEulerXYZ(sub.group, wavePitch, -sub.headingRad, waveRoll);
      sub.propPort.rotation.z += dt * 14;
      sub.propStbd.rotation.z -= dt * 14;
      sub.beaconMat.color.setHex(nightMix > 0.45 ? 0xff4528 : 0xcc6b35);

      // Recycle U-boat left far astern
      if (sub.z - shipZ > 480) {
        sub.z = Math.min(-920, shipZ - 1450 - Math.random() * 450);
        sub.x = shipX + (Math.random() < 0.5 ? -1 : 1) * (85 + Math.random() * 150);
        sub.warned = false;
        sub.hp = sub.maxHp;
      }

      const relX = sub.x - shipX;
      const relZ = sub.z - shipZ;
      const ahead = relX * fwdX + relZ * fwdZ;
      const lateral = relX * rightX + relZ * rightZ;

      // Track targetable U-boat for crew deck gun
      if (allowCombatActions && ahead > -65 && ahead < 450 && distToShip < bestTargetDist) {
        bestTargetDist = distToShip;
        bestTargetSub = sub;
      }

      // Lookout U-boat sighting warning
      if (ahead > 40 && ahead < 360 && distToShip < closestWarnDist) {
        closestWarnDist = distToShip;
        result.hazardSide = Math.abs(lateral) < 15 ? 0 : lateral < 0 ? -1 : 1;
        result.threatWarning =
          Math.abs(lateral) < 18
            ? 'ENEMY U-BOAT DEAD AHEAD'
            : lateral < 0
              ? 'U-BOAT OFF PORT BOW — CREW ENGAGING'
              : 'U-BOAT OFF STARBOARD BOW — CREW ENGAGING';
        if (!sub.warned && ahead < 290) {
          sub.warned = true;
          this.sound.playLookoutBell();
        }
      }

      // U-Boat Torpedo Launch (only after player exits inner harbor channel, z < -620)
      if (allowCombatActions && shipZ < -580 && ahead > -40 && ahead < 490 && distToShip > 65 && distToShip < 480) {
        sub.torpedoCooldown -= dt;
        if (sub.torpedoCooldown <= 0) {
          sub.torpedoCooldown = (this.isSoftwareGl ? 7.8 : 6.2) + Math.random() * 2.8;
          this.launchTorpedoFromSub(sub, shipX, shipZ, fwdX, fwdZ, shipWorldSpeed);
          if (!result.eventText) {
            result.eventText = 'U-BOAT FIRED TORPEDO — TURN HARD TO EVADE!';
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // 2. Forecastle Deck Gun Aiming & Crew Gunnery (with ~40% realistic misses!)
    // -----------------------------------------------------------------------
    this.gunRecoil = MathUtils.damp(this.gunRecoil, 0, 10, dt);
    this.gunBarrelMesh.position.z = -2.0 + this.gunRecoil;

    const animSway = Math.sin(simTime * 2.8) * 0.08;
    this.gunnerA.rotation.y = animSway;
    this.gunnerB.rotation.y = -animSway;

    if (allowCombatActions && bestTargetSub) {
      this.deckGunRoot.updateWorldMatrix(true, false);
      this.deckGunRoot.getWorldPosition(_vGunWorld);
      const dx = bestTargetSub.x - _vGunWorld.x;
      const dz = bestTargetSub.z - _vGunWorld.z;
      const horizDist = Math.hypot(dx, dz);

      // Compute gun rotation in ship-local space
      const worldAimYaw = Math.atan2(-dx, -dz);
      let desiredLocalYaw = worldAimYaw - -headingRad;
      while (desiredLocalYaw > Math.PI) desiredLocalYaw -= Math.PI * 2;
      while (desiredLocalYaw < -Math.PI) desiredLocalYaw += Math.PI * 2;
      desiredLocalYaw = MathUtils.clamp(desiredLocalYaw, -1.95, 1.95);

      const shellSpeed = 165;
      const tFlight = horizDist / shellSpeed;
      const desiredPitch = MathUtils.clamp(
        0.5 * 9.8 * tFlight / shellSpeed + (1.5 - _vGunWorld.y) / Math.max(40, horizDist),
        -0.15,
        0.38,
      );

      this.gunYaw = MathUtils.damp(this.gunYaw, desiredLocalYaw, 5.5, dt);
      this.gunPitch = MathUtils.damp(this.gunPitch, desiredPitch, 5.5, dt);
      this.gunMountGroup.rotation.y = this.gunYaw;
      this.gunBarrelGroup.rotation.x = this.gunPitch;

      this.gunFireCooldown -= dt;
      if (this.gunFireCooldown <= 0 && Math.abs(this.gunYaw - desiredLocalYaw) < 0.25 && shipZ < -420) {
        this.gunFireCooldown = 2.55 + Math.random() * 0.75;
        this.fireCrewShell(bestTargetSub);
      }
    } else {
      this.gunYaw = MathUtils.damp(this.gunYaw, 0, 2.5, dt);
      this.gunPitch = MathUtils.damp(this.gunPitch, 0.06, 2.5, dt);
      this.gunMountGroup.rotation.y = this.gunYaw;
      this.gunBarrelGroup.rotation.x = this.gunPitch;
    }

    // -----------------------------------------------------------------------
    // 3. Update Flying Crew Naval Shells (Hits & Splashing Misses)
    // -----------------------------------------------------------------------
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const sh = this.shells[i];
      sh.age += dt;
      sh.vy -= 9.8 * dt;
      sh.x += sh.vx * dt;
      sh.y += sh.vy * dt;
      sh.z += sh.vz * dt;
      sh.mesh.position.set(sh.x, sh.y, sh.z);

      const waveY = sampleOceanWaveHeight(sh.x, sh.z, simTime);
      let resolved = false;

      if (sh.willHit) {
        const sub = this.submarines.find((s) => s.id === sh.targetSubId);
        if (sub && !sub.sunk) {
          const distSub = Math.hypot(sh.x - sub.x, sh.z - sub.z);
          if ((distSub < 10.5 && sh.y <= sub.y + 5.2) || sh.age >= sh.flightTime) {
            resolved = true;
            sub.hp -= 1;
            const sunkNow = sub.hp <= 0;
            this.sound.playSubmarineStruck(sunkNow);
            this.burstExplosion(sub.x, Math.max(1.2, sub.y + 1.5), sub.z, sunkNow ? 36 : 18);
            if (sunkNow) {
              sub.sunk = true;
              sub.sinkTimer = 0;
              result.scoreDelta += 500;
              result.submarinesSunkDelta += 1;
              result.eventText = 'DIRECT HIT! U-BOAT SUNK BY CREW GUNNERY (+500)';
            } else {
              result.scoreDelta += 140;
              result.eventText = `CREW SHELL STRUCK U-BOAT CONNING TOWER (${sub.hp}/${sub.maxHp} HP)`;
            }
          }
        }
      }

      if (!resolved && (sh.y <= waveY || sh.age >= sh.flightTime + 0.35)) {
        resolved = true;
        // Miss splash water geyser!
        this.burstWaterGeyser(sh.x, waveY, sh.z, 22);
        if (!sh.willHit && !result.eventText) {
          result.eventText = 'CREW SHOT MISSED WIDE! U-BOAT SURVIVES — BRACE FOR TORPEDO!';
        }
      }

      if (resolved) {
        this.scene.remove(sh.mesh);
        this.shells.splice(i, 1);
      }
    }

    // -----------------------------------------------------------------------
    // 4. Update Underwater Torpedoes (Bubble Wakes, Evasion, Hull Strikes)
    // -----------------------------------------------------------------------
    for (let i = this.torpedoes.length - 1; i >= 0; i--) {
      const torp = this.torpedoes[i];
      torp.age += dt;
      torp.x += torp.vx * dt;
      torp.z += torp.vz * dt;
      const waveY = sampleOceanWaveHeight(torp.x, torp.z, simTime);
      torp.y = waveY - 0.34;
      torp.mesh.position.set(torp.x, torp.y, torp.z);
      torp.mesh.rotation.y = -torp.headingRad;
      torp.prop.rotation.z += dt * 32;

      // Frothy bubble wake rising to surface along torpedo track
      if (Math.random() < 0.78) {
        this.particles.emit(
          torp.x - Math.sin(torp.headingRad) * 2.4 + (Math.random() - 0.5) * 0.4,
          waveY + 0.12,
          torp.z + Math.cos(torp.headingRad) * 2.4 + (Math.random() - 0.5) * 0.4,
          (Math.random() - 0.5) * 0.8,
          1.2 + Math.random() * 1.4,
          (Math.random() - 0.5) * 0.8,
          0.32 + Math.random() * 0.28,
          0.85,
          2.2,
          0xdbf4ff,
        );
      }

      const relX = torp.x - shipX;
      const relZ = torp.z - shipZ;
      const distShip = Math.hypot(relX, relZ);
      const lateral = relX * rightX + relZ * rightZ;

      if (distShip < 340) {
        if (!torp.warned) {
          torp.warned = true;
          this.sound.playLookoutBell();
        }
        if (distShip < closestWarnDist) {
          closestWarnDist = distShip;
          result.hazardSide = Math.abs(lateral) < 8 ? 0 : lateral < 0 ? -1 : 1;
          result.threatWarning =
            lateral < 0
              ? 'TORPEDO IN THE WATER OFF PORT! TURN STARBOARD!'
              : 'TORPEDO IN THE WATER OFF STARBOARD! TURN PORT!';
        }
      }

      // Check hull checkpoint collision
      let struckHull = false;
      for (let p = 0; p < activeHullCheckPoints.length; p++) {
        const hp = activeHullCheckPoints[p];
        const px = shipX + fwdX * -hp.zLocal;
        const pz = shipZ + fwdZ * -hp.zLocal;
        const dist = Math.hypot(torp.x - px, torp.z - pz);
        if (dist < hp.radius + 1.8) {
          struckHull = true;
          this.sound.playSubmarineStruck(false);
          this.burstWaterGeyser(torp.x, waveY, torp.z, 38);
          this.burstExplosion(torp.x, waveY + 1.8, torp.z, 22);
          result.torpedoHit = {
            hitX: torp.x,
            hitZ: torp.z,
            sideSign: lateral >= 0 ? 1 : -1,
            isBow: p <= 1,
          };
          break;
        }
      }

      if (struckHull) {
        this.scene.remove(torp.mesh);
        this.torpedoes.splice(i, 1);
        continue;
      }

      // Clean evasion bonus if torpedo passes harmlessly wide/astern
      if (!torp.evadeChecked && torp.age > 3.5 && distShip > 195) {
        const dotVel = (shipX - torp.x) * torp.vx + (shipZ - torp.z) * torp.vz;
        if (dotVel < 0) {
          torp.evadeChecked = true;
          result.scoreDelta += 150;
          if (!result.eventText) {
            result.eventText = 'TORPEDO EVADED CLEANLY (+150)';
          }
        }
      }

      if (torp.age >= torp.maxLife || distShip > 820) {
        this.scene.remove(torp.mesh);
        this.torpedoes.splice(i, 1);
      }
    }

    result.activeTorpedoes = this.torpedoes.length;
    return result;
  }

  private fireCrewShell(targetSub: UBoatEntity): void {
    this.gunRecoil = 0.72;
    this.sound.playNavalCannon(false);

    // Muzzle flash world position
    this.gunBarrelMesh.updateWorldMatrix(true, false);
    _vMuzzleWorld.set(0, -1.9, 0); // rotated barrel tip
    this.gunBarrelGroup.updateWorldMatrix(true, false);
    _vMuzzleWorld.set(0, 0, -4.0).applyMatrix4(this.gunBarrelGroup.matrixWorld);

    for (let i = 0; i < 10; i++) {
      this.particles.emit(
        _vMuzzleWorld.x + (Math.random() - 0.5) * 0.6,
        _vMuzzleWorld.y + (Math.random() - 0.5) * 0.6,
        _vMuzzleWorld.z + (Math.random() - 0.5) * 0.6,
        (Math.random() - 0.5) * 4,
        1.5 + Math.random() * 3.5,
        (Math.random() - 0.5) * 4,
        0.55 + Math.random() * 0.45,
        0.45,
        -1.5,
        i < 5 ? 0xffb84d : 0xdbeafe,
      );
    }

    // 60% accurate hit / 40% intentional miss so U-boats survive occasionally & launch torpedoes!
    const willHit = Math.random() < 0.60;
    const shellSpeed = 165;
    const approxDist = Math.hypot(targetSub.x - _vMuzzleWorld.x, targetSub.z - _vMuzzleWorld.z);
    const flightTime = Math.max(0.28, approxDist / shellSpeed);

    let aimX = targetSub.x + targetSub.vx * flightTime * 0.85;
    let aimZ = targetSub.z + targetSub.vz * flightTime * 0.85;
    if (!willHit) {
      const missAng = Math.random() * Math.PI * 2;
      const missRadius = 15 + Math.random() * 14;
      aimX += Math.cos(missAng) * missRadius;
      aimZ += Math.sin(missAng) * missRadius;
    }

    const dx = aimX - _vMuzzleWorld.x;
    const dz = aimZ - _vMuzzleWorld.z;
    const dy = (targetSub.y + 1.2) - _vMuzzleWorld.y;

    const vx = dx / flightTime;
    const vz = dz / flightTime;
    const vy = dy / flightTime + 0.5 * 9.8 * flightTime;

    const mesh = new THREE.Mesh(this.shellGeo, this.shellMat);
    mesh.position.copy(_vMuzzleWorld);
    this.scene.add(mesh);

    this.shells.push({
      mesh,
      x: _vMuzzleWorld.x,
      y: _vMuzzleWorld.y,
      z: _vMuzzleWorld.z,
      vx,
      vy,
      vz,
      age: 0,
      flightTime,
      willHit,
      targetSubId: targetSub.id,
    });
  }

  private launchTorpedoFromSub(
    sub: UBoatEntity,
    shipX: number,
    shipZ: number,
    fwdX: number,
    fwdZ: number,
    shipWorldSpeed: number,
  ): void {
    const torpSpeed = 38.0;
    const distNow = Math.hypot(shipX - sub.x, shipZ - sub.z);
    const leadT = Math.min(7.5, distNow / torpSpeed);

    // Lead slightly along player's current course + small dispersion
    const leadX = shipX + fwdX * shipWorldSpeed * leadT * 0.55 + (Math.random() - 0.5) * 14;
    const leadZ = shipZ + fwdZ * shipWorldSpeed * leadT * 0.55 + (Math.random() - 0.5) * 14;

    const dx = leadX - sub.x;
    const dz = leadZ - sub.z;
    const len = Math.max(1, Math.hypot(dx, dz));
    const dirX = dx / len;
    const dirZ = dz / len;
    const headingRad = Math.atan2(dirX, -dirZ);

    const startX = sub.x + dirX * 14;
    const startZ = sub.z + dirZ * 14;
    const built = this.buildTorpedoMesh();
    built.mesh.position.set(startX, sub.y - 0.34, startZ);
    built.mesh.rotation.y = -headingRad;

    this.torpedoes.push({
      mesh: built.mesh,
      prop: built.prop,
      x: startX,
      y: sub.y - 0.34,
      z: startZ,
      vx: dirX * torpSpeed,
      vz: dirZ * torpSpeed,
      headingRad,
      age: 0,
      maxLife: 16.0,
      warned: false,
      evadeChecked: false,
    });

    this.sound.playTorpedoLaunch();
  }

  private burstWaterGeyser(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.particles.emit(
        x + (Math.random() - 0.5) * 2.5,
        y + 0.3,
        z + (Math.random() - 0.5) * 2.5,
        (Math.random() - 0.5) * 5.2,
        6.5 + Math.random() * 11.5,
        (Math.random() - 0.5) * 5.2,
        0.55 + Math.random() * 0.85,
        0.95 + Math.random() * 0.5,
        14.0,
        i % 3 === 0 ? 0xf0f9ff : 0xb8e6ff,
      );
    }
  }

  private burstExplosion(x: number, y: number, z: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const isFire = i < count * 0.55;
      this.particles.emit(
        x + (Math.random() - 0.5) * 3.0,
        y + Math.random() * 1.5,
        z + (Math.random() - 0.5) * 3.0,
        (Math.random() - 0.5) * 9.0,
        4.5 + Math.random() * 8.5,
        (Math.random() - 0.5) * 9.0,
        isFire ? 0.75 + Math.random() * 0.8 : 1.0 + Math.random() * 1.1,
        isFire ? 0.7 + Math.random() * 0.4 : 1.3 + Math.random() * 0.7,
        isFire ? 9.5 : 3.5,
        isFire ? 0xff9d3b : 0x384152,
      );
    }
  }

  public dispose(): void {
    this.clearAllEntities();
    this.deckGunRoot.removeFromParent();
    this.subHullMat.dispose();
    this.subDeckMat.dispose();
    this.subBronzeMat.dispose();
    this.gunSteelMat.dispose();
    this.gunBrassMat.dispose();
    this.crewNavyMat.dispose();
    this.crewSkinMat.dispose();
    this.shellMat.dispose();
    this.torpedoBodyMat.dispose();
    this.torpedoHeadMat.dispose();
    this.shellGeo.dispose();
    this.torpedoBodyGeo.dispose();
    this.torpedoHeadGeo.dispose();
    this.torpedoFinGeo.dispose();
    for (let i = 0; i < this.subSharedGeos.length; i++) {
      this.subSharedGeos[i].dispose();
    }
    this.subSharedGeos.length = 0;
  }
}

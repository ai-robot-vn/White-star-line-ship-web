import * as THREE from 'three';
import { buildLusitaniaShip } from './lusitaniaBuilder';
import { buildOlympicShip, TitanicShipRig } from './shipBuilder';
import { ProceduralTextureSet } from './textures';
import { VesselId } from './types';

export function buildOceanLinerShip(
  scene: THREE.Scene,
  textures: ProceduralTextureSet,
  isSoftwareGl: boolean,
  vesselId: VesselId,
  companionOnly = false,
): TitanicShipRig {
  if (vesselId === 'lusitania') {
    return buildLusitaniaShip(scene, textures, isSoftwareGl, companionOnly);
  }
  return buildOlympicShip(scene, textures, isSoftwareGl, vesselId, companionOnly);
}

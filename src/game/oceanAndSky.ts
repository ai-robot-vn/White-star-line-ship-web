import * as THREE from 'three';
import { commitInstanceMatrices, createInstancedSlot, MathUtils, writeInstanceMatrix } from './threeHelpers';

export interface OceanAndSkyRig {
  oceanMesh: THREE.Mesh;
  skyMesh: THREE.Mesh;
  moonMesh: THREE.Mesh;
  starPoints: THREE.Points;
  snowMesh: THREE.InstancedMesh;
  update: (
    time: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    nightMix: number,
    hullActive?: number,
    wakeActive?: number,
  ) => void;
  setHullDimensions: (bowZ: number, sternZ: number, halfBeam: number) => void;
  updateCameraView: (cameraPos: THREE.Vector3, underwaterMix: number) => void;
  dispose: () => void;
}

/**
 * Synchronized 4-component Gerstner ocean wave height sampler (CPU <-> GLSL exact match)
 * so boats, icebergs, buoys, and underwater transitions ride the exact crest elevation.
 */
export function sampleOceanWaveHeight(worldX: number, worldZ: number, t: number): number {
  const k1 = 0.036;
  const k2 = 0.068;
  const k3 = 0.115;
  const k4 = 0.21;

  const p1 = (worldX * 0.85 + worldZ * 0.52) * k1 + t * 0.85;
  const p2 = (worldX * -0.58 + worldZ * 0.81) * k2 + t * 1.18;
  const p3 = (worldX * 0.34 - worldZ * 0.94) * k3 + t * 1.62;
  const p4 = (worldX * 0.91 + worldZ * -0.41) * k4 + t * 2.15;

  return Math.sin(p1) * 0.24 + Math.sin(p2) * 0.13 + Math.sin(p3) * 0.065 + Math.sin(p4) * 0.025;
}

export function createOceanAndSky(scene: THREE.Scene, isSoftwareGl: boolean): OceanAndSkyRig {
  const oceanUniforms = {
    uTime: { value: 0 },
    uWorldOffset: { value: new THREE.Vector2(0, 0) },
    uShipPos: { value: new THREE.Vector2(0, 0) },
    uShipDir: { value: new THREE.Vector2(0, -1) },
    uShipSpeed: { value: 0 },
    uNightMix: { value: 0 },
    uHullCutout: { value: 1.0 },
    uHullZRange: { value: new THREE.Vector2(-70.0, 186.0) },
    uHullHalfBeam: { value: 13.35 },
    uWakeActive: { value: 1.0 },
    uUnderwater: { value: 0.0 },
    uCamPos: { value: new THREE.Vector3(0, 15, 0) },
    uFogColor: { value: new THREE.Color(0x9ec4db) },
    uFogDensity: { value: 0.00095 },
    uKeyDir: { value: new THREE.Vector3(0.32, 0.48, -0.82).normalize() },
    uKeyColor: { value: new THREE.Color(0xfff1d6) },
    uSkyZenith: { value: new THREE.Color(0x1f5c96) },
    uSkyHorizon: { value: new THREE.Color(0x9ec4db) },
  };

  const skyUniforms = {
    uTime: { value: 0 },
    uNightMix: { value: 0 },
    uKeyDir: { value: new THREE.Vector3(0.32, 0.48, -0.82).normalize() },
    uHorizonColor: { value: new THREE.Color(0x9ec4db) },
    uZenithColor: { value: new THREE.Color(0x1f5c96) },
    uSunColor: { value: new THREE.Color(0xfff1d6) },
  };

  // =========================================================================
  // 1. FEATURE-FILM GERSTNER + TRANSLUCENT WATER + CAUSTICS + KELVIN WAKE
  // =========================================================================
  const oceanSegs = isSoftwareGl ? 76 : 168;
  const oceanGeo = new THREE.PlaneGeometry(2600, 2600, oceanSegs, oceanSegs);
  oceanGeo.rotateX(-Math.PI / 2);

  // Radial near-field vertex density warp (~3.7m quads near ship & camera, seamless 2600m horizon)
  const oceanPosAttr = oceanGeo.attributes.position as THREE.BufferAttribute;
  const maxCornerR = Math.hypot(1300, 1300);
  for (let i = 0; i < oceanPosAttr.count; i++) {
    const vx = oceanPosAttr.getX(i);
    const vz = oceanPosAttr.getZ(i);
    const r = Math.hypot(vx, vz);
    if (r > 0.001) {
      const t = Math.min(1, r / maxCornerR);
      const newR = r * (0.24 + 0.76 * Math.pow(t, 1.32));
      const scale = newR / r;
      oceanPosAttr.setX(i, vx * scale);
      oceanPosAttr.setZ(i, vz * scale);
    }
  }
  oceanPosAttr.needsUpdate = true;

  const oceanMat = new THREE.ShaderMaterial({
    uniforms: oceanUniforms,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uWorldOffset;
      varying vec3 vWorldPos;
      varying vec3 vGerstnerNormal;
      varying float vWaveCrest;

      void addGerstner(vec2 pos, vec2 dir, float freq, float speed, float amp, float steep, inout vec3 disp, inout vec3 tangent, inout vec3 binormal) {
        float phase = dot(pos, dir) * freq + uTime * speed;
        float s = sin(phase);
        float c = cos(phase);
        float wa = freq * amp;

        disp.x += steep * amp * dir.x * c;
        disp.z += steep * amp * dir.y * c;
        disp.y += amp * s;

        tangent += vec3(-dir.x * dir.x * steep * wa * s, dir.x * wa * c, -dir.x * dir.y * steep * wa * s);
        binormal += vec3(-dir.x * dir.y * steep * wa * s, dir.y * wa * c, -dir.y * dir.y * steep * wa * s);
      }

      void main() {
        vec3 basePos = position;
        float wx = basePos.x + uWorldOffset.x;
        float wz = basePos.z + uWorldOffset.y;
        vec2 xz = vec2(wx, wz);

        // Dampen Gerstner horizontal steepness gently at far horizon to avoid UV folding
        float distFade = 1.0 - smoothstep(320.0, 1180.0, length(basePos.xz));

        vec3 disp = vec3(0.0);
        vec3 tangent = vec3(1.0, 0.0, 0.0);
        vec3 binormal = vec3(0.0, 0.0, 1.0);

        addGerstner(xz, normalize(vec2(0.85, 0.52)), 0.036, 0.85, 0.24 * distFade, 0.36, disp, tangent, binormal);
        addGerstner(xz, normalize(vec2(-0.58, 0.81)), 0.068, 1.18, 0.13 * distFade, 0.32, disp, tangent, binormal);
        addGerstner(xz, normalize(vec2(0.34, -0.94)), 0.115, 1.62, 0.065 * distFade, 0.28, disp, tangent, binormal);
        addGerstner(xz, normalize(vec2(0.91, -0.41)), 0.21, 2.15, 0.025 * distFade, 0.22, disp, tangent, binormal);

        vec3 worldP = vec3(wx + disp.x, disp.y, wz + disp.z);
        vWorldPos = worldP;
        vGerstnerNormal = normalize(cross(binormal, tangent));
        vWaveCrest = smoothstep(-0.18, 0.42, disp.y);

        gl_Position = projectionMatrix * viewMatrix * vec4(worldP, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec2 uShipPos;
      uniform vec2 uShipDir;
      uniform float uShipSpeed;
      uniform float uNightMix;
      uniform float uHullCutout;
      uniform vec2 uHullZRange;
      uniform float uHullHalfBeam;
      uniform float uWakeActive;
      uniform float uUnderwater;
      uniform vec3 uCamPos;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uKeyDir;
      uniform vec3 uKeyColor;
      uniform vec3 uSkyZenith;
      uniform vec3 uSkyHorizon;

      varying vec3 vWorldPos;
      varying vec3 vGerstnerNormal;
      varying float vWaveCrest;

      float hash21(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }

      float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        float a = hash21(i);
        float b = hash21(i + vec2(1.0, 0.0));
        float c = hash21(i + vec2(0.0, 1.0));
        float d = hash21(i + vec2(1.0, 1.0));
        return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
      }

      float fbm4(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 4; i++) {
          v += a * noise2D(p);
          p = rot * p * 2.06 + vec2(17.1, 31.7);
          a *= 0.5;
        }
        return v;
      }

      float microWaveHeight(vec2 p, float t) {
        float w = 0.0;
        w += noise2D(p * 0.24 + vec2(t * 0.16, -t * 0.12)) * 0.52;
        w += noise2D(p * 0.56 + vec2(-t * 0.25, t * 0.19)) * 0.28;
        w += noise2D(p * 1.32 + vec2(t * 0.42, t * 0.31)) * 0.14;
        w += noise2D(p * 2.85 + vec2(-t * 0.58, -t * 0.44)) * 0.06;
        return w;
      }

      float sampleHullHalfWidth(float zShip, float bowTipZ, float sternTipZ, float maxHalfBeam) {
        float bowJoinZ = mix(bowTipZ, sternTipZ, 0.215);
        float sternStartZ = mix(bowTipZ, sternTipZ, 0.78);
        float ellipStartZ = sternTipZ - 10.0;
        if (zShip < bowJoinZ) {
          float tBow = clamp((zShip - bowTipZ) / max(1.0, bowJoinZ - bowTipZ), 0.0, 1.0);
          return maxHalfBeam * pow(sin(tBow * 1.570796), 0.58);
        }
        if (zShip > ellipStartZ) {
          float tAnchor = clamp((sternTipZ - ellipStartZ) / max(1.0, sternTipZ - sternStartZ), 0.0, 1.0);
          float anchorBeam = maxHalfBeam * pow(sin(tAnchor * 1.570796), 0.50);
          float u = clamp((zShip - ellipStartZ) / max(1.0, sternTipZ - ellipStartZ), 0.0, 1.0);
          return anchorBeam * sqrt(max(0.0, 1.0 - u * u));
        }
        if (zShip > sternStartZ) {
          float tStn = clamp((sternTipZ - zShip) / max(1.0, sternTipZ - sternStartZ), 0.0, 1.0);
          return maxHalfBeam * pow(sin(tStn * 1.570796), 0.50);
        }
        return maxHalfBeam;
      }

      void main() {
        // Keep interior dining saloon / engine room floor dry
        vec2 relShip = vWorldPos.xz - uShipPos;
        vec2 fwd = normalize(uShipDir);
        vec2 right = vec2(-fwd.y, fwd.x);
        float shipFwd = dot(relShip, fwd);
        float shipRight = dot(relShip, right);
        float zShip = -shipFwd;

        float bowTipZ = uHullZRange.x - 4.0;
        float sternTipZ = uHullZRange.y + 9.0;
        if (uHullCutout > 0.5 && zShip > bowTipZ + 1.2 && zShip < sternTipZ - 2.0) {
          float hullHalfW = sampleHullHalfWidth(zShip, bowTipZ, sternTipZ, uHullHalfBeam);
          if (abs(shipRight) < max(0.0, hullHalfW - 0.55)) discard;
        }

        vec3 toCam = uCamPos - vWorldPos;
        float dist = length(toCam);
        vec3 V = toCam / max(dist, 0.001);
        float viewDistAtten = 1.0 - smoothstep(90.0, 720.0, dist);

        // Multi-scale capillary wave normal perturbed on top of Gerstner wave normal
        float eps = 0.26;
        float hC = microWaveHeight(vWorldPos.xz, uTime);
        float hX = microWaveHeight(vWorldPos.xz + vec2(eps, 0.0), uTime);
        float hZ = microWaveHeight(vWorldPos.xz + vec2(0.0, eps), uTime);
        vec3 rippleN = normalize(vec3((hC - hX) * 1.25 * viewDistAtten, 1.0, (hC - hZ) * 1.25 * viewDistAtten));
        vec3 N = normalize(vGerstnerNormal + vec3(rippleN.x, 0.0, rippleN.z) * 0.62);
        if (uUnderwater > 0.5) N = -N;

        // Schlick Fresnel (water IOR ~ 1.333 -> F0 = 0.020)
        float NdotV = max(dot(N, V), 0.001);
        float fresnel = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);
        float lookDown = clamp(abs(V.y), 0.0, 1.0);

        // Deep North Atlantic ocean body, sunlit/moonlit subsurface scatter & animated caustics
        vec3 deepWater = mix(vec3(0.015, 0.095, 0.148), vec3(0.005, 0.028, 0.056), uNightMix);
        vec3 shallowScatter = mix(vec3(0.032, 0.265, 0.325), vec3(0.014, 0.09, 0.14), uNightMix);

        // Dual-layer refracted water caustics visible when looking down into the waves
        vec2 cUv = vWorldPos.xz * 0.16 + N.xz * 1.25;
        float cA = abs(noise2D(cUv + vec2(uTime * 0.24, -uTime * 0.19)) - 0.5);
        float cB = abs(noise2D(cUv * 1.75 - vec2(uTime * 0.31, uTime * 0.22)) - 0.5);
        float causticNet = smoothstep(0.14, 0.01, cA + cB * 0.72) * viewDistAtten * mix(0.42, 0.12, uNightMix);
        vec3 causticGlow = mix(vec3(0.14, 0.48, 0.58), vec3(0.08, 0.22, 0.34), uNightMix) * causticNet * (0.45 + 0.55 * lookDown);

        vec3 L = normalize(uKeyDir);
        float sssView = pow(clamp(dot(V, -L + N * 0.55), 0.0, 1.0), 3.0);
        float sssStrength = (0.35 + 0.65 * vWaveCrest) * sssView * (1.0 - 0.55 * uNightMix);
        vec3 bodyColor = mix(deepWater, shallowScatter, clamp(vWaveCrest * 0.48 + sssStrength * 0.82, 0.0, 1.0)) + causticGlow;

        // Sky reflection matching dynamic sky dome gradient
        vec3 R = reflect(-V, N);
        float reflUp = clamp(R.y, 0.0, 1.0);
        vec3 skyRefl = mix(uSkyHorizon * 0.92, uSkyZenith, pow(reflUp, 0.52));

        // Restrained, silky Blinn-Phong sun/moon glitter (calibrated roughness so NO blinding hotspot glare)
        vec3 H = normalize(L + V);
        float NdotH = max(dot(N, H), 0.0);
        float roughFade = mix(88.0, 32.0, smoothstep(80.0, 620.0, dist));
        float specCore = pow(NdotH, roughFade) * mix(0.68, 0.34, uNightMix);
        float specSheen = pow(NdotH, 18.0) * mix(0.11, 0.05, uNightMix);
        vec3 glint = uKeyColor * min(specCore + specSheen, 0.72);

        // Kelvin bow wake, hull collar foam, and churning stern propeller race
        float speedFactor = clamp(abs(uShipSpeed) / 14.0, 0.0, 1.6) * uWakeActive;
        float foamNoiseA = fbm4(vWorldPos.xz * 0.36 + vec2(uTime * 0.22, -uTime * 0.18));
        float foamNoiseB = fbm4(vWorldPos.xz * 0.85 - vec2(uTime * 0.35, uTime * 0.24));
        float cellularFoam = smoothstep(0.42, 0.78, foamNoiseA * 0.65 + foamNoiseB * 0.35);

        float wakeFoam = 0.0;
        if (speedFactor > 0.03) {
          float distFromBow = -bowTipZ - shipFwd;
          // Crisp 19.47-degree Kelvin divergence + flared wave crest lines
          if (distFromBow > -6.0 && distFromBow < 360.0) {
            float kelvinHalfW = 2.1 + max(0.0, distFromBow) * 0.255;
            float armDist = abs(abs(shipRight) - kelvinHalfW);
            float secondaryArmDist = abs(abs(shipRight) - kelvinHalfW * 0.62);
            float armLine = exp(-pow(armDist / (1.35 + distFromBow * 0.022), 2.0));
            float secLine = exp(-pow(secondaryArmDist / (1.1 + distFromBow * 0.018), 2.0)) * 0.55;
            float bowFade = smoothstep(-5.0, 6.0, distFromBow) * (1.0 - smoothstep(140.0, 360.0, distFromBow));
            wakeFoam += (armLine + secLine) * bowFade * (0.55 + 0.65 * cellularFoam) * min(1.2, speedFactor);
          }

          // Frothy hull-side waterline collar matching fuller bow & elliptical counter stern
          float outerBeam = uHullHalfBeam + 0.65;
          float hullEdgeW = sampleHullHalfWidth(zShip, bowTipZ, sternTipZ + 0.5, outerBeam);
          if (zShip > bowTipZ - 2.0 && zShip < sternTipZ + 3.5) {
            float edgeDist = abs(abs(shipRight) - (hullEdgeW + 0.6));
            float collar = exp(-pow(edgeDist / 2.6, 2.0)) * (0.45 + 0.7 * foamNoiseB);
            wakeFoam += collar * min(1.15, speedFactor * 1.15);
          }

          // Churning stern propeller race extending aft
          if (zShip > uHullZRange.y && zShip < uHullZRange.y + 354.0) {
            float aftD = zShip - uHullZRange.y;
            float propHalfW = 5.4 + aftD * 0.065;
            float propMask = exp(-pow(shipRight / propHalfW, 2.0)) * (1.0 - smoothstep(90.0, 354.0, aftD));
            float propLaces = smoothstep(0.28, 0.72, foamNoiseA * 0.5 + foamNoiseB * 0.6);
            wakeFoam += propMask * propLaces * 0.92 * min(1.25, speedFactor);
          }
        }

        // Natural Atlantic wind-driven crest whitecaps
        float windWhitecap = smoothstep(0.66, 0.90, vWaveCrest * 0.75 + foamNoiseB * 0.45) * 0.26;
        float totalFoam = clamp(wakeFoam + windWhitecap, 0.0, 0.96);

        vec3 oceanColor = mix(bodyColor, skyRefl, fresnel * 0.78) + glint;
        vec3 foamTint = mix(vec3(0.92, 0.96, 1.0), vec3(0.46, 0.58, 0.72), uNightMix * 0.75);
        oceanColor = mix(oceanColor, foamTint, totalFoam);

        // Angle-dependent water translucency: downward views look into the sea revealing submerged hulls, props & torpedoes
        float baseAlpha = mix(0.86, 0.48, smoothstep(0.14, 0.78, lookDown));
        baseAlpha = mix(baseAlpha, 0.96, fresnel * 0.65);
        float waterAlpha = clamp(max(baseAlpha, totalFoam * 0.96), 0.46, 1.0);

        // Underwater Snell's window & caustics when camera plunges beneath surface
        if (uUnderwater > 0.01) {
          float angleUp = max(dot(V, vec3(0.0, 1.0, 0.0)), 0.0);
          float snell = smoothstep(0.55, 0.88, angleUp);
          float caustic = smoothstep(0.52, 0.82, fbm4(vWorldPos.xz * 0.25 + vec2(uTime * 0.35, -uTime * 0.28)));
          vec3 snellColor = mix(uSkyHorizon * 0.55, vec3(0.18, 0.54, 0.68), 0.35);
          vec3 underCol = mix(vec3(0.02, 0.14, 0.22), snellColor, snell * 0.75) + vec3(0.14, 0.36, 0.45) * caustic * 0.4;
          oceanColor = mix(oceanColor, underCol, uUnderwater);
          waterAlpha = mix(waterAlpha, mix(0.84, 0.26, snell), uUnderwater);
        }

        // Exponential distance fog matching Three.js FogExp2
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
        vec3 finalCol = mix(oceanColor, uFogColor, clamp(fogFactor, 0.0, 1.0));
        waterAlpha = mix(waterAlpha, 1.0, clamp(fogFactor * 1.15, 0.0, 1.0));

        gl_FragColor = vec4(finalCol, waterAlpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const oceanMesh = new THREE.Mesh(oceanGeo, oceanMat);
  oceanMesh.name = 'atlantic_ocean';
  oceanMesh.frustumCulled = false;
  oceanMesh.renderOrder = 1;
  scene.add(oceanMesh);

  // =========================================================================
  // 2. RAYLEIGH / MIE ATMOSPHERIC SKY DOME + FBM CLOUD STRATA + MILKY WAY
  // =========================================================================
  const skyGeo = new THREE.SphereGeometry(1450, 36, 24);
  const skyMat = new THREE.ShaderMaterial({
    uniforms: skyUniforms,
    side: THREE.BackSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uNightMix;
      uniform vec3 uKeyDir;
      uniform vec3 uHorizonColor;
      uniform vec3 uZenithColor;
      uniform vec3 uSunColor;
      varying vec3 vDir;

      float hash21(vec2 p) {
        p = fract(p * vec2(234.34, 435.345));
        p += dot(p, p + 34.23);
        return fract(p.x * p.y);
      }

      float noise2D(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash21(i), hash21(i + vec2(1.0, 0.0)), u.x),
          mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }

      float fbm4(vec2 p) {
        float v = 0.0;
        float a = 0.5;
        mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
        for (int i = 0; i < 4; i++) {
          v += a * noise2D(p);
          p = r * p * 2.04 + vec2(13.7, 29.3);
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        vec3 skyCol = mix(uHorizonColor, uZenithColor, pow(h, 0.48));

        // Mie atmospheric sun/moon glow & soft solar disc (glare-controlled)
        vec3 L = normalize(uKeyDir);
        float cosTheta = max(dot(d, L), 0.0);
        float mieGlow = pow(cosTheta, 8.0) * 0.24 + pow(cosTheta, 64.0) * 0.22;
        float sunDisc = smoothstep(0.9988, 0.9995, cosTheta) * (1.0 - smoothstep(0.42, 0.62, uNightMix));
        skyCol += uSunColor * (mieGlow + sunDisc * 0.85);

        // Subtle Arctic Milky Way band at dusk/night
        float mwBand = exp(-pow((d.y * 0.72 + d.x * 0.45 - 0.12) * 3.8, 2.0));
        float mwTex = fbm4(d.xz * 7.5 + vec2(2.3, -1.7));
        skyCol += vec3(0.05, 0.09, 0.16) * mwBand * mwTex * smoothstep(0.35, 0.92, uNightMix);

        // High-altitude drifting Atlantic FBM cloud strata above horizon
        if (d.y > 0.015) {
          vec2 cloudUv = d.xz / (d.y + 0.14) * 1.45 + vec2(uTime * 0.0045, uTime * 0.0022);
          float cDens = fbm4(cloudUv);
          float cDetail = fbm4(cloudUv * 2.4 - vec2(uTime * 0.006, 0.0));
          float cloudMask = smoothstep(0.44, 0.78, cDens * 0.72 + cDetail * 0.28) * smoothstep(0.015, 0.14, d.y);

          float sunsetW = sin(uNightMix * 3.14159265);
          vec3 cloudLit = mix(vec3(0.95, 0.97, 1.0), vec3(0.14, 0.21, 0.33), uNightMix);
          cloudLit = mix(cloudLit, vec3(0.98, 0.66, 0.46), sunsetW * 0.75);
          vec3 cloudShadow = mix(vec3(0.62, 0.71, 0.82), vec3(0.05, 0.09, 0.16), uNightMix);

          float rim = pow(cosTheta, 5.0) * 0.45 + (1.0 - cDetail) * 0.35;
          vec3 cloudCol = mix(cloudShadow, cloudLit, clamp(rim + 0.35, 0.0, 1.0));
          skyCol = mix(skyCol, cloudCol, cloudMask * mix(0.62, 0.34, uNightMix));
        }

        // Deep North Atlantic oceanic teal-to-abyss nadir below horizon for translucent water views
        if (d.y < 0.0) {
          vec3 oceanMid = mix(vec3(0.022, 0.155, 0.225), vec3(0.007, 0.036, 0.068), uNightMix);
          vec3 oceanAbyss = mix(vec3(0.006, 0.048, 0.088), vec3(0.002, 0.010, 0.024), uNightMix);
          float depthT = smoothstep(0.0, -0.55, d.y);
          float rayBand = fbm4(d.xz * 4.5 + vec2(uTime * 0.04, -uTime * 0.03)) * (1.0 - depthT) * (1.0 - uNightMix * 0.65);
          vec3 nadirCol = mix(oceanMid, oceanAbyss, depthT) + vec3(0.04, 0.16, 0.22) * rayBand * 0.45;
          skyCol = mix(uHorizonColor * 0.78, nadirCol, smoothstep(0.0, -0.09, d.y));
        }

        gl_FragColor = vec4(skyCol, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  skyMesh.name = 'atlantic_sky';
  skyMesh.frustumCulled = false;
  skyMesh.renderOrder = -2;
  scene.add(skyMesh);

  // =========================================================================
  // 3. CRISP MOON + HALO & 2,200 NIGHT STARS
  // =========================================================================
  const moonGeo = new THREE.SphereGeometry(18, 24, 18);
  const moonMat = new THREE.MeshBasicMaterial({
    color: 0xeaf2ff,
    transparent: true,
    opacity: 0.0,
    fog: false,
  });
  const moonMesh = new THREE.Mesh(moonGeo, moonMat);
  moonMesh.name = 'arctic_moon';
  moonMesh.frustumCulled = false;
  scene.add(moonMesh);

  const starCount = isSoftwareGl ? 1000 : 2200;
  const starPos = new Float32Array(starCount * 3);
  const starCol = new Float32Array(starCount * 3);
  const starSizes = new Float32Array(starCount);
  const starPhases = new Float32Array(starCount);
  const tmpColor = new THREE.Color();

  for (let i = 0; i < starCount; i++) {
    const u = Math.random();
    const v = Math.random();
    const theta = u * Math.PI * 2;
    const phi = Math.acos(0.04 + v * 0.96);
    const r = 1320;
    starPos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.cos(phi);
    starPos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const tint = Math.random();
    if (tint < 0.25) tmpColor.setHex(0xbcd9ff);
    else if (tint < 0.45) tmpColor.setHex(0xffe6c2);
    else tmpColor.setHex(0xf4f8ff);

    starCol[i * 3] = tmpColor.r;
    starCol[i * 3 + 1] = tmpColor.g;
    starCol[i * 3 + 2] = tmpColor.b;
    starSizes[i] = 1.4 + Math.pow(Math.random(), 2.2) * 3.4;
    starPhases[i] = Math.random() * Math.PI * 2;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color', new THREE.BufferAttribute(starCol, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSizes, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhases, 1));

  const starShaderMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute float aSize;
      attribute float aPhase;
      attribute vec3 color;
      uniform float uTime;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vColor = color;
        vTwinkle = 0.72 + 0.28 * sin(uTime * 1.8 + aPhase);
        vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (900.0 / max(-mvPos.z, 100.0));
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uOpacity;
      varying vec3 vColor;
      varying float vTwinkle;
      void main() {
        vec2 c = gl_PointCoord - vec2(0.5);
        float d = length(c);
        if (d > 0.5) discard;
        float core = exp(-d * d * 24.0);
        gl_FragColor = vec4(vColor * vTwinkle, core * uOpacity);
      }
    `,
  });

  const starPoints = new THREE.Points(starGeo, starShaderMat);
  starPoints.name = 'night_starfield';
  starPoints.frustumCulled = false;
  starPoints.renderOrder = -1;
  scene.add(starPoints);

  // =========================================================================
  // 4. ARCTIC MARINE SNOW / MIST FLAKES (InstancedMesh)
  // =========================================================================
  const snowCount = isSoftwareGl ? 60 : 120;
  const snowGeo = new THREE.OctahedronGeometry(0.11, 0);
  const snowMat = new THREE.MeshBasicMaterial({
    color: 0xb6daf5,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const snowSlot = createInstancedSlot('marine_snow', snowGeo, snowMat, snowCount, false, scene);
  const snowSeeds: Array<{ x: number; y: number; z: number; sp: number; phase: number }> = [];
  for (let i = 0; i < snowCount; i++) {
    snowSeeds.push({
      x: (Math.random() - 0.5) * 220,
      y: Math.random() * 44,
      z: (Math.random() - 0.5) * 260,
      sp: 0.5 + Math.random() * 1.1,
      phase: Math.random() * Math.PI * 2,
    });
  }

  const skyHorizDay = new THREE.Color(0x9ec4db);
  const skyZenDay = new THREE.Color(0x1f5c96);
  const skyHorizNight = new THREE.Color(0x091628);
  const skyZenNight = new THREE.Color(0x020712);
  const sunsetHoriz = new THREE.Color(0xb05d3f);
  const sunsetZen = new THREE.Color(0x28365c);
  const sunDay = new THREE.Color(0xfff1d6);
  const sunMoon = new THREE.Color(0xcde4ff);
  const sunSunset = new THREE.Color(0xff944d);

  const update = (
    time: number,
    shipX: number,
    shipZ: number,
    headingRad: number,
    speedKnots: number,
    nightMix: number,
    hullActive = 1.0,
    wakeActive = 1.0,
  ) => {
    const n = MathUtils.clamp(nightMix, 0, 1);
    const sunsetW = Math.sin(n * Math.PI);

    oceanUniforms.uTime.value = time;
    oceanUniforms.uWorldOffset.value.set(shipX, shipZ);
    oceanMesh.position.set(shipX, 0, shipZ);

    oceanUniforms.uShipPos.value.set(shipX, shipZ);
    oceanUniforms.uShipDir.value.set(Math.sin(headingRad), -Math.cos(headingRad));
    oceanUniforms.uShipSpeed.value = speedKnots;
    oceanUniforms.uNightMix.value = n;
    oceanUniforms.uHullCutout.value = hullActive;
    oceanUniforms.uWakeActive.value = wakeActive;

    skyUniforms.uTime.value = time;
    skyUniforms.uNightMix.value = n;

    // Sky colors
    skyUniforms.uHorizonColor.value.copy(skyHorizDay).lerp(skyHorizNight, MathUtils.smoothstep(n, 0.15, 0.9));
    skyUniforms.uZenithColor.value.copy(skyZenDay).lerp(skyZenNight, MathUtils.smoothstep(n, 0.15, 0.9));
    if (sunsetW > 0.01) {
      skyUniforms.uHorizonColor.value.lerp(sunsetHoriz, sunsetW * 0.72);
      skyUniforms.uZenithColor.value.lerp(sunsetZen, sunsetW * 0.55);
    }

    skyUniforms.uSunColor.value.copy(sunDay).lerp(sunMoon, n);
    if (sunsetW > 0.01) {
      skyUniforms.uSunColor.value.lerp(sunSunset, sunsetW * 0.78);
    }

    oceanUniforms.uSkyHorizon.value.copy(skyUniforms.uHorizonColor.value);
    oceanUniforms.uSkyZenith.value.copy(skyUniforms.uZenithColor.value);
    oceanUniforms.uKeyColor.value.copy(skyUniforms.uSunColor.value);
    oceanUniforms.uFogColor.value.copy(skyUniforms.uHorizonColor.value);
    oceanUniforms.uFogDensity.value = MathUtils.lerp(0.00095, 0.0021, n);

    const sunArcX = MathUtils.lerp(95, -145, Math.min(1, n / 0.65));
    const keyOffX = MathUtils.lerp(sunArcX, 115, MathUtils.smoothstep(n, 0.56, 1.0));
    const sunSetH = MathUtils.lerp(175, 24, MathUtils.smoothstep(n, 0.08, 0.56));
    const keyH = MathUtils.lerp(sunSetH, 145, MathUtils.smoothstep(n, 0.56, 0.95));
    skyUniforms.uKeyDir.value.set(keyOffX, keyH, -245).normalize();
    oceanUniforms.uKeyDir.value.copy(skyUniforms.uKeyDir.value);

    skyMesh.position.set(shipX, 0, shipZ);
    starPoints.position.set(shipX, 0, shipZ);
    starPoints.rotation.y = time * 0.0018;
    starShaderMat.uniforms.uTime.value = time;
    starShaderMat.uniforms.uOpacity.value = MathUtils.smoothstep(n, 0.32, 0.86);

    const moonAlpha = MathUtils.smoothstep(n, 0.52, 0.94);
    moonMesh.visible = moonAlpha > 0.02;
    moonMat.opacity = moonAlpha * 0.92;
    moonMesh.position.set(
      shipX + skyUniforms.uKeyDir.value.x * 1120,
      Math.max(40, skyUniforms.uKeyDir.value.y * 1120),
      shipZ + skyUniforms.uKeyDir.value.z * 1120,
    );

    const showSnow = n > 0.25;
    snowSlot.mesh.visible = showSnow;
    if (showSnow) {
      snowMat.opacity = 0.45 * MathUtils.smoothstep(n, 0.25, 0.75);
      for (let i = 0; i < snowCount; i++) {
        const s = snowSeeds[i];
        const sy = ((s.y - time * s.sp * 1.7) % 44 + 44) % 44;
        const sx = shipX + s.x + Math.sin(time * 0.65 + s.phase) * 2.5;
        const sz = shipZ + s.z + Math.cos(time * 0.55 + s.phase) * 2.5;
        writeInstanceMatrix(snowSlot, i, sx, sy, sz, 0, 0, 0, 1, 1, 1);
      }
      commitInstanceMatrices(snowSlot, snowCount);
    }
  };

  const setHullDimensions = (bowZ: number, sternZ: number, halfBeam: number) => {
    oceanUniforms.uHullZRange.value.set(bowZ + 4, sternZ - 9);
    oceanUniforms.uHullHalfBeam.value = Math.max(10.0, halfBeam - 0.65);
  };

  const updateCameraView = (cameraPos: THREE.Vector3, underwaterMix: number) => {
    oceanUniforms.uCamPos.value.copy(cameraPos);
    oceanUniforms.uUnderwater.value = MathUtils.clamp(underwaterMix, 0, 1);
  };

  const dispose = () => {
    oceanGeo.dispose();
    oceanMat.dispose();
    skyGeo.dispose();
    skyMat.dispose();
    moonGeo.dispose();
    moonMat.dispose();
    starGeo.dispose();
    starShaderMat.dispose();
    snowGeo.dispose();
    snowMat.dispose();
    scene.remove(oceanMesh, skyMesh, moonMesh, starPoints, snowSlot.mesh);
  };

  return {
    oceanMesh,
    skyMesh,
    moonMesh,
    starPoints,
    snowMesh: snowSlot.mesh,
    update,
    setHullDimensions,
    updateCameraView,
    dispose,
  };
}

interface ActiveParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  baseScale: number;
  gravity: number;
  colorHex: number;
}

/**
 * Zero-GC InstancedMesh particle pool for bow spray, steam plumes, hull breakup sparks,
 * distress flares, ice impact shards, and underwater bubbles.
 */
export class ParticlePool {
  private readonly scene: THREE.Scene;
  private readonly maxCount: number;
  private readonly geo: THREE.IcosahedronGeometry;
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly slot: ReturnType<typeof createInstancedSlot>;
  private readonly active: ActiveParticle[] = [];

  constructor(scene: THREE.Scene, maxCount = 320) {
    this.scene = scene;
    this.maxCount = maxCount;
    this.geo = new THREE.IcosahedronGeometry(0.5, 0);
    this.mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    this.slot = createInstancedSlot('particle_pool', this.geo, this.mat, maxCount, true, scene);
  }

  public emit(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    baseScale: number,
    life: number,
    gravity: number,
    colorHex: number,
  ): void {
    if (this.active.length >= this.maxCount) {
      this.active.shift();
    }
    this.active.push({
      x,
      y,
      z,
      vx,
      vy,
      vz,
      age: 0,
      life: Math.max(0.1, life),
      baseScale,
      gravity,
      colorHex,
    });
  }

  public burstIceImpact(x: number, y: number, z: number, count = 28): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 3.5 + Math.random() * 11;
      this.emit(
        x + (Math.random() - 0.5) * 3,
        y + Math.random() * 2,
        z + (Math.random() - 0.5) * 3,
        Math.cos(ang) * spd,
        4.0 + Math.random() * 8.5,
        Math.sin(ang) * spd,
        0.55 + Math.random() * 0.95,
        0.75 + Math.random() * 0.55,
        14.0,
        i % 3 === 0 ? 0xe0f2fe : 0xbbe5ff,
      );
    }
  }

  public update(dt: number): void {
    const tmpColor = new THREE.Color();
    for (let i = this.active.length - 1; i >= 0; i--) {
      const p = this.active[i];
      p.age += dt;
      if (p.age >= p.life) {
        this.active.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
    }

    const n = Math.min(this.maxCount, this.active.length);
    for (let i = 0; i < n; i++) {
      const p = this.active[i];
      const u = p.age / p.life;
      const sc = Math.max(0.01, p.baseScale * (1 - u * 0.65) * Math.min(1, u * 6 + 0.2));
      writeInstanceMatrix(this.slot, i, p.x, p.y, p.z, p.age * 1.4, p.age * 1.1, 0, sc, sc, sc);
      tmpColor.setHex(p.colorHex, THREE.SRGBColorSpace);
      this.slot.mesh.setColorAt(i, tmpColor);
    }
    commitInstanceMatrices(this.slot, n);
    if (this.slot.mesh.instanceColor) {
      this.slot.mesh.instanceColor.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
    this.scene.remove(this.slot.mesh);
  }
}

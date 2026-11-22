import * as THREE from 'three';

export interface ProceduralTextureSet {
  teakDeckAlbedo: THREE.CanvasTexture;
  teakDeckNormal: THREE.CanvasTexture;
  teakDeckRoughness: THREE.CanvasTexture;
  steelHullAlbedo: THREE.CanvasTexture;
  steelHullNormal: THREE.CanvasTexture;
  steelHullRoughness: THREE.CanvasTexture;
  buffFunnelAlbedo: THREE.CanvasTexture;
  buffFunnelNormal: THREE.CanvasTexture;
  buffFunnelRoughness: THREE.CanvasTexture;
  mahoganyAlbedo: THREE.CanvasTexture;
  mahoganyRoughness: THREE.CanvasTexture;
  interiorMarbleAlbedo: THREE.CanvasTexture;
  interiorMarbleRoughness: THREE.CanvasTexture;
  interiorPanelAlbedo: THREE.CanvasTexture;
  iceAlbedo: THREE.CanvasTexture;
  iceNormal: THREE.CanvasTexture;
  iceRoughness: THREE.CanvasTexture;
  hullNameplateBow: THREE.CanvasTexture;
  hullNameplateStern: THREE.CanvasTexture;
  hullNameplateBritannicBow: THREE.CanvasTexture;
  hullNameplateBritannicStern: THREE.CanvasTexture;
  hullNameplateLusitaniaBow: THREE.CanvasTexture;
  hullNameplateLusitaniaStern: THREE.CanvasTexture;
  hullNameplateConcordiaBow: THREE.CanvasTexture;
  hullNameplateConcordiaStern: THREE.CanvasTexture;
  hullNameplateCarpathia: THREE.CanvasTexture;
  whiteStarPennant: THREE.CanvasTexture;
  hospitalRedCrossFlag: THREE.CanvasTexture;
  cunardBurgee: THREE.CanvasTexture;
  costaFlag: THREE.CanvasTexture;
  italianEnsignFlag: THREE.CanvasTexture;
  redCrossEmblem: THREE.CanvasTexture;
  redEnsignFlag: THREE.CanvasTexture;
  cunardFunnelAlbedo: THREE.CanvasTexture;
  costaFunnelAlbedo: THREE.CanvasTexture;
  compassDial: THREE.CanvasTexture;
  telegraphDial: THREE.CanvasTexture;
  telegraphDialCunard: THREE.CanvasTexture;
  telegraphDialCosta: THREE.CanvasTexture;
  clinometerDial: THREE.CanvasTexture;
  dispose: () => void;
}

function makeCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  return [canvas, ctx];
}

function seededNoise(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function heightMapToNormalTexture(
  heightData: Float32Array,
  size: number,
  strength: number,
  aniso: number,
): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(size, size);
  const img = ctx.createImageData(size, size);
  const data = img.data;

  for (let y = 0; y < size; y++) {
    const ym = (y - 1 + size) % size;
    const yp = (y + 1) % size;
    for (let x = 0; x < size; x++) {
      const xm = (x - 1 + size) % size;
      const xp = (x + 1) % size;
      const hL = heightData[y * size + xm];
      const hR = heightData[y * size + xp];
      const hU = heightData[ym * size + x];
      const hD = heightData[yp * size + x];

      const dx = (hL - hR) * strength;
      const dy = (hU - hD) * strength;
      const dz = 1.0;
      const invLen = 1.0 / Math.hypot(dx, dy, dz);

      const idx = (y * size + x) * 4;
      data[idx] = Math.round((dx * invLen * 0.5 + 0.5) * 255);
      data[idx + 1] = Math.round((dy * invLen * 0.5 + 0.5) * 255);
      data[idx + 2] = Math.round((dz * invLen * 0.5 + 0.5) * 255);
      data[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.NoColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

function createTeakTextures(aniso: number) {
  const size = 1024;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);
  const height = new Float32Array(size * size);

  const plankCount = 16;
  const plankW = size / plankCount;

  aCtx.fillStyle = '#0d0b09';
  aCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#d8d8d8';
  rCtx.fillRect(0, 0, size, size);

  for (let p = 0; p < plankCount; p++) {
    const px = p * plankW;
    const toneShift = (seededNoise(p, 3.1) - 0.5) * 24;
    const rBase = Math.round(146 + toneShift);
    const gBase = Math.round(112 + toneShift * 0.85);
    const bBase = Math.round(74 + toneShift * 0.65);

    aCtx.fillStyle = `rgb(${rBase},${gBase},${bBase})`;
    aCtx.fillRect(px + 3, 0, plankW - 6, size);

    const roughVal = Math.round(188 + (seededNoise(p, 9.7) - 0.5) * 32);
    rCtx.fillStyle = `rgb(${roughVal},${roughVal},${roughVal})`;
    rCtx.fillRect(px + 3, 0, plankW - 6, size);

    // Fine Burma teak grain fibers & cathedral streaks
    for (let g = 0; g < 28; g++) {
      const gx = px + 4 + seededNoise(p * 17 + g, 1.3) * (plankW - 9);
      const dark = seededNoise(p, g * 2.1) > 0.44;
      aCtx.strokeStyle = dark ? 'rgba(54, 34, 18, 0.24)' : 'rgba(196, 162, 118, 0.16)';
      aCtx.lineWidth = 1.1 + seededNoise(g, p) * 1.4;
      aCtx.beginPath();
      aCtx.moveTo(gx, 0);
      aCtx.bezierCurveTo(
        gx + (seededNoise(g, 4) - 0.5) * 6,
        size * 0.33,
        gx + (seededNoise(g, 8) - 0.5) * 6,
        size * 0.66,
        gx,
        size,
      );
      aCtx.stroke();
    }

    // Pitch-black oakum caulking & recessed plank joints + bronze dowels
    const buttY = Math.round(((p * 37) % 100) * 0.01 * size);
    aCtx.fillStyle = '#0e0c0a';
    aCtx.fillRect(px, 0, 3, size);
    aCtx.fillRect(px + plankW - 3, 0, 3, size);
    aCtx.fillRect(px, buttY, plankW, 3);

    rCtx.fillStyle = '#f2f2f2';
    rCtx.fillRect(px, 0, 3, size);
    rCtx.fillRect(px + plankW - 3, 0, 3, size);

    for (const dy of [buttY - 12, buttY + 14]) {
      const yy = (dy + size) % size;
      aCtx.fillStyle = 'rgba(42, 28, 16, 0.72)';
      aCtx.beginPath();
      aCtx.arc(px + plankW * 0.28, yy, 2.2, 0, Math.PI * 2);
      aCtx.arc(px + plankW * 0.72, yy, 2.2, 0, Math.PI * 2);
      aCtx.fill();
    }

    for (let y = 0; y < size; y++) {
      for (let x = Math.floor(px); x < Math.floor(px + plankW); x++) {
        const localX = x - px;
        const isSeam = localX < 3 || localX >= plankW - 3 || Math.abs(y - buttY) <= 1.5;
        const grain = Math.sin(localX * 0.48 + Math.sin(y * 0.02 + p) * 2.2) * 0.04;
        height[y * size + x] = isSeam ? 0.06 : 0.72 + grain + seededNoise(x * 0.2, y * 0.06) * 0.06;
      }
    }
  }

  const teakDeckAlbedo = new THREE.CanvasTexture(albedoC);
  teakDeckAlbedo.colorSpace = THREE.SRGBColorSpace;
  teakDeckAlbedo.wrapS = THREE.RepeatWrapping;
  teakDeckAlbedo.wrapT = THREE.RepeatWrapping;
  teakDeckAlbedo.anisotropy = aniso;

  const teakDeckRoughness = new THREE.CanvasTexture(roughC);
  teakDeckRoughness.colorSpace = THREE.NoColorSpace;
  teakDeckRoughness.wrapS = THREE.RepeatWrapping;
  teakDeckRoughness.wrapT = THREE.RepeatWrapping;
  teakDeckRoughness.anisotropy = aniso;

  const teakDeckNormal = heightMapToNormalTexture(height, size, 2.8, aniso);
  return { teakDeckAlbedo, teakDeckNormal, teakDeckRoughness };
}

function createSteelHullTextures(aniso: number) {
  const size = 1024;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);
  const height = new Float32Array(size * size);

  const strakeCount = 12;
  const strakeH = size / strakeCount;

  for (let s = 0; s < strakeCount; s++) {
    const sy = s * strakeH;
    const isOutStrake = s % 2 === 0;
    const plateShade = (seededNoise(s, 7.2) - 0.5) * 6;
    const baseR = Math.round((isOutStrake ? 20 : 17) + plateShade);
    const baseG = Math.round((isOutStrake ? 24 : 20) + plateShade);
    const baseB = Math.round((isOutStrake ? 30 : 25) + plateShade);

    // Subtle vertical strake gradient (plate curvature shadow near overlap)
    const grad = aCtx.createLinearGradient(0, sy, 0, sy + strakeH);
    grad.addColorStop(0, `rgb(${Math.max(8, baseR - 5)},${Math.max(10, baseG - 5)},${Math.max(14, baseB - 5)})`);
    grad.addColorStop(0.18, `rgb(${baseR},${baseG},${baseB})`);
    grad.addColorStop(0.88, `rgb(${baseR + 2},${baseG + 2},${baseB + 2})`);
    grad.addColorStop(1, `rgb(${Math.max(8, baseR - 4)},${Math.max(10, baseG - 4)},${Math.max(14, baseB - 4)})`);
    aCtx.fillStyle = grad;
    aCtx.fillRect(0, sy, size, strakeH);

    // Calibrated matte-satin marine hull enamel roughness (0.50 - 0.68 -> 128 - 174)
    const rVal = Math.round((isOutStrake ? 142 : 156) + (seededNoise(s, 11.4) - 0.5) * 14);
    rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
    rCtx.fillRect(0, sy, size, strakeH);

    // Staggered vertical plate butt joints
    for (let b = 0; b < 4; b++) {
      const bx = Math.round(((b * 256 + (s % 2) * 128) % size));
      aCtx.fillStyle = 'rgba(6, 9, 13, 0.72)';
      aCtx.fillRect(bx, sy, 3, strakeH);
      aCtx.fillStyle = 'rgba(72, 84, 98, 0.14)';
      aCtx.fillRect((bx + 3) % size, sy, 2, strakeH);

      // Vertical double rivet column along butt seam
      for (let ry = sy + 8; ry < sy + strakeH - 4; ry += 10) {
        aCtx.fillStyle = 'rgba(54, 62, 74, 0.34)';
        aCtx.beginPath();
        aCtx.arc((bx - 6 + size) % size, ry, 1.8, 0, Math.PI * 2);
        aCtx.arc((bx + 7) % size, ry, 1.8, 0, Math.PI * 2);
        aCtx.fill();
      }
    }

    // Horizontal double-rivet strake line + delicate Atlantic salt/rust weathering streaks
    aCtx.fillStyle = 'rgba(5, 8, 12, 0.78)';
    aCtx.fillRect(0, sy, size, 3);
    aCtx.fillStyle = 'rgba(64, 74, 88, 0.16)';
    aCtx.fillRect(0, sy + 3, size, 2);

    for (let rx = 8; rx < size; rx += 12) {
      aCtx.fillStyle = 'rgba(58, 68, 82, 0.32)';
      aCtx.beginPath();
      aCtx.arc(rx, sy + 7, 1.7, 0, Math.PI * 2);
      aCtx.arc(rx + 6, sy + 13, 1.5, 0, Math.PI * 2);
      aCtx.fill();
    }

    // Subtle salt-spray / scupper weathering streak
    for (let st = 0; st < 5; st++) {
      if (seededNoise(s * 7, st * 13) > 0.62) {
        const sx = seededNoise(s + st, 3.7) * size;
        const streakGrad = aCtx.createLinearGradient(sx, sy + 4, sx, sy + strakeH);
        streakGrad.addColorStop(0, 'rgba(92, 68, 48, 0.14)');
        streakGrad.addColorStop(0.5, 'rgba(130, 145, 160, 0.06)');
        streakGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
        aCtx.fillStyle = streakGrad;
        aCtx.fillRect(sx - 5, sy + 4, 10, strakeH - 4);
      }
    }
  }

  for (let y = 0; y < size; y++) {
    const s = Math.floor(y / strakeH);
    const ly = y - s * strakeH;
    const isOutStrake = s % 2 === 0;
    const plateBase = isOutStrake ? 0.62 : 0.48;
    const seamDip = ly < 3.5 ? -0.30 : ly < 6.0 ? 0.06 : 0;
    for (let x = 0; x < size; x++) {
      const bxMod = (x - (s % 2) * 128 + size) % 256;
      const buttDip = bxMod < 3 ? -0.26 : 0;
      let rivet = 0;
      if (ly >= 5 && ly <= 15 && (x % 12 < 4)) {
        const dx = (x % 12) - 1.5;
        const dy = (ly - 8);
        if (dx * dx + dy * dy < 3.5) rivet = 0.24;
      }
      const warp = Math.sin(x * 0.032 + s * 1.9) * 0.028;
      height[y * size + x] = plateBase + seamDip + buttDip + rivet + warp + (seededNoise(x * 0.4, y * 0.4) - 0.5) * 0.02;
    }
  }

  const steelHullAlbedo = new THREE.CanvasTexture(albedoC);
  steelHullAlbedo.colorSpace = THREE.SRGBColorSpace;
  steelHullAlbedo.wrapS = THREE.RepeatWrapping;
  steelHullAlbedo.wrapT = THREE.RepeatWrapping;
  steelHullAlbedo.anisotropy = aniso;

  const steelHullRoughness = new THREE.CanvasTexture(roughC);
  steelHullRoughness.colorSpace = THREE.NoColorSpace;
  steelHullRoughness.wrapS = THREE.RepeatWrapping;
  steelHullRoughness.wrapT = THREE.RepeatWrapping;
  steelHullRoughness.anisotropy = aniso;

  const steelHullNormal = heightMapToNormalTexture(height, size, 3.1, aniso);
  return { steelHullAlbedo, steelHullNormal, steelHullRoughness };
}

function createBuffFunnelTextures(aniso: number) {
  const size = 512;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);
  const height = new Float32Array(size * size);

  // Authentic White Star Line mineral buff + subtle top-to-bottom coal soot patina
  const baseGrad = aCtx.createLinearGradient(0, 0, 0, size);
  baseGrad.addColorStop(0, '#c2864d');
  baseGrad.addColorStop(0.18, '#d79e60');
  baseGrad.addColorStop(0.82, '#d59c5d');
  baseGrad.addColorStop(1, '#c48d53');
  aCtx.fillStyle = baseGrad;
  aCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#9e9e9e';
  rCtx.fillRect(0, 0, size, size);

  const bands = 8;
  const cols = 12;
  const bh = size / bands;
  const cw = size / cols;

  for (let b = 0; b < bands; b++) {
    const by = b * bh;
    aCtx.fillStyle = 'rgba(90, 56, 26, 0.20)';
    aCtx.fillRect(0, by, size, 2);
    for (let c = 0; c < cols; c++) {
      const cx = (c * cw + (b % 2) * cw * 0.5) % size;
      aCtx.fillStyle = 'rgba(95, 62, 32, 0.14)';
      aCtx.fillRect(cx, by, 1.5, bh);
      // Rivets along seams
      for (let rx = 6; rx < cw; rx += 10) {
        aCtx.fillStyle = 'rgba(78, 48, 20, 0.22)';
        aCtx.fillRect((cx + rx) % size, by + 3, 2, 2);
      }
    }
  }

  for (let y = 0; y < size; y++) {
    const ly = y % bh;
    const b = Math.floor(y / bh);
    for (let x = 0; x < size; x++) {
      const lx = (x - (b % 2) * (cw * 0.5) + size) % cw;
      const seam = ly < 2 || lx < 1.5 ? -0.18 : 0;
      height[y * size + x] = 0.6 + seam + (seededNoise(x * 0.25, y * 0.25) - 0.5) * 0.03;
    }
  }

  const buffFunnelAlbedo = new THREE.CanvasTexture(albedoC);
  buffFunnelAlbedo.colorSpace = THREE.SRGBColorSpace;
  buffFunnelAlbedo.wrapS = THREE.RepeatWrapping;
  buffFunnelAlbedo.wrapT = THREE.RepeatWrapping;
  buffFunnelAlbedo.anisotropy = aniso;

  const buffFunnelRoughness = new THREE.CanvasTexture(roughC);
  buffFunnelRoughness.colorSpace = THREE.NoColorSpace;
  buffFunnelRoughness.wrapS = THREE.RepeatWrapping;
  buffFunnelRoughness.wrapT = THREE.RepeatWrapping;
  buffFunnelRoughness.anisotropy = aniso;

  const buffFunnelNormal = heightMapToNormalTexture(height, size, 2.0, aniso);

  // Authentic Cunard Line Vermilion-Red funnel albedo (shares normal & roughness seam detail)
  const [cunardC, cCtx] = makeCanvas(size, size);
  const cGrad = cCtx.createLinearGradient(0, 0, 0, size);
  cGrad.addColorStop(0, '#a8251a');
  cGrad.addColorStop(0.18, '#c93323');
  cGrad.addColorStop(0.82, '#cf3827');
  cGrad.addColorStop(1, '#b2291b');
  cCtx.fillStyle = cGrad;
  cCtx.fillRect(0, 0, size, size);
  for (let b = 0; b < bands; b++) {
    const by = b * bh;
    cCtx.fillStyle = 'rgba(54, 12, 8, 0.24)';
    cCtx.fillRect(0, by, size, 2);
    for (let c = 0; c < cols; c++) {
      const cx = (c * cw + (b % 2) * cw * 0.5) % size;
      cCtx.fillStyle = 'rgba(60, 14, 10, 0.16)';
      cCtx.fillRect(cx, by, 1.5, bh);
      for (let rx = 6; rx < cw; rx += 10) {
        cCtx.fillStyle = 'rgba(48, 10, 6, 0.24)';
        cCtx.fillRect((cx + rx) % size, by + 3, 2, 2);
      }
    }
  }
  const cunardFunnelAlbedo = new THREE.CanvasTexture(cunardC);
  cunardFunnelAlbedo.colorSpace = THREE.SRGBColorSpace;
  cunardFunnelAlbedo.wrapS = THREE.RepeatWrapping;
  cunardFunnelAlbedo.wrapT = THREE.RepeatWrapping;
  cunardFunnelAlbedo.anisotropy = aniso;

  return { buffFunnelAlbedo, buffFunnelNormal, buffFunnelRoughness, cunardFunnelAlbedo };
}

function createMahoganyTextures(aniso: number) {
  const size = 512;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);

  const grad = aCtx.createLinearGradient(0, 0, size, 0);
  grad.addColorStop(0, '#5a2315');
  grad.addColorStop(0.3, '#6e2c1a');
  grad.addColorStop(0.6, '#521e12');
  grad.addColorStop(1, '#682918');
  aCtx.fillStyle = grad;
  aCtx.fillRect(0, 0, size, size);

  // Satin hand-rubbed varnish (roughness ~ 0.42 - 0.54 -> 108 - 138, glare-free)
  rCtx.fillStyle = '#767676';
  rCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 240; i++) {
    const y = (i / 240) * size;
    const alpha = 0.08 + seededNoise(i, 4.1) * 0.14;
    aCtx.strokeStyle = seededNoise(i, 8.2) > 0.45 ? `rgba(30, 9, 4, ${alpha})` : `rgba(128, 56, 30, ${alpha * 0.7})`;
    aCtx.lineWidth = 1.4 + seededNoise(i, 2.3) * 2.2;
    aCtx.beginPath();
    aCtx.moveTo(0, y);
    aCtx.bezierCurveTo(size * 0.3, y + Math.sin(i * 0.4) * 9, size * 0.7, y - Math.cos(i * 0.3) * 9, size, y);
    aCtx.stroke();

    const rVal = Math.round(108 + seededNoise(i, 5.1) * 32);
    rCtx.strokeStyle = `rgb(${rVal},${rVal},${rVal})`;
    rCtx.lineWidth = 2.0;
    rCtx.stroke();
  }

  aCtx.strokeStyle = 'rgba(24, 9, 4, 0.65)';
  aCtx.lineWidth = 4;
  aCtx.strokeRect(10, 10, size - 20, size - 20);
  aCtx.strokeStyle = 'rgba(155, 92, 48, 0.35)';
  aCtx.lineWidth = 2;
  aCtx.strokeRect(18, 18, size - 36, size - 36);

  const mahoganyAlbedo = new THREE.CanvasTexture(albedoC);
  mahoganyAlbedo.colorSpace = THREE.SRGBColorSpace;
  mahoganyAlbedo.wrapS = THREE.RepeatWrapping;
  mahoganyAlbedo.wrapT = THREE.RepeatWrapping;
  mahoganyAlbedo.anisotropy = aniso;

  const mahoganyRoughness = new THREE.CanvasTexture(roughC);
  mahoganyRoughness.colorSpace = THREE.NoColorSpace;
  mahoganyRoughness.wrapS = THREE.RepeatWrapping;
  mahoganyRoughness.wrapT = THREE.RepeatWrapping;
  mahoganyRoughness.anisotropy = aniso;

  return { mahoganyAlbedo, mahoganyRoughness };
}

function createIceTextures(aniso: number) {
  const size = 512;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);
  const height = new Float32Array(size * size);

  const grad = aCtx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, '#eef7fc');
  grad.addColorStop(0.5, '#d8ecf7');
  grad.addColorStop(1, '#c2e1f3');
  aCtx.fillStyle = grad;
  aCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = '#8e8e8e';
  rCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 65; i++) {
    const x1 = seededNoise(i, 1.2) * size;
    const y1 = seededNoise(i, 3.4) * size;
    const x2 = x1 + (seededNoise(i, 5.6) - 0.5) * 200;
    const y2 = y1 + (seededNoise(i, 7.8) - 0.5) * 200;
    aCtx.strokeStyle = i % 2 === 0 ? 'rgba(116, 178, 214, 0.28)' : 'rgba(255, 255, 255, 0.34)';
    aCtx.lineWidth = 1.5 + seededNoise(i, 9.1) * 5;
    aCtx.beginPath();
    aCtx.moveTo(x1, y1);
    aCtx.lineTo(x2, y2);
    aCtx.stroke();

    const rv = Math.round(70 + seededNoise(i, 2.7) * 90);
    rCtx.strokeStyle = `rgb(${rv},${rv},${rv})`;
    rCtx.lineWidth = 3;
    rCtx.stroke();
  }

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const strata = Math.sin(y * 0.09 + Math.sin(x * 0.04) * 2.5) * 0.16;
      const crag = Math.cos(x * 0.07 - y * 0.05) * 0.12;
      const micro = seededNoise(x * 0.25, y * 0.25) * 0.10;
      height[y * size + x] = 0.5 + strata + crag + micro;
    }
  }

  const iceAlbedo = new THREE.CanvasTexture(albedoC);
  iceAlbedo.colorSpace = THREE.SRGBColorSpace;
  iceAlbedo.wrapS = THREE.RepeatWrapping;
  iceAlbedo.wrapT = THREE.RepeatWrapping;
  iceAlbedo.anisotropy = aniso;

  const iceRoughness = new THREE.CanvasTexture(roughC);
  iceRoughness.colorSpace = THREE.NoColorSpace;
  iceRoughness.wrapS = THREE.RepeatWrapping;
  iceRoughness.wrapT = THREE.RepeatWrapping;
  iceRoughness.anisotropy = aniso;

  const iceNormal = heightMapToNormalTexture(height, size, 2.6, aniso);
  return { iceAlbedo, iceNormal, iceRoughness };
}

function createInteriorMarbleTextures(aniso: number) {
  const size = 512;
  const [albedoC, aCtx] = makeCanvas(size, size);
  const [roughC, rCtx] = makeCanvas(size, size);

  aCtx.fillStyle = '#e7dfd0';
  aCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = '#7e7e7e';
  rCtx.fillRect(0, 0, size, size);

  for (let t = 0; t < 4; t++) {
    for (let s = 0; s < 4; s++) {
      const tx = s * 128;
      const ty = t * 128;
      const isDark = (t + s) % 2 === 1;
      aCtx.fillStyle = isDark ? '#cfc2ac' : '#ece4d6';
      aCtx.fillRect(tx + 2, ty + 2, 124, 124);
      aCtx.strokeStyle = 'rgba(130, 114, 92, 0.35)';
      aCtx.lineWidth = 2;
      aCtx.strokeRect(tx + 1, ty + 1, 126, 126);

      for (let v = 0; v < 5; v++) {
        aCtx.strokeStyle = isDark ? 'rgba(92, 78, 60, 0.16)' : 'rgba(165, 148, 122, 0.18)';
        aCtx.lineWidth = 1.4;
        aCtx.beginPath();
        aCtx.moveTo(tx + 8, ty + seededNoise(t * 9 + v, s) * 120);
        aCtx.bezierCurveTo(
          tx + 44,
          ty + seededNoise(s * 7, v + 2) * 120,
          tx + 88,
          ty + seededNoise(v * 3, t + 5) * 120,
          tx + 120,
          ty + seededNoise(s + t, v * 4) * 120,
        );
        aCtx.stroke();
      }
    }
  }

  const interiorMarbleAlbedo = new THREE.CanvasTexture(albedoC);
  interiorMarbleAlbedo.colorSpace = THREE.SRGBColorSpace;
  interiorMarbleAlbedo.wrapS = THREE.RepeatWrapping;
  interiorMarbleAlbedo.wrapT = THREE.RepeatWrapping;
  interiorMarbleAlbedo.anisotropy = aniso;

  const interiorMarbleRoughness = new THREE.CanvasTexture(roughC);
  interiorMarbleRoughness.colorSpace = THREE.NoColorSpace;
  interiorMarbleRoughness.wrapS = THREE.RepeatWrapping;
  interiorMarbleRoughness.wrapT = THREE.RepeatWrapping;
  interiorMarbleRoughness.anisotropy = aniso;

  return { interiorMarbleAlbedo, interiorMarbleRoughness };
}

function createInteriorPanelTexture(aniso: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = makeCanvas(size, size);
  ctx.fillStyle = '#ddd3c0';
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 4; i++) {
    const px = i * 128 + 10;
    ctx.fillStyle = '#e7dfd0';
    ctx.fillRect(px, 16, 108, size - 32);
    ctx.strokeStyle = '#9c8667';
    ctx.lineWidth = 3;
    ctx.strokeRect(px, 16, 108, size - 32);
    ctx.strokeStyle = '#c4b193';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(px + 8, 24, 92, size - 48);
  }
  ctx.fillStyle = '#8b6e48';
  ctx.fillRect(0, 0, size, 16);
  ctx.fillRect(0, size - 16, size, 16);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = aniso;
  return tex;
}

function createNameplateTexture(primary: string, secondary: string | undefined, aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 256);
  ctx.clearRect(0, 0, 1024, 256);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const drawText = (txt: string, y: number, font: string, tracking: number) => {
    ctx.font = font;
    const chars = txt.split('');
    const widths = chars.map((c) => ctx.measureText(c).width);
    const totalW = widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
    let cx = 512 - totalW / 2;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const cw = widths[i];
      const x = cx + cw / 2;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
      ctx.fillText(ch, x + 2, y + 3);
      const grad = ctx.createLinearGradient(0, y - 34, 0, y + 34);
      grad.addColorStop(0, '#f8e19b');
      grad.addColorStop(0.45, '#deb452');
      grad.addColorStop(1, '#a67a22');
      ctx.fillStyle = grad;
      ctx.fillText(ch, x, y);
      cx += cw + tracking;
    }
  };

  if (secondary) {
    drawText(primary, 92, '700 80px "Cormorant Garamond", Georgia, serif', 16);
    drawText(secondary, 178, '700 50px "Cormorant Garamond", Georgia, serif', 13);
  } else {
    drawText(primary, 128, '700 94px "Cormorant Garamond", Georgia, serif', 20);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createWhiteStarPennantTexture(aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 256);
  ctx.clearRect(0, 0, 512, 256);
  ctx.fillStyle = '#c81e28';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(512, 54);
  ctx.lineTo(412, 128);
  ctx.lineTo(512, 202);
  ctx.lineTo(0, 256);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#f8fafc';
  const cx = 195;
  const cy = 128;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 48 : 19;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createRedCrossEmblemTexture(aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = '#f4f6f8';
  ctx.fillRect(0, 0, 512, 256);

  ctx.strokeStyle = 'rgba(30, 41, 59, 0.28)';
  ctx.lineWidth = 8;
  ctx.strokeRect(10, 10, 492, 236);

  ctx.fillStyle = '#b91c1c';
  const cx = 256;
  const cy = 128;
  const armW = 54;
  const span = 166;
  ctx.fillRect(cx - armW / 2, cy - span / 2, armW, span);
  ctx.fillRect(cx - span / 2, cy - armW / 2, span, armW);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createHospitalRedCrossFlagTexture(aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = '#f5f7f9';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = '#c81e1c';
  const cx = 256;
  const cy = 128;
  const armW = 52;
  const span = 168;
  ctx.fillRect(cx - armW / 2, cy - span / 2, armW, span);
  ctx.fillRect(cx - span / 2, cy - armW / 2, span, armW);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createCunardBurgeeTexture(aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 256);
  ctx.clearRect(0, 0, 512, 256);
  ctx.fillStyle = '#c81e28';
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(512, 42);
  ctx.lineTo(418, 128);
  ctx.lineTo(512, 214);
  ctx.lineTo(0, 256);
  ctx.closePath();
  ctx.fill();

  // Stylized gold Cunard lion rampant silhouette holding terrestrial globe
  ctx.fillStyle = '#f4d06f';
  const cx = 195;
  const cy = 132;
  ctx.beginPath();
  ctx.arc(cx + 38, cy - 10, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.fillStyle = '#f4d06f';
  ctx.beginPath();
  ctx.ellipse(cx - 10, cy + 4, 24, 38, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx - 16, cy - 38, 17, 0, Math.PI * 2);
  ctx.fill();
  // Crown + tail + forepaws reaching for globe
  ctx.fillRect(cx - 24, cy - 62, 16, 10);
  ctx.lineWidth = 10;
  ctx.strokeStyle = '#f4d06f';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy - 18);
  ctx.lineTo(cx + 22, cy - 14);
  ctx.moveTo(cx - 8, cy + 28);
  ctx.lineTo(cx - 32, cy + 62);
  ctx.moveTo(cx + 2, cy + 28);
  ctx.lineTo(cx + 16, cy + 62);
  ctx.moveTo(cx - 30, cy + 12);
  ctx.quadraticCurveTo(cx - 64, cy - 28, cx - 42, cy - 48);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createRedEnsignTexture(aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = '#b91c22';
  ctx.fillRect(0, 0, 512, 256);

  ctx.fillStyle = '#152c66';
  ctx.fillRect(0, 0, 224, 128);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(224, 128);
  ctx.moveTo(224, 0);
  ctx.lineTo(0, 128);
  ctx.stroke();

  ctx.strokeStyle = '#c81e24';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(224, 128);
  ctx.moveTo(224, 0);
  ctx.lineTo(0, 128);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(92, 0, 40, 128);
  ctx.fillRect(0, 46, 224, 36);
  ctx.fillStyle = '#c81e24';
  ctx.fillRect(100, 0, 24, 128);
  ctx.fillRect(0, 53, 224, 22);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createCostaFunnelTexture(aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512);
  ctx.fillStyle = '#f2c016';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle vertical panel seam lines
  ctx.strokeStyle = 'rgba(130, 96, 8, 0.22)';
  ctx.lineWidth = 2;
  for (let x = 0; x < 512; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, 512);
    ctx.stroke();
  }

  // Deep navy Costa Crociere top band & "C" logo emblems on port and starboard flanks
  ctx.fillStyle = '#073573';
  ctx.fillRect(0, 0, 512, 92);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 92, 512, 12);

  for (const cx of [128, 384]) {
    const cy = 285;
    ctx.fillStyle = '#073573';
    ctx.beginPath();
    ctx.arc(cx, cy, 86, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f2c016';
    ctx.beginPath();
    ctx.arc(cx, cy, 66, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#073573';
    ctx.beginPath();
    ctx.arc(cx + 6, cy, 46, 0.45, Math.PI * 2 - 0.45);
    ctx.lineTo(cx + 6, cy);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#f2c016';
    ctx.beginPath();
    ctx.arc(cx + 12, cy, 24, 0, Math.PI * 2);
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = aniso;
  return tex;
}

function createCostaFlagTexture(aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = '#f2c016';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#073573';
  ctx.fillRect(0, 0, 512, 42);
  ctx.fillRect(0, 214, 512, 42);
  ctx.beginPath();
  ctx.arc(256, 128, 62, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2c016';
  ctx.beginPath();
  ctx.arc(262, 128, 42, 0.48, Math.PI * 2 - 0.48);
  ctx.lineTo(262, 128);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createItalianEnsignTexture(aniso: number): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 256);
  ctx.fillStyle = '#009246';
  ctx.fillRect(0, 0, 171, 256);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(171, 0, 170, 256);
  ctx.fillStyle = '#ce2b37';
  ctx.fillRect(341, 0, 171, 256);

  // Maritime Republic shield accent in center white stripe
  ctx.fillStyle = '#0b3b82';
  ctx.fillRect(228, 92, 56, 72);
  ctx.strokeStyle = '#d4af37';
  ctx.lineWidth = 4;
  ctx.strokeRect(228, 92, 56, 72);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createCompassDialTexture(aniso: number): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = makeCanvas(size, size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = '#f2e8cf';
  ctx.beginPath();
  ctx.arc(cx, cy, cx - 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#201812';
  ctx.lineWidth = 6;
  ctx.stroke();

  for (let deg = 0; deg < 360; deg += 5) {
    const rad = ((deg - 90) * Math.PI) / 180;
    const isMajor = deg % 30 === 0;
    const isMid = deg % 15 === 0;
    const r0 = cx - 14;
    const r1 = isMajor ? cx - 42 : isMid ? cx - 30 : cx - 22;
    ctx.strokeStyle = isMajor ? '#181410' : '#504234';
    ctx.lineWidth = isMajor ? 4 : 2;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * r0, cy + Math.sin(rad) * r0);
    ctx.lineTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
    ctx.stroke();
  }

  ctx.fillStyle = '#991b1b';
  ctx.beginPath();
  ctx.moveTo(cx, cy - 135);
  ctx.lineTo(cx - 18, cy - 30);
  ctx.lineTo(cx + 18, cy - 30);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#18181b';
  ctx.beginPath();
  ctx.moveTo(cx, cy + 135);
  ctx.lineTo(cx - 18, cy + 30);
  ctx.lineTo(cx + 18, cy + 30);
  ctx.closePath();
  ctx.fill();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 44px Georgia, serif';
  ctx.fillStyle = '#991b1b';
  ctx.fillText('N', cx, cy - 165);
  ctx.fillStyle = '#181410';
  ctx.fillText('E', cx + 165, cy);
  ctx.fillText('S', cx, cy + 165);
  ctx.fillText('W', cx - 165, cy);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createTelegraphDialTexture(aniso: number, brandText = 'WHITE STAR'): THREE.CanvasTexture {
  const size = 512;
  const [canvas, ctx] = makeCanvas(size, size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = '#f8f2e4';
  ctx.beginPath();
  ctx.arc(cx, cy, cx - 6, 0, Math.PI * 2);
  ctx.fill();

  const segments = [
    { start: -130, end: -75, color: '#991b1b', label: 'ASTERN' },
    { start: -75, end: -35, color: '#1e293b', label: 'STOP' },
    { start: -35, end: 5, color: '#334155', label: 'SLOW' },
    { start: 5, end: 45, color: '#1d4ed8', label: 'HALF' },
    { start: 45, end: 90, color: '#0f172a', label: 'FULL' },
    { start: 90, end: 132, color: '#b45309', label: 'FLANK' },
  ];

  for (const s of segments) {
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, cx - 18, ((s.start - 90) * Math.PI) / 180, ((s.end - 90) * Math.PI) / 180);
    ctx.closePath();
    ctx.fillStyle = s.color;
    ctx.fill();
  }

  ctx.fillStyle = '#f8f2e4';
  ctx.beginPath();
  ctx.arc(cx, cy, cx - 105, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#9b7b38';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, cx - 18, 0, Math.PI * 2);
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '700 22px Georgia, serif';
  ctx.fillStyle = '#ffffff';
  for (const s of segments) {
    const mid = (((s.start + s.end) / 2 - 90) * Math.PI) / 180;
    const rx = cx + Math.cos(mid) * (cx - 60);
    const ry = cy + Math.sin(mid) * (cx - 60);
    ctx.save();
    ctx.translate(rx, ry);
    ctx.rotate(mid + Math.PI / 2);
    ctx.fillText(s.label, 0, 0);
    ctx.restore();
  }

  ctx.fillStyle = '#1f2937';
  ctx.font = '700 24px Georgia, serif';
  ctx.fillText(brandText, cx, cy + 72);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

function createClinometerDialTexture(aniso: number): THREE.CanvasTexture {
  const size = 256;
  const [canvas, ctx] = makeCanvas(size, size);
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = '#f4ebd4';
  ctx.beginPath();
  ctx.arc(cx, cy, cx - 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#292218';
  ctx.lineWidth = 4;
  ctx.stroke();

  for (let d = -30; d <= 30; d += 5) {
    const a = ((d + 90) * Math.PI) / 180;
    const r0 = cx - 12;
    const r1 = d % 10 === 0 ? cx - 34 : cx - 22;
    ctx.strokeStyle = Math.abs(d) >= 20 ? '#991b1b' : '#26201a';
    ctx.lineWidth = d % 10 === 0 ? 3 : 1.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
    ctx.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.stroke();
  }

  ctx.fillStyle = '#292218';
  ctx.textAlign = 'center';
  ctx.font = '700 18px Georgia, serif';
  ctx.fillText('LIST', cx, cy - 28);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  return tex;
}

export function createProceduralTextures(maxAnisotropy = 8): ProceduralTextureSet {
  const aniso = Math.min(8, Math.max(1, maxAnisotropy));
  const teak = createTeakTextures(aniso);
  const steel = createSteelHullTextures(aniso);
  const funnel = createBuffFunnelTextures(aniso);
  const mahogany = createMahoganyTextures(aniso);
  const marble = createInteriorMarbleTextures(aniso);
  const interiorPanelAlbedo = createInteriorPanelTexture(aniso);
  const ice = createIceTextures(aniso);
  const hullNameplateBow = createNameplateTexture('TITANIC', undefined, aniso);
  const hullNameplateStern = createNameplateTexture('TITANIC', 'LIVERPOOL', aniso);
  const hullNameplateBritannicBow = createNameplateTexture('BRITANNIC', undefined, aniso);
  const hullNameplateBritannicStern = createNameplateTexture('BRITANNIC', 'LIVERPOOL', aniso);
  const hullNameplateLusitaniaBow = createNameplateTexture('LUSITANIA', undefined, aniso);
  const hullNameplateLusitaniaStern = createNameplateTexture('LUSITANIA', 'LIVERPOOL', aniso);
  const hullNameplateConcordiaBow = createNameplateTexture('COSTA CONCORDIA', undefined, aniso);
  const hullNameplateConcordiaStern = createNameplateTexture('COSTA CONCORDIA', 'GENOVA', aniso);
  const hullNameplateCarpathia = createNameplateTexture('CARPATHIA', undefined, aniso);
  const whiteStarPennant = createWhiteStarPennantTexture(aniso);
  const hospitalRedCrossFlag = createHospitalRedCrossFlagTexture(aniso);
  const cunardBurgee = createCunardBurgeeTexture(aniso);
  const costaFlag = createCostaFlagTexture(aniso);
  const italianEnsignFlag = createItalianEnsignTexture(aniso);
  const redCrossEmblem = createRedCrossEmblemTexture(aniso);
  const redEnsignFlag = createRedEnsignTexture(aniso);
  const costaFunnelAlbedo = createCostaFunnelTexture(aniso);
  const compassDial = createCompassDialTexture(aniso);
  const telegraphDial = createTelegraphDialTexture(aniso, 'WHITE STAR');
  const telegraphDialCunard = createTelegraphDialTexture(aniso, 'CUNARD LINE');
  const telegraphDialCosta = createTelegraphDialTexture(aniso, 'COSTA CROCIERE');
  const clinometerDial = createClinometerDialTexture(aniso);

  const all: THREE.Texture[] = [
    teak.teakDeckAlbedo,
    teak.teakDeckNormal,
    teak.teakDeckRoughness,
    steel.steelHullAlbedo,
    steel.steelHullNormal,
    steel.steelHullRoughness,
    funnel.buffFunnelAlbedo,
    funnel.buffFunnelNormal,
    funnel.buffFunnelRoughness,
    funnel.cunardFunnelAlbedo,
    costaFunnelAlbedo,
    mahogany.mahoganyAlbedo,
    mahogany.mahoganyRoughness,
    marble.interiorMarbleAlbedo,
    marble.interiorMarbleRoughness,
    interiorPanelAlbedo,
    ice.iceAlbedo,
    ice.iceNormal,
    ice.iceRoughness,
    hullNameplateBow,
    hullNameplateStern,
    hullNameplateBritannicBow,
    hullNameplateBritannicStern,
    hullNameplateLusitaniaBow,
    hullNameplateLusitaniaStern,
    hullNameplateConcordiaBow,
    hullNameplateConcordiaStern,
    hullNameplateCarpathia,
    whiteStarPennant,
    hospitalRedCrossFlag,
    cunardBurgee,
    costaFlag,
    italianEnsignFlag,
    redCrossEmblem,
    redEnsignFlag,
    compassDial,
    telegraphDial,
    telegraphDialCunard,
    telegraphDialCosta,
    clinometerDial,
  ];

  return {
    ...teak,
    ...steel,
    ...funnel,
    ...mahogany,
    ...marble,
    interiorPanelAlbedo,
    ...ice,
    hullNameplateBow,
    hullNameplateStern,
    hullNameplateBritannicBow,
    hullNameplateBritannicStern,
    hullNameplateLusitaniaBow,
    hullNameplateLusitaniaStern,
    hullNameplateConcordiaBow,
    hullNameplateConcordiaStern,
    hullNameplateCarpathia,
    whiteStarPennant,
    hospitalRedCrossFlag,
    cunardBurgee,
    costaFlag,
    italianEnsignFlag,
    redCrossEmblem,
    redEnsignFlag,
    costaFunnelAlbedo,
    compassDial,
    telegraphDial,
    telegraphDialCunard,
    telegraphDialCosta,
    clinometerDial,
    dispose: () => {
      for (const t of all) t.dispose();
    },
  };
}

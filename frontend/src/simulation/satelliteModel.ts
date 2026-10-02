import * as THREE from 'three';

/**
 * Options for generating a high-fidelity 3D Real Satellite model
 */
export interface SatelliteModelOptions {
  /**
   * Reference bounding dimension / scale (default 1.0).
   * The model is normalized so that its visual wingspan/envelope matches this unit size.
   */
  size?: number;
  /**
   * Accent color for mission identification (0x0284c7 for primary LEO, 0x818cf8 for backup)
   */
  accentColor?: number;
  /**
   * Use gold multi-layer insulation (MLI) thermal foil on the main chassis (default true)
   */
  isGoldMLI?: boolean;
  /**
   * Rotation angle of the solar wings along the lateral pitch axis (degrees, default 0)
   */
  solarWingAngleDeg?: number;
  /**
   * Whether to include the FSOC Optical Communication Terminal payload (default true)
   */
  includeOpticalTurret?: boolean;
  /**
   * Whether to include the parabolic RF communications dish antenna (default true)
   */
  includeAntenna?: boolean;
  /**
   * Whether to include star tracker camera baffles (default true)
   */
  includeStarTrackers?: boolean;
  /**
   * Whether to include the chemical / electric propulsion thrusters (default true)
   */
  includeThrusters?: boolean;
}

// Cached procedural textures to avoid redundant GPU allocations across satellites
let sharedSolarTexture: THREE.CanvasTexture | null = null;
let sharedGoldMLITexture: THREE.CanvasTexture | null = null;
let sharedRadiatorTexture: THREE.CanvasTexture | null = null;
let sharedSolarBackingTexture: THREE.CanvasTexture | null = null;

/**
 * Procedural texture for space-grade multi-junction GaAs / silicon photovoltaic cells
 */
export const getSolarPanelTexture = (): THREE.CanvasTexture => {
  if (sharedSolarTexture) return sharedSolarTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Deep royal blue / navy photovoltaic silicon background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 256);
    bgGrad.addColorStop(0, '#0a1d3b');
    bgGrad.addColorStop(0.5, '#07162d');
    bgGrad.addColorStop(1, '#0a1d3b');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 512, 256);

    // Silicon solar wafer cell grid: 2 rows of 8 cells
    const cols = 8;
    const rows = 2;
    const cellW = (512 - 16) / cols;
    const cellH = (256 - 16) / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = 8 + c * cellW;
        const y = 8 + r * cellH;

        // Individual wafer cell background
        const cellGrad = ctx.createLinearGradient(x, y, x + cellW, y + cellH);
        cellGrad.addColorStop(0, '#0f294e');
        cellGrad.addColorStop(0.5, '#0a1e3a');
        cellGrad.addColorStop(1, '#143666');
        ctx.fillStyle = cellGrad;
        ctx.fillRect(x + 1.5, y + 1.5, cellW - 3, cellH - 3);

        // Thin silver/cyan metallic boundary
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 1.5, y + 1.5, cellW - 3, cellH - 3);

        // 3 horizontal metallic busbar collection lines per cell
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.65)';
        ctx.lineWidth = 0.8;
        for (let b = 1; b <= 3; b++) {
          const by = y + (b * cellH) / 4;
          ctx.beginPath();
          ctx.moveTo(x + 2, by);
          ctx.lineTo(x + cellW - 2, by);
          ctx.stroke();
        }

        // Micro-contact grid lines (vertical tick marks)
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)';
        ctx.lineWidth = 0.5;
        const subTicks = 6;
        for (let s = 1; s < subTicks; s++) {
          const sx = x + (s * cellW) / subTicks;
          ctx.beginPath();
          ctx.moveTo(sx, y + 2);
          ctx.lineTo(sx, y + cellH - 2);
          ctx.stroke();
        }
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  sharedSolarTexture = texture;
  return texture;
};

/**
 * Procedural texture for spacecraft Gold Multi-Layer Insulation (MLI) thermal blanket
 */
export const getGoldMLITexture = (): THREE.CanvasTexture => {
  if (sharedGoldMLITexture) return sharedGoldMLITexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Rich golden amber base
    ctx.fillStyle = '#d97706';
    ctx.fillRect(0, 0, 256, 256);

    // Quilted pillow/embossed insulation grid (32x32px pillow squares)
    const step = 32;
    for (let y = 0; y < 256; y += step) {
      for (let x = 0; x < 256; x += step) {
        // Quilted pillow highlight & shadow
        const pillowGrad = ctx.createRadialGradient(
          x + step / 2,
          y + step / 2,
          2,
          x + step / 2,
          y + step / 2,
          step * 0.7
        );
        pillowGrad.addColorStop(0, '#fef08a'); // central specular highlight
        pillowGrad.addColorStop(0.35, '#fbbf24');
        pillowGrad.addColorStop(0.75, '#d97706');
        pillowGrad.addColorStop(1, '#92400e'); // seam shadow
        ctx.fillStyle = pillowGrad;
        ctx.fillRect(x + 1, y + 1, step - 2, step - 2);

        // Seam stitch line
        ctx.strokeStyle = '#78350f';
        ctx.lineWidth = 1;
        ctx.strokeRect(x, y, step, step);

        // Center tie-down tuft / rivet point
        ctx.fillStyle = '#451a03';
        ctx.beginPath();
        ctx.arc(x + step / 2, y + step / 2, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  sharedGoldMLITexture = texture;
  return texture;
};

/**
 * Procedural texture for satellite thermal radiator plates
 */
export const getRadiatorTexture = (): THREE.CanvasTexture => {
  if (sharedRadiatorTexture) return sharedRadiatorTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Silver/white aerospace thermal paint
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(0, 0, 256, 256);

    // Parallel radiator cooling fins/louvers
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.2;
    for (let y = 8; y < 256; y += 8) {
      ctx.beginPath();
      ctx.moveTo(4, y);
      ctx.lineTo(252, y);
      ctx.stroke();
    }

    // Border framing
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, 252, 252);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  sharedRadiatorTexture = texture;
  return texture;
};

/**
 * Procedural texture for carbon-fiber / dark Kevlar backing on reverse side of solar panels
 */
export const getSolarBackingTexture = (): THREE.CanvasTexture => {
  if (sharedSolarBackingTexture) return sharedSolarBackingTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#1c1917';
    ctx.fillRect(0, 0, 64, 64);

    // Carbon fiber twill weave pattern
    ctx.fillStyle = '#292524';
    for (let y = 0; y < 64; y += 8) {
      for (let x = 0; x < 64; x += 8) {
        if ((x + y) % 16 === 0) {
          ctx.fillRect(x, y, 8, 8);
        }
      }
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(4, 4);
  sharedSolarBackingTexture = texture;
  return texture;
};

/**
 * Creates a high-fidelity 3D model of a real satellite.
 * Designed with authentic spacecraft components:
 * 1. Main Avionics Bus: Cuboid chassis with Gold Multi-Layer Insulation (MLI) thermal foil.
 * 2. Radiator Decks: Upper and lower silver/white radiator plates with thermal louvers.
 * 3. Dual Articulated Solar Array Wings: Two-panel wings on carbon-fiber trusses with deep navy photovoltaic cells.
 * 4. FSOC Optical Communication Terminal: Coarse-pointing 2-axis gimbal, optical telescope barrel, sun baffle, and sapphire anti-reflective lens.
 * 5. High-Gain RF Parabolic Antenna: Articulated communication dish with tripod feed horn.
 * 6. Attitude Determination Sensors: Dual conical star tracker camera baffles.
 * 7. Propulsion Deck: Central ion thruster nozzle with xenon plasma glow ring and 4 RCS thrusters.
 * 8. TT&C Communications: S-band omni whip antennas.
 */
export const createRealSatelliteModel = (options: SatelliteModelOptions = {}): THREE.Group => {
  const {
    size = 1.0,
    accentColor = 0x0284c7,
    isGoldMLI = true,
    solarWingAngleDeg = 0,
    includeOpticalTurret = true,
    includeAntenna = true,
    includeStarTrackers = true,
    includeThrusters = true,
  } = options;

  const root = new THREE.Group();
  root.name = 'RealSatellite3D';

  // Master model container (scaled to normalize dimensions)
  const satBody = new THREE.Group();
  satBody.name = 'SatelliteSubsystems';

  // ---------------------------------------------------------------------------
  // 1. Materials
  // ---------------------------------------------------------------------------
  const goldMliMat = new THREE.MeshStandardMaterial({
    map: isGoldMLI ? getGoldMLITexture() : undefined,
    color: isGoldMLI ? 0xffffff : 0xe2e8f0,
    roughness: isGoldMLI ? 0.32 : 0.35,
    metalness: isGoldMLI ? 0.85 : 0.4,
  });

  const radiatorMat = new THREE.MeshStandardMaterial({
    map: getRadiatorTexture(),
    roughness: 0.35,
    metalness: 0.35,
  });

  const darkTitaniumMat = new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.5,
    metalness: 0.75,
  });

  const carbonFiberMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.6,
    metalness: 0.4,
  });

  const accentMat = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.3,
    metalness: 0.5,
    emissive: accentColor,
    emissiveIntensity: 0.25,
  });

  const solarFrontMat = new THREE.MeshStandardMaterial({
    map: getSolarPanelTexture(),
    roughness: 0.18,
    metalness: 0.65,
  });

  const solarBackMat = new THREE.MeshStandardMaterial({
    map: getSolarBackingTexture(),
    roughness: 0.6,
    metalness: 0.3,
  });

  // ---------------------------------------------------------------------------
  // 2. Central Satellite Chassis / Bus
  // ---------------------------------------------------------------------------
  const busWidth = 0.48;   // X-axis (lateral)
  const busHeight = 0.44;  // Y-axis (zenith/nadir)
  const busDepth = 0.72;   // Z-axis (flight / boresight axis)

  // Main gold MLI insulated equipment body
  const busGeo = new THREE.BoxGeometry(busWidth, busHeight, busDepth);
  const busMesh = new THREE.Mesh(busGeo, goldMliMat);
  busMesh.name = 'MainBus';
  busMesh.castShadow = true;
  busMesh.receiveShadow = true;
  satBody.add(busMesh);

  // Top & Bottom thermal radiator plates
  const topRadiatorGeo = new THREE.BoxGeometry(busWidth * 0.96, 0.03, busDepth * 0.94);
  const topRadiator = new THREE.Mesh(topRadiatorGeo, radiatorMat);
  topRadiator.position.set(0, busHeight / 2 + 0.015, 0);
  satBody.add(topRadiator);

  const bottomRadiatorGeo = new THREE.BoxGeometry(busWidth * 0.96, 0.03, busDepth * 0.94);
  const bottomRadiator = new THREE.Mesh(bottomRadiatorGeo, radiatorMat);
  bottomRadiator.position.set(0, -busHeight / 2 - 0.015, 0);
  satBody.add(bottomRadiator);

  // Structural edge / corner reinforcement rails
  const railGeo = new THREE.BoxGeometry(0.024, busHeight + 0.02, 0.024);
  const railOffsets = [
    [-busWidth / 2, -busDepth / 2],
    [busWidth / 2, -busDepth / 2],
    [-busWidth / 2, busDepth / 2],
    [busWidth / 2, busDepth / 2],
  ];
  railOffsets.forEach(([rx, rz]) => {
    const rail = new THREE.Mesh(railGeo, darkTitaniumMat);
    rail.position.set(rx, 0, rz);
    satBody.add(rail);
  });

  // Spacecraft mission identity accent collar
  const bandGeo = new THREE.BoxGeometry(busWidth + 0.01, 0.04, busDepth + 0.01);
  const accentBand = new THREE.Mesh(bandGeo, accentMat);
  accentBand.position.set(0, 0, 0);
  satBody.add(accentBand);

  // ---------------------------------------------------------------------------
  // 3. Dual Articulated Solar Array Wings (Left & Right)
  // ---------------------------------------------------------------------------
  const wingsGroup = new THREE.Group();
  wingsGroup.name = 'SolarArrayWings';

  const wingBoomRadius = 0.018;
  const wingBoomLength = 0.18;
  const panelW = 0.48; // span of single panel
  const panelH = 0.014;
  const panelD = 0.36; // chord along Z
  const panelGap = 0.03;

  // Helper to build a multi-section solar wing
  const buildSolarWing = (isLeft: boolean) => {
    const wing = new THREE.Group();
    const dir = isLeft ? 1 : -1;

    // Solar Array Drive Mechanism (SADM) rotating yoke collar
    const collarGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.05, 16);
    const collar = new THREE.Mesh(collarGeo, darkTitaniumMat);
    collar.rotation.z = Math.PI / 2;
    collar.position.set((dir * busWidth) / 2 + dir * 0.025, 0, 0);
    wing.add(collar);

    // Carbon-fiber boom extension strut
    const boomGeo = new THREE.CylinderGeometry(wingBoomRadius, wingBoomRadius, wingBoomLength, 8);
    const boom = new THREE.Mesh(boomGeo, carbonFiberMat);
    boom.rotation.z = Math.PI / 2;
    boom.position.set(
      (dir * busWidth) / 2 + dir * 0.05 + (dir * wingBoomLength) / 2,
      0,
      0
    );
    wing.add(boom);

    // Panel sections (2 articulated panels per wing)
    const panelMaterials = [
      darkTitaniumMat, // +X side
      darkTitaniumMat, // -X side
      solarFrontMat,   // +Y (Photovoltaic cells facing Sun)
      solarBackMat,    // -Y (Kevlar backing)
      darkTitaniumMat, // +Z side
      darkTitaniumMat, // -Z side
    ];

    const startX = (dir * busWidth) / 2 + dir * 0.05 + dir * wingBoomLength;

    for (let p = 0; p < 2; p++) {
      const pCenterX = startX + dir * (panelW / 2 + p * (panelW + panelGap));
      const panelGeo = new THREE.BoxGeometry(panelW, panelH, panelD);
      const panelMesh = new THREE.Mesh(panelGeo, panelMaterials);
      panelMesh.position.set(pCenterX, 0, 0);
      panelMesh.castShadow = true;
      wing.add(panelMesh);

      // Hinged interconnect bracket between panels
      if (p === 0) {
        const hingeGeo = new THREE.BoxGeometry(0.03, 0.022, 0.08);
        const hinge = new THREE.Mesh(hingeGeo, darkTitaniumMat);
        hinge.position.set(startX + dir * (panelW + panelGap / 2), 0, 0);
        wing.add(hinge);
      }
    }

    return wing;
  };

  const leftWing = buildSolarWing(true);
  const rightWing = buildSolarWing(false);
  wingsGroup.add(leftWing);
  wingsGroup.add(rightWing);

  // Optional solar wing sun-tracking angle
  if (solarWingAngleDeg !== 0) {
    wingsGroup.rotation.x = THREE.MathUtils.degToRad(solarWingAngleDeg);
  }
  satBody.add(wingsGroup);

  // ---------------------------------------------------------------------------
  // 4. FSOC Optical Communication Terminal (PAT Coarse Alignment Optical Head)
  // ---------------------------------------------------------------------------
  // In Three.js lookAt convention, -Z points toward the target (Earth / Beacon).
  // The optical head is mounted on the nadir/forward deck (-Z face) pointing along -Z!
  if (includeOpticalTurret) {
    const turretGroup = new THREE.Group();
    turretGroup.name = 'FSOCOpticalTerminal';

    const forwardZ = -busDepth / 2;

    // Coarse gimbal pedestal / mounting base on forward deck
    const pedestalGeo = new THREE.CylinderGeometry(0.11, 0.13, 0.05, 16);
    const pedestal = new THREE.Mesh(pedestalGeo, darkTitaniumMat);
    pedestal.rotation.x = Math.PI / 2;
    pedestal.position.set(0, 0, forwardZ - 0.025);
    turretGroup.add(pedestal);

    // 2-axis gimbal fork arms
    const forkArmGeo = new THREE.BoxGeometry(0.025, 0.16, 0.09);
    const leftFork = new THREE.Mesh(forkArmGeo, darkTitaniumMat);
    leftFork.position.set(0.09, 0, forwardZ - 0.075);
    turretGroup.add(leftFork);

    const rightFork = new THREE.Mesh(forkArmGeo, darkTitaniumMat);
    rightFork.position.set(-0.09, 0, forwardZ - 0.075);
    turretGroup.add(rightFork);

    // Coarse optical telescope barrel (carbon-composite barrel aligned along -Z)
    const barrelGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.16, 16);
    const barrelMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.4,
      metalness: 0.8,
    });
    const barrel = new THREE.Mesh(barrelGeo, barrelMat);
    barrel.rotation.x = Math.PI / 2;
    barrel.position.set(0, 0, forwardZ - 0.14);
    turretGroup.add(barrel);

    // Optical sunshade hood / baffle
    const baffleGeo = new THREE.CylinderGeometry(0.082, 0.07, 0.06, 16);
    const baffleMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.6,
      metalness: 0.5,
    });
    const baffle = new THREE.Mesh(baffleGeo, baffleMat);
    baffle.rotation.x = Math.PI / 2;
    baffle.position.set(0, 0, forwardZ - 0.23);
    turretGroup.add(baffle);

    // Sapphire anti-reflective coated optical aperture lens (facing -Z)
    const lensGeo = new THREE.CircleGeometry(0.065, 24);
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0x00f0ff,
      roughness: 0.06,
      metalness: 0.95,
      emissive: 0x0284c7,
      emissiveIntensity: 0.45,
      side: THREE.DoubleSide,
    });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.position.set(0, 0, forwardZ - 0.255);
    turretGroup.add(lens);

    // Laser diode beacon emitter aperture (center pin-point lens)
    const laserPinGeo = new THREE.SphereGeometry(0.016, 12, 12);
    const laserPinMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      roughness: 0.1,
      metalness: 0.9,
      emissive: 0x10b981,
      emissiveIntensity: 0.9,
    });
    const laserPin = new THREE.Mesh(laserPinGeo, laserPinMat);
    laserPin.position.set(0, 0, forwardZ - 0.26);
    turretGroup.add(laserPin);

    satBody.add(turretGroup);
  }

  // ---------------------------------------------------------------------------
  // 5. High-Gain Parabolic RF Communication Dish Antenna
  // ---------------------------------------------------------------------------
  if (includeAntenna) {
    const antennaGroup = new THREE.Group();
    antennaGroup.name = 'ParabolicAntenna';

    // Articulated deployment boom on upper-side deck
    const boomGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.16, 8);
    const mast = new THREE.Mesh(boomGeo, darkTitaniumMat);
    mast.position.set(0.16, busHeight / 2 + 0.08, 0.12);
    mast.rotation.z = -Math.PI / 6;
    antennaGroup.add(mast);

    // Parabolic dish bowl (sliced sphere)
    const dishGeo = new THREE.SphereGeometry(0.18, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.42);
    const dishMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.35,
      metalness: 0.25,
      side: THREE.DoubleSide,
    });
    const dish = new THREE.Mesh(dishGeo, dishMat);
    dish.position.set(0.24, busHeight / 2 + 0.16, 0.12);
    dish.rotation.x = -Math.PI / 4;
    dish.rotation.y = Math.PI / 6;
    antennaGroup.add(dish);

    // Subreflector feed horn at dish focus
    const hornGeo = new THREE.ConeGeometry(0.024, 0.045, 12);
    const hornMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.25,
      metalness: 0.85,
    });
    const horn = new THREE.Mesh(hornGeo, hornMat);
    horn.position.set(0.24, busHeight / 2 + 0.21, 0.17);
    horn.rotation.x = Math.PI * 0.75;
    antennaGroup.add(horn);

    satBody.add(antennaGroup);
  }

  // ---------------------------------------------------------------------------
  // 6. Attitude Determination Sensors (Dual Star Tracker Baffles)
  // ---------------------------------------------------------------------------
  if (includeStarTrackers) {
    const starTrackerGroup = new THREE.Group();
    starTrackerGroup.name = 'StarTrackers';

    const trackerBaffleGeo = new THREE.CylinderGeometry(0.02, 0.014, 0.07, 12);
    const trackerMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.6,
      metalness: 0.4,
    });

    // Star Tracker 1: Angled at +35° on zenith anti-Sun deck
    const st1 = new THREE.Mesh(trackerBaffleGeo, trackerMat);
    st1.position.set(-0.12, busHeight / 2 + 0.035, 0.14);
    st1.rotation.x = -Math.PI / 5;
    st1.rotation.z = Math.PI / 10;
    starTrackerGroup.add(st1);

    // Star Tracker 2: Orthogonal orientation
    const st2 = new THREE.Mesh(trackerBaffleGeo, trackerMat);
    st2.position.set(-0.12, busHeight / 2 + 0.035, -0.14);
    st2.rotation.x = Math.PI / 5;
    st2.rotation.z = Math.PI / 10;
    starTrackerGroup.add(st2);

    satBody.add(starTrackerGroup);
  }

  // ---------------------------------------------------------------------------
  // 7. Propulsion Deck (Aft +Z face: Chemical / Ion Thrusters)
  // ---------------------------------------------------------------------------
  if (includeThrusters) {
    const thrusterGroup = new THREE.Group();
    thrusterGroup.name = 'PropulsionDeck';

    const aftZ = busDepth / 2;

    // Central electric / ion thruster bell nozzle (tapered cylinder)
    const nozzleGeo = new THREE.CylinderGeometry(0.036, 0.075, 0.11, 16, 1, true);
    const nozzleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.4,
      metalness: 0.85,
      side: THREE.DoubleSide,
    });
    const nozzle = new THREE.Mesh(nozzleGeo, nozzleMat);
    nozzle.rotation.x = Math.PI / 2;
    nozzle.position.set(0, 0, aftZ + 0.055);
    thrusterGroup.add(nozzle);

    // Xenon plasma exhaust glow disc
    const plasmaGeo = new THREE.CircleGeometry(0.034, 16);
    const plasmaMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.1,
      metalness: 0.9,
      emissive: 0x0284c7,
      emissiveIntensity: 0.75,
      side: THREE.DoubleSide,
    });
    const plasma = new THREE.Mesh(plasmaGeo, plasmaMat);
    plasma.position.set(0, 0, aftZ + 0.015);
    thrusterGroup.add(plasma);

    // 4 Corner Reaction Control System (RCS) attitude thrusters
    const rcsGeo = new THREE.CylinderGeometry(0.012, 0.022, 0.035, 8);
    const rcsMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.5,
      metalness: 0.7,
    });
    const rcsOffsets = [
      [-busWidth * 0.4, -busHeight * 0.4],
      [busWidth * 0.4, -busHeight * 0.4],
      [-busWidth * 0.4, busHeight * 0.4],
      [busWidth * 0.4, busHeight * 0.4],
    ];
    rcsOffsets.forEach(([cx, cy]) => {
      const rcs = new THREE.Mesh(rcsGeo, rcsMat);
      rcs.rotation.x = Math.PI / 2;
      rcs.position.set(cx, cy, aftZ + 0.018);
      thrusterGroup.add(rcs);
    });

    satBody.add(thrusterGroup);
  }

  // ---------------------------------------------------------------------------
  // 8. Communication Antennas (TT&C Omni Whip Antennas)
  // ---------------------------------------------------------------------------
  const antennaMastsGroup = new THREE.Group();
  antennaMastsGroup.name = 'TTC_Antennas';
  const mastGeo = new THREE.CylinderGeometry(0.005, 0.005, 0.28, 6);
  const mastMat = new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.3,
    metalness: 0.8,
  });

  const ant1 = new THREE.Mesh(mastGeo, mastMat);
  ant1.position.set(busWidth / 2 + 0.02, busHeight / 2 + 0.12, -busDepth / 2 + 0.05);
  ant1.rotation.z = -Math.PI / 4;
  antennaMastsGroup.add(ant1);

  const ant2 = new THREE.Mesh(mastGeo, mastMat);
  ant2.position.set(-busWidth / 2 - 0.02, -busHeight / 2 - 0.12, busDepth / 2 - 0.05);
  ant2.rotation.z = -Math.PI / 4;
  antennaMastsGroup.add(ant2);

  satBody.add(antennaMastsGroup);

  // ---------------------------------------------------------------------------
  // 9. Normalization & Final Scaling
  // ---------------------------------------------------------------------------
  // Total wingspan is approx 2.6 units (bus 0.48 + 2 * (0.18 + 0.48 * 2)).
  // We normalize by 1 / 2.6 so that base model has maximum span ~ 1.0 unit.
  const NORM_FACTOR = 1.0 / 2.6;
  satBody.scale.set(NORM_FACTOR, NORM_FACTOR, NORM_FACTOR);
  root.add(satBody);

  // Apply requested size scale factor
  if (size !== 1.0) {
    root.scale.set(size, size, size);
  }

  return root;
};

const _tempPos = new THREE.Vector3();

/**
 * Dynamically scales the 3D satellite model to maintain its exact screen-space
 * visual diameter (e.g. 11.0px to 15.4px) regardless of camera zoom or perspective,
 * preserving the exact visual footprint while allowing high-resolution 3D detail
 * when zoomed in close.
 */
export const updateScreenSpaceSatelliteScale = (
  satellite: THREE.Object3D | null,
  camera: THREE.PerspectiveCamera | null,
  canvasHeight: number,
  targetPixelDiameter: number,
  minWorldScale: number = 0.5
): void => {
  if (!satellite || !camera || canvasHeight <= 0) return;
  satellite.getWorldPosition(_tempPos);
  const dist = camera.position.distanceTo(_tempPos);
  if (dist <= 0.001) return;

  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const visibleWorldHeight = 2.0 * dist * Math.tan(fovRad / 2.0);
  const unitsPerPixel = visibleWorldHeight / canvasHeight;

  // Scale corresponding to the target pixel diameter
  const screenScale = targetPixelDiameter * unitsPerPixel;

  // Clamp with a minimum physical scale so that when zooming in really close,
  // the satellite renders at full, clear 3D fidelity rather than shrinking to micro-dots
  const finalScale = Math.max(minWorldScale, screenScale);
  satellite.scale.set(finalScale, finalScale, finalScale);
};

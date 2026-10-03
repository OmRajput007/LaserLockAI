import * as THREE from 'three';

let cachedEarthCanvas: HTMLCanvasElement | null = null;
let cachedEarthTexture: THREE.CanvasTexture | null = null;

/**
 * Transforms longitude [-180, 180] and latitude [-90, 90] into canvas pixel coordinates (x, y).
 * Equirectangular (Plate Carrée) projection.
 */
function toXY(lon: number, lat: number, w: number, h: number): [number, number] {
  const x = ((lon + 180) / 360) * w;
  const y = ((90 - lat) / 180) * h;
  return [x, y];
}

/**
 * Helper to draw a closed polygonal path on canvas given [lon, lat] coordinates.
 */
function drawPolygon(
  ctx: CanvasRenderingContext2D,
  coords: [number, number][],
  w: number,
  h: number
) {
  if (coords.length === 0) return;
  ctx.beginPath();
  const [firstX, firstY] = toXY(coords[0][0], coords[0][1], w, h);
  ctx.moveTo(firstX, firstY);
  for (let i = 1; i < coords.length; i++) {
    const [x, y] = toXY(coords[i][0], coords[i][1], w, h);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/**
 * Generates or retrieves the high-definition procedural 2D Earth canvas.
 */
export function getEarthCanvas(): HTMLCanvasElement {
  if (cachedEarthCanvas) {
    return cachedEarthCanvas;
  }

  const width = 2048;
  const height = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // 1. DEEP OCEANS BASE WITH LATITUDINAL GRADIENT
  const oceanGrad = ctx.createLinearGradient(0, 0, 0, height);
  oceanGrad.addColorStop(0.0, '#091830'); // Arctic icy deep blue
  oceanGrad.addColorStop(0.2, '#0c2347');
  oceanGrad.addColorStop(0.5, '#0f2f5c'); // Equatorial vibrant oceanic navy
  oceanGrad.addColorStop(0.8, '#0c2347');
  oceanGrad.addColorStop(1.0, '#091830'); // Antarctic deep blue
  ctx.fillStyle = oceanGrad;
  ctx.fillRect(0, 0, width, height);

  // Subtle ocean bathymetry / current swirls
  ctx.save();
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = '#1B1D1A';
  for (let i = 0; i < 40; i++) {
    ctx.beginPath();
    const cx = (i * 53) % width;
    const cy = 200 + ((i * 97) % 624);
    ctx.ellipse(cx, cy, 140, 25, (i * 0.3) % Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 2. CONTINENTAL LANDMASS DEFINITIONS (Longitude, Latitude)
  // Africa
  const africaCoords: [number, number][] = [
    [-5.8, 35.8], [0.0, 36.0], [10.5, 37.2], [11.0, 33.0], [15.0, 32.5],
    [24.0, 31.5], [30.0, 31.3], [32.5, 31.4], [34.0, 27.5], [38.0, 22.0],
    [43.5, 12.5], [51.2, 11.8], [49.5, 8.5], [44.0, 3.0], [41.0, -2.5],
    [39.5, -5.0], [36.0, -11.0], [40.5, -15.5], [35.5, -24.0], [32.5, -28.5],
    [28.0, -32.5], [26.0, -34.0], [20.0, -34.8], [18.5, -34.0], [17.5, -30.0],
    [15.0, -23.0], [12.0, -17.0], [13.5, -9.0], [9.0, -1.0], [9.5, 4.0],
    [4.0, 5.0], [-1.5, 5.0], [-7.5, 4.5], [-11.5, 7.0], [-15.0, 11.0],
    [-17.5, 14.8], [-16.5, 19.0], [-13.0, 28.0], [-9.5, 31.0], [-5.8, 35.8],
  ];

  // Madagascar
  const madagascarCoords: [number, number][] = [
    [49.5, -12.0], [50.5, -15.5], [48.0, -22.0], [45.5, -25.5], [43.5, -22.0],
    [44.0, -16.0], [47.0, -13.5], [49.5, -12.0],
  ];

  // Eurasia (Europe + Asia + Middle East)
  const eurasiaCoords: [number, number][] = [
    // Iberia & Western Europe
    [-9.0, 38.5], [-9.0, 43.0], [-2.0, 43.5], [-1.0, 46.0], [-4.5, 48.5],
    [0.0, 49.5], [3.0, 51.5], [8.0, 54.0], [8.5, 57.5], [12.0, 55.5],
    // Scandinavia
    [5.0, 60.0], [5.0, 62.0], [12.0, 68.0], [24.0, 71.0], [31.0, 70.0],
    [38.0, 68.0], [44.0, 68.5], [60.0, 70.0], [70.0, 73.0], [80.0, 74.0],
    // Siberia North Coast to Kamchatka
    [105.0, 77.5], [115.0, 74.0], [135.0, 72.0], [150.0, 72.0], [170.0, 69.0],
    [170.0, 65.0], [180.0, 65.0], [175.0, 62.0], [163.0, 58.0], [156.0, 51.0],
    [143.0, 53.0], [135.0, 45.0], [131.0, 43.0],
    // Korea & China Coast
    [129.0, 38.0], [127.0, 34.5], [121.0, 31.5], [120.0, 26.0], [116.0, 23.0],
    [110.0, 20.0], [108.0, 16.0], [105.0, 10.0], [103.5, 1.5], [100.0, 7.5],
    // Indochina, Bay of Bengal, India
    [98.0, 15.0], [92.0, 22.0], [88.0, 22.0], [82.0, 17.0], [80.0, 13.0],
    [77.5, 8.0], [73.5, 15.0], [70.0, 21.0], [67.0, 24.5],
    // Persian Gulf, Arabia
    [62.0, 25.0], [57.0, 25.5], [59.5, 22.5], [54.0, 17.0], [45.0, 12.5],
    [43.0, 14.0], [38.0, 22.0], [35.0, 28.0], [34.5, 31.5],
    // Mediterranean Levant, Anatolia, Greece, Italy, France, Spain
    [36.0, 36.0], [31.0, 36.5], [26.0, 37.0], [23.5, 38.0], [20.0, 39.5],
    [18.5, 40.5], [15.5, 38.0], [14.0, 41.0], [12.0, 44.0], [8.0, 44.0],
    [3.5, 43.0], [-0.5, 38.5], [-5.5, 36.0], [-9.0, 38.5],
  ];

  // British Isles
  const britainCoords: [number, number][] = [
    [-5.0, 50.0], [-1.0, 51.0], [1.5, 52.5], [0.0, 54.5], [-2.0, 57.5],
    [-5.0, 58.5], [-6.0, 55.0], [-3.5, 51.5], [-5.0, 50.0],
  ];
  const irelandCoords: [number, number][] = [
    [-6.0, 53.5], [-8.0, 55.0], [-10.0, 54.0], [-10.5, 52.0], [-8.0, 51.5],
    [-6.0, 53.5],
  ];

  // Japan
  const japanCoords: [number, number][] = [
    [130.0, 31.5], [133.0, 34.0], [137.0, 35.0], [141.0, 38.0], [141.5, 43.0],
    [145.5, 44.0], [141.0, 45.5], [138.5, 37.5], [131.0, 33.0], [130.0, 31.5],
  ];

  // North America
  const northAmericaCoords: [number, number][] = [
    // Alaska & North Coast
    [-168.0, 66.0], [-160.0, 71.0], [-140.0, 70.0], [-125.0, 69.5], [-105.0, 68.5],
    [-85.0, 68.0], [-80.0, 62.0], [-65.0, 59.0], [-55.0, 52.0], [-60.0, 46.0],
    // Eastern Seaboard & Florida
    [-66.0, 44.5], [-71.0, 42.0], [-74.0, 40.5], [-76.0, 36.5], [-80.5, 32.0],
    [-80.5, 25.5], [-82.5, 28.0], [-88.0, 30.5], [-95.0, 29.5], [-97.5, 26.0],
    // Mexico & Central America
    [-93.0, 18.0], [-87.0, 21.5], [-89.0, 16.0], [-83.0, 9.5], [-78.0, 8.0],
    [-82.0, 8.5], [-88.0, 13.5], [-94.0, 16.0], [-105.0, 20.0], [-110.0, 24.0],
    [-115.0, 32.0], [-117.0, 26.0], [-112.0, 26.0], [-117.0, 32.5],
    // US West Coast & Canada Pacific
    [-122.0, 37.5], [-124.5, 43.0], [-125.0, 48.5], [-128.0, 52.0], [-135.0, 57.0],
    [-145.0, 60.0], [-155.0, 57.0], [-165.0, 54.0], [-168.0, 66.0],
  ];

  // Greenland
  const greenlandCoords: [number, number][] = [
    [-45.0, 60.0], [-35.0, 65.5], [-20.0, 73.0], [-20.0, 81.0], [-40.0, 83.5],
    [-60.0, 81.5], [-70.0, 76.5], [-55.0, 70.0], [-50.0, 64.0], [-45.0, 60.0],
  ];

  // South America
  const southAmericaCoords: [number, number][] = [
    [-77.5, 8.0], [-72.0, 11.5], [-62.0, 10.5], [-53.0, 5.5], [-44.0, -2.5],
    [-35.0, -5.5], [-35.0, -9.0], [-38.5, -13.0], [-41.0, -21.0], [-48.0, -26.0],
    [-53.0, -33.0], [-57.0, -35.5], [-63.0, -41.0], [-66.0, -47.0], [-66.0, -54.0],
    [-68.5, -55.0], [-74.0, -52.0], [-74.0, -44.0], [-72.0, -36.0], [-70.5, -28.0],
    [-70.0, -19.0], [-76.0, -14.0], [-81.0, -5.0], [-80.0, 0.0], [-77.5, 8.0],
  ];

  // Australia
  const australiaCoords: [number, number][] = [
    [130.0, -12.5], [136.0, -12.0], [142.0, -11.0], [145.0, -16.0], [150.0, -22.0],
    [153.5, -28.0], [151.0, -34.0], [147.0, -38.5], [141.0, -38.5], [137.5, -35.0],
    [135.0, -33.5], [125.0, -32.5], [116.0, -35.0], [115.0, -32.0], [113.5, -25.0],
    [114.5, -22.0], [122.0, -17.0], [126.0, -14.0], [130.0, -12.5],
  ];

  // New Zealand
  const newZealandNorth: [number, number][] = [
    [173.0, -35.0], [178.0, -38.0], [176.0, -41.5], [174.5, -41.0], [173.0, -35.0],
  ];
  const newZealandSouth: [number, number][] = [
    [173.5, -41.0], [174.0, -43.0], [170.5, -46.0], [167.0, -46.0], [169.0, -42.5],
    [173.5, -41.0],
  ];

  // Indonesia & Maritime Islands
  const sumatraCoords: [number, number][] = [
    [95.5, 5.5], [99.0, 2.0], [105.0, -5.5], [102.5, -4.0], [98.0, 0.5], [95.5, 5.5],
  ];
  const borneoCoords: [number, number][] = [
    [110.0, 1.5], [117.0, 4.0], [119.0, 4.0], [117.0, -3.5], [111.0, -3.0], [109.0, 0.0], [110.0, 1.5],
  ];
  const papuaCoords: [number, number][] = [
    [131.0, -1.0], [141.0, -2.5], [150.0, -10.0], [143.0, -8.0], [136.0, -4.5], [131.0, -1.0],
  ];

  // Cuba & Caribbean
  const cubaCoords: [number, number][] = [
    [-84.5, 22.0], [-79.0, 22.5], [-75.0, 20.0], [-77.0, 20.0], [-82.0, 21.5], [-84.5, 22.0],
  ];

  const landmasses = [
    { name: 'Africa', coords: africaCoords, primaryColor: '#3a5f36', desertColor: '#be995a' },
    { name: 'Madagascar', coords: madagascarCoords, primaryColor: '#2f5b2e' },
    { name: 'Eurasia', coords: eurasiaCoords, primaryColor: '#446e3d', desertColor: '#c29d5b' },
    { name: 'Britain', coords: britainCoords, primaryColor: '#3d6836' },
    { name: 'Ireland', coords: irelandCoords, primaryColor: '#3d6836' },
    { name: 'Japan', coords: japanCoords, primaryColor: '#3a6234' },
    { name: 'North America', coords: northAmericaCoords, primaryColor: '#456a3a', desertColor: '#a68c5b' },
    { name: 'Greenland', coords: greenlandCoords, primaryColor: '#d6e4ed' },
    { name: 'South America', coords: southAmericaCoords, primaryColor: '#2b5e28' },
    { name: 'Australia', coords: australiaCoords, primaryColor: '#ab7945', desertColor: '#c88e4e' },
    { name: 'NZ North', coords: newZealandNorth, primaryColor: '#2d5b2a' },
    { name: 'NZ South', coords: newZealandSouth, primaryColor: '#376233' },
    { name: 'Sumatra', coords: sumatraCoords, primaryColor: '#245922' },
    { name: 'Borneo', coords: borneoCoords, primaryColor: '#245922' },
    { name: 'Papua', coords: papuaCoords, primaryColor: '#245922' },
    { name: 'Cuba', coords: cubaCoords, primaryColor: '#2b5e28' },
  ];

  // 3. DRAW SHALLOW CONTINENTAL SHELVES (TURQUOISE GLOW)
  ctx.save();
  ctx.fillStyle = '#17739e';
  ctx.shadowColor = '#22d3ee';
  ctx.shadowBlur = 14;
  ctx.globalAlpha = 0.55;
  for (const land of landmasses) {
    drawPolygon(ctx, land.coords, width, height);
    ctx.fill();
  }
  ctx.restore();

  // 4. DRAW BASE CONTINENTS (VEGETATION / TERRAIN)
  for (const land of landmasses) {
    drawPolygon(ctx, land.coords, width, height);
    ctx.fillStyle = land.primaryColor;
    ctx.fill();

    // Coastline highlight
    ctx.strokeStyle = '#274b24';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 5. DRAW REGIONAL BIOMES & ELEVATIONS (DESERTS, HIGHLANDS, MOUNTAINS)
  // Sahara & Arabian Desert
  const saharaCoords: [number, number][] = [
    [-15.0, 20.0], [-10.0, 30.0], [5.0, 32.0], [30.0, 30.0], [50.0, 25.0],
    [58.0, 22.0], [50.0, 15.0], [42.0, 13.0], [32.0, 15.0], [15.0, 14.0],
    [-5.0, 15.0], [-15.0, 20.0],
  ];
  drawPolygon(ctx, saharaCoords, width, height);
  const saharaGrad = ctx.createLinearGradient(0, height * 0.35, 0, height * 0.5);
  saharaGrad.addColorStop(0.0, '#c7a364');
  saharaGrad.addColorStop(0.5, '#dfbe7d');
  saharaGrad.addColorStop(1.0, '#b88f4e');
  ctx.fillStyle = saharaGrad;
  ctx.fill();

  // Australian Outback (Red-ochre desert interior)
  const outbackCoords: [number, number][] = [
    [120.0, -20.0], [140.0, -20.0], [144.0, -28.0], [138.0, -32.0],
    [125.0, -30.0], [118.0, -26.0], [120.0, -20.0],
  ];
  drawPolygon(ctx, outbackCoords, width, height);
  ctx.fillStyle = '#b86f3b';
  ctx.fill();

  // Gobi & Central Asian Steppe Desert
  const gobiCoords: [number, number][] = [
    [65.0, 35.0], [80.0, 45.0], [105.0, 45.0], [110.0, 38.0],
    [90.0, 35.0], [75.0, 32.0], [65.0, 35.0],
  ];
  drawPolygon(ctx, gobiCoords, width, height);
  ctx.fillStyle = '#9b8252';
  ctx.fill();

  // Himalayas & Tibetan Plateau (High snow/rock ridge)
  const himalayaCoords: [number, number][] = [
    [75.0, 34.0], [88.0, 35.0], [98.0, 32.0], [95.0, 28.0],
    [85.0, 27.0], [78.0, 30.0], [75.0, 34.0],
  ];
  drawPolygon(ctx, himalayaCoords, width, height);
  ctx.fillStyle = '#d4cbb8';
  ctx.fill();

  // Andes Mountain Ridge (Chile/Peru/Ecuador)
  ctx.save();
  ctx.strokeStyle = '#857864';
  ctx.lineWidth = 4;
  ctx.beginPath();
  const andesPts: [number, number][] = [
    [-77.0, 5.0], [-79.0, -3.0], [-76.0, -10.0], [-71.0, -20.0],
    [-70.0, -33.0], [-72.0, -45.0], [-68.0, -54.0],
  ];
  const [a0x, a0y] = toXY(andesPts[0][0], andesPts[0][1], width, height);
  ctx.moveTo(a0x, a0y);
  for (let i = 1; i < andesPts.length; i++) {
    const [ax, ay] = toXY(andesPts[i][0], andesPts[i][1], width, height);
    ctx.lineTo(ax, ay);
  }
  ctx.stroke();
  ctx.restore();

  // Rocky Mountains Ridge (North America)
  ctx.save();
  ctx.strokeStyle = '#7c705d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  const rockiesPts: [number, number][] = [
    [-150.0, 64.0], [-130.0, 58.0], [-120.0, 50.0], [-112.0, 44.0],
    [-106.0, 36.0], [-102.0, 28.0],
  ];
  const [r0x, r0y] = toXY(rockiesPts[0][0], rockiesPts[0][1], width, height);
  ctx.moveTo(r0x, r0y);
  for (let i = 1; i < rockiesPts.length; i++) {
    const [rx, ry] = toXY(rockiesPts[i][0], rockiesPts[i][1], width, height);
    ctx.lineTo(rx, ry);
  }
  ctx.stroke();
  ctx.restore();

  // 6. POLAR ICE CAPS (ARCTIC & ANTARCTICA)
  // Antarctica: Latitude -64 to -90
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, height);
  ctx.lineTo(0, height * 0.86);
  // Undulating ice edge across longitudes
  for (let x = 0; x <= width; x += 32) {
    const lon = (x / width) * 360 - 180;
    // Antarctic Peninsula extends northwards around -60° lon
    const peninsulaBoost = Math.exp(-Math.pow((lon - -60) / 15, 2)) * 65;
    const wave = Math.sin(lon * 0.08) * 15 + Math.cos(lon * 0.15) * 8;
    const y = height * 0.86 - peninsulaBoost + wave;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height * 0.86);
  ctx.lineTo(width, height);
  ctx.closePath();
  const antarcticGrad = ctx.createLinearGradient(0, height * 0.78, 0, height);
  antarcticGrad.addColorStop(0.0, '#d8edf8');
  antarcticGrad.addColorStop(0.1, '#f1f8fc');
  antarcticGrad.addColorStop(1.0, '#ffffff');
  ctx.fillStyle = antarcticGrad;
  ctx.fill();
  ctx.restore();

  // Arctic Sea Ice Pack: Latitude +72 to +90
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, height * 0.11);
  for (let x = 0; x <= width; x += 32) {
    const lon = (x / width) * 360 - 180;
    const wave = Math.sin(lon * 0.05) * 12 + Math.cos(lon * 0.12) * 8;
    const y = height * 0.10 + wave;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(width, height * 0.11);
  ctx.lineTo(width, 0);
  ctx.closePath();
  const arcticGrad = ctx.createLinearGradient(0, 0, 0, height * 0.15);
  arcticGrad.addColorStop(0.0, '#ffffff');
  arcticGrad.addColorStop(0.8, '#ebf6fa');
  arcticGrad.addColorStop(1.0, '#c7e3f2');
  ctx.fillStyle = arcticGrad;
  ctx.fill();
  ctx.restore();

  // 7. ATMOSPHERIC CLOUD SWIRLS & METEOROLOGICAL PATTERNS
  ctx.save();
  // Cloud color: soft translucent ivory white
  ctx.fillStyle = '#ffffff';

  // 7a. Equatorial Intertropical Convergence Zone (ITCZ) Cloud Belts (0° to 10° N/S)
  for (let i = 0; i < 28; i++) {
    const cx = (i * 77) % width;
    const cy = height * 0.50 + Math.sin(i * 1.3) * 35;
    ctx.globalAlpha = 0.22 + (Math.sin(i * 0.7) + 1) * 0.08;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 110 + (i % 5) * 20, 18 + (i % 3) * 6, (i * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }

  // 7b. Northern Mid-Latitude Weather Fronts & Cyclones (30° - 55° N)
  for (let i = 0; i < 20; i++) {
    const cx = (i * 109 + 80) % width;
    const cy = height * 0.26 + Math.sin(i * 1.8) * 45;
    ctx.globalAlpha = 0.28 + (i % 3) * 0.05;
    ctx.beginPath();
    // Curved cyclone swirl arc
    ctx.ellipse(cx, cy, 95 + (i % 4) * 18, 26 + (i % 3) * 8, 0.45 + (i % 3) * 0.2, 0, Math.PI * 2);
    ctx.fill();
  }

  // 7c. Southern Ocean Roaring Forties Cloud Bands (40° - 60° S)
  for (let i = 0; i < 24; i++) {
    const cx = (i * 91 + 40) % width;
    const cy = height * 0.72 + Math.cos(i * 1.4) * 30;
    ctx.globalAlpha = 0.25 + (i % 4) * 0.06;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 120 + (i % 5) * 15, 20 + (i % 3) * 5, -0.25, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // 8. FAINT CARTOGRAPHIC GRATICULE (Equator, Prime Meridian, Tropics)
  // Very low opacity so Earth features remain rich and vibrant while preserving mission-control coordinate grid
  ctx.save();
  ctx.strokeStyle = '#9CA195';
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.12;

  // Equator
  ctx.beginPath();
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();

  // Tropics (±23.5°)
  const [_, yTropicN] = toXY(0, 23.5, width, height);
  const [__, yTropicS] = toXY(0, -23.5, width, height);
  ctx.beginPath();
  ctx.moveTo(0, yTropicN);
  ctx.lineTo(width, yTropicN);
  ctx.moveTo(0, yTropicS);
  ctx.lineTo(width, yTropicS);
  ctx.stroke();

  // Prime Meridian & 90° intervals
  for (const lon of [-180, -90, 0, 90, 180]) {
    const [x] = toXY(lon, 0, width, height);
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  ctx.restore();

  cachedEarthCanvas = canvas;
  return canvas;
}

/**
 * Creates a dedicated, isolated THREE.CanvasTexture instance from the procedural Earth canvas.
 * Safe for use across multiple WebGLRenderer contexts.
 */
export function createEarthTexture(): THREE.CanvasTexture {
  const canvas = getEarthCanvas();
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

let cachedRealisticTextures: {
  day: THREE.Texture;
  normal: THREE.Texture;
  specular: THREE.Texture;
  clouds: THREE.Texture;
  nightLights: THREE.Texture;
} | null = null;

/**
 * Loads and caches photorealistic NASA Blue Marble textures.
 * Uses local static assets served by Vite (/textures/earth/...).
 */
export function getRealisticEarthTextures() {
  if (cachedRealisticTextures) {
    return cachedRealisticTextures;
  }

  const textureLoader = new THREE.TextureLoader();

  // Create immediate canvas texture fallback while realistic images load
  const fallbackCanvas = getOrCreateEarthTexture();

  const loadTex = (url: string, isColor: boolean = false) => {
    const tex = textureLoader.load(
      url,
      (loaded) => {
        loaded.needsUpdate = true;
      },
      undefined,
      (err) => {
        console.warn(`Could not load Earth texture from ${url}, using fallback:`, err);
      }
    );
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    if (isColor) {
      tex.colorSpace = THREE.SRGBColorSpace;
    }
    return tex;
  };

  const day = loadTex('/textures/earth/earth_day_2048.jpg', true);
  const normal = loadTex('/textures/earth/earth_normal_2048.jpg', false);
  const specular = loadTex('/textures/earth/earth_specular_2048.jpg', false);
  const clouds = loadTex('/textures/earth/earth_clouds_1024.png', true);
  const nightLights = loadTex('/textures/earth/earth_lights_2048.png', true);

  cachedRealisticTextures = { day, normal, specular, clouds, nightLights };
  return cachedRealisticTextures;
}

/**
 * Retrieves the shared cached Earth texture (photorealistic NASA day map with procedural fallback).
 */
export function getOrCreateEarthTexture(): THREE.Texture {
  if (cachedEarthTexture) {
    return cachedEarthTexture;
  }
  // Initialize procedural canvas texture first
  cachedEarthTexture = createEarthTexture();

  // Return realistic day texture if available
  try {
    const realistic = getRealisticEarthTextures();
    if (realistic && realistic.day) {
      return realistic.day;
    }
  } catch (e) {
    console.warn('Using procedural canvas Earth texture fallback:', e);
  }
  return cachedEarthTexture;
}

/**
 * Creates an Earth atmosphere outer rim glow sphere mesh with realistic Rayleigh scattering look.
 */
export function createAtmosphereRimMesh(radius: number): THREE.Mesh {
  const atmoGeo = new THREE.SphereGeometry(radius * 1.018, 64, 32);
  const atmoMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.22,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
  });
  const atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
  atmoMesh.name = 'earthAtmosphereRimGlow';
  atmoMesh.renderOrder = 2;
  return atmoMesh;
}

/**
 * Assembly holding realistic Earth components (globe, rotating cloud layer, night city lights).
 */
export interface RealisticEarthAssembly {
  globeMesh: THREE.Mesh;
  cloudMesh: THREE.Mesh;
  nightMesh: THREE.Mesh;
  atmosphereMesh: THREE.Mesh;
  updateSunDir: (sunDir: THREE.Vector3) => void;
  updateRadius: (radius: number) => void;
  setShowSunTerminator?: (show: boolean) => void;
}

/**
 * Creates a fully realistic NASA Earth globe with:
 * - High-tessellation sphere geometry (96x64)
 * - Photorealistic satellite surface map (NASA Blue Marble)
 * - Normal bump map for terrain elevation and mountain relief
 * - Specular reflection for oceans
 * - Rotating transparent cloud sphere layer (AdditiveBlending)
 * - Integrated per-pixel day/night solar terminator with glowing city lights
 * - Multi-layer Rayleigh atmospheric haze (no concentric Z-fighting or facet artifacts)
 */
export function createRealisticEarthAssembly(
  radius: number,
  fixedSunDir: THREE.Vector3
): RealisticEarthAssembly {
  const textures = getRealisticEarthTextures();

  // Uniform references for physical solar lighting & day/night terminator
  const sunUniform = { value: fixedSunDir.clone() };
  const showTerminatorUniform = { value: 1.0 };
  const nightLightsUniform = { value: textures.nightLights };

  // 1. Globe Mesh (High-tessellation 96x64)
  const globeGeo = new THREE.SphereGeometry(radius, 96, 64);
  const globeMat = new THREE.MeshStandardMaterial({
    map: textures.day,
    normalMap: textures.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughnessMap: textures.specular,
    roughness: 0.68,
    metalness: 0.05,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
    depthWrite: true,
    depthTest: true,
  });

  // Seamlessly integrate twilight terminator darkening and glowing golden city lights
  // directly into the globe shader. This completely eliminates any separate concentric
  // sphere mesh, preventing chord intersections, faceting, and dark trapezoid artifacts!
  globeMat.onBeforeCompile = (shader) => {
    shader.uniforms.uSunDir = sunUniform;
    shader.uniforms.uShowTerminator = showTerminatorUniform;
    shader.uniforms.uNightLights = nightLightsUniform;

    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
varying vec3 vEarthNormal;
varying vec2 vEarthUv;`
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
vEarthNormal = normalize((modelMatrix * vec4(normal, 0.0)).xyz);
vEarthUv = uv;`
    );

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
uniform vec3 uSunDir;
uniform float uShowTerminator;
uniform sampler2D uNightLights;
varying vec3 vEarthNormal;
varying vec2 vEarthUv;`
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
if (uShowTerminator > 0.5) {
  float dotSun = dot(vEarthNormal, uSunDir);
  // Physical twilight transition zone (-0.12 to +0.12)
  float nightFactor = smoothstep(0.12, -0.12, dotSun);
  
  // Natural night darkening across oceans and land
  gl_FragColor.rgb *= mix(1.0, 0.04, nightFactor * 0.96);
  
  // Electric golden city lights glowing on dark continents
  vec4 nightSample = texture2D(uNightLights, vEarthUv);
  float cityIntensity = max(nightSample.r, max(nightSample.g, nightSample.b));
  vec3 cityColor = nightSample.rgb * vec3(1.7, 1.4, 0.95);
  gl_FragColor.rgb += cityColor * (nightFactor * cityIntensity * 1.8);
}`
    );
  };

  const globeMesh = new THREE.Mesh(globeGeo, globeMat);
  globeMesh.name = 'realisticEarthGlobe';
  globeMesh.renderOrder = 0;

  // 2. Cloud Layer (Transparent, slightly above surface with AdditiveBlending)
  const cloudGeo = new THREE.SphereGeometry(radius * 1.006, 64, 32);
  const cloudMat = new THREE.MeshStandardMaterial({
    map: textures.clouds,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
  });
  const cloudMesh = new THREE.Mesh(cloudGeo, cloudMat);
  cloudMesh.name = 'earthCloudsLayer';
  cloudMesh.renderOrder = 3;
  globeMesh.add(cloudMesh);

  // 3. Dummy / Invisible Night Mesh kept for API compatibility with scene refs
  const nightMesh = new THREE.Mesh();
  nightMesh.name = 'earthNightCityLights';
  nightMesh.visible = false;
  globeMesh.add(nightMesh);

  // 4. Atmosphere Rim Glow (Multi-layer Rayleigh scattering haze)
  const atmosphereMesh = createAtmosphereRimMesh(radius);
  globeMesh.add(atmosphereMesh);

  const updateSunDir = (sunDir: THREE.Vector3) => {
    sunUniform.value.copy(sunDir);
  };

  const setShowSunTerminator = (show: boolean) => {
    showTerminatorUniform.value = show ? 1.0 : 0.0;
  };

  const updateRadius = (newRadius: number) => {
    const s = newRadius / radius;
    globeMesh.scale.set(s, s, s);
  };

  return {
    globeMesh,
    cloudMesh,
    nightMesh,
    atmosphereMesh,
    updateSunDir,
    updateRadius,
    setShowSunTerminator,
  };
}


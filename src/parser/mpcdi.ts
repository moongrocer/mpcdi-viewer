import JSZip from 'jszip';
import type {
  MpcdiProject,
  MpcdiBuffer,
  Region,
  Frustum,
  WarpMap,
  BlendMapSet,
  MpcdiProfile,
} from '../model/types';
import { parsePFM, normalizeWarpData } from './pfm';
import { loadPngAsBlendMap } from './png';

/** Diagnostic log — collects messages during parsing for the UI to display */
export const parseDiag: string[] = [];
function diag(msg: string) {
  parseDiag.push(msg);
  console.log(`[MPCDI] ${msg}`);
}

/**
 * Parse an MPCDI package (.mpcdi file = zip archive).
 */
export async function parseMpcdiPackage(file: File): Promise<MpcdiProject> {
  parseDiag.length = 0;
  const zip = await JSZip.loadAsync(file);

  // Log all files in the archive
  const allFiles = Object.keys(zip.files);
  diag(`Archive contains ${allFiles.length} entries:`);
  for (const f of allFiles) diag(`  ${f}`);

  // Find the XML manifest
  const xmlFile =
    zip.file('mpcdi.xml') ??
    zip.file('MPCDI.xml') ??
    zip.file(/\.xml$/i)[0];
  if (!xmlFile) throw new Error('No XML manifest found in MPCDI package');
  diag(`Manifest: ${xmlFile.name}`);

  const xmlText = await xmlFile.async('string');
  diag(`XML content (first 2000 chars):\n${xmlText.substring(0, 2000)}`);

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');

  // Check for XML parse errors
  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`XML parse error: ${parseError.textContent}`);
  }

  const root = doc.documentElement;
  diag(`Root element: <${root.tagName}> attributes: ${Array.from(root.attributes).map(a => `${a.name}="${a.value}"`).join(' ')}`);

  // Accept both <MPCDI> and lowercase variants
  const profile = (root.getAttribute('profile') ?? root.getAttribute('Profile') ?? '2d') as MpcdiProfile;
  const version = root.getAttribute('version') ?? root.getAttribute('Version') ?? '2.0';
  const date = root.getAttribute('date') ?? undefined;
  diag(`Profile: ${profile}, Version: ${version}`);

  // Find display element — try multiple paths
  const displayEl =
    root.querySelector('display') ??
    root.querySelector('Display') ??
    root; // Fall back to root if no <display> wrapper
  diag(`Display element: <${displayEl.tagName}>`);

  const bufferEls = displayEl.querySelectorAll('buffer');
  diag(`Found ${bufferEls.length} buffer(s)`);

  // Pre-index all PFM and PNG files in the archive for fallback matching
  const allPfmFiles = zip.file(/\.pfm$/i);
  const allPngFiles = zip.file(/\.png$/i);
  diag(`PFM files in archive: ${allPfmFiles.map(f => f.name).join(', ') || 'none'}`);
  diag(`PNG files in archive: ${allPngFiles.map(f => f.name).join(', ') || 'none'}`);

  const buffers: MpcdiBuffer[] = [];

  for (const bufEl of bufferEls) {
    const bufferId = bufEl.getAttribute('id') ?? 'default';
    const bxRes = intAttr(bufEl, 'xResolution', 1920);
    const byRes = intAttr(bufEl, 'yResolution', 1080);
    diag(`Buffer "${bufferId}" ${bxRes}×${byRes}`);

    const regionEls = bufEl.querySelectorAll('region');
    diag(`  ${regionEls.length} region(s)`);
    const regions: Region[] = [];

    for (const regEl of regionEls) {
      const regionId = regEl.getAttribute('id') ?? 'default';
      const x = floatAttr(regEl, 'x', 0);
      const y = floatAttr(regEl, 'y', 0);
      const xSize = floatAttr(regEl, 'xSize', 1);
      const ySize = floatAttr(regEl, 'ySize', 1);
      const xRes = intAttr(regEl, 'xResolution', bxRes);
      const yRes = intAttr(regEl, 'yResolution', byRes);
      diag(`  Region "${regionId}" at (${x},${y}) size (${xSize},${ySize}) res ${xRes}×${yRes}`);

      // Log all child elements of the region for debugging
      logChildren(regEl, '    ');

      // Frustum
      const frustum = parseFrustum(regEl.querySelector('frustum'));

      // ── Warp map discovery (multi-strategy) ────────────────────
      let warpMap: WarpMap | undefined;

      // Strategy 1: Direct <geometryWarpFile> descendant of region
      const geoEl = findGeoWarpElement(regEl);
      if (geoEl) {
        const geoPath = resolveFilePath(geoEl, bufferId);
        diag(`    Warp path from XML: "${geoPath}"`);
        if (geoPath) {
          warpMap = await loadWarpMap(zip, geoPath, bufferId);
        }
      } else {
        diag(`    No <geometryWarpFile> found in region XML`);
      }

      // Strategy 2: Search the entire document for geometryWarpFile referencing this region
      if (!warpMap) {
        const allGeoEls = doc.querySelectorAll('geometryWarpFile, GeometryWarpFile');
        for (const el of allGeoEls) {
          const path = resolveFilePath(el, bufferId);
          if (path && path.toLowerCase().includes(regionId.toLowerCase())) {
            diag(`    Found global geometryWarpFile matching region: "${path}"`);
            warpMap = await loadWarpMap(zip, path, bufferId);
            if (warpMap) break;
          }
        }
      }

      // Strategy 3: Match PFM filename to region ID
      if (!warpMap) {
        const regionLower = regionId.toLowerCase();
        for (const pfmFile of allPfmFiles) {
          const nameLower = pfmFile.name.toLowerCase();
          if (nameLower.includes(regionLower)) {
            diag(`    PFM filename match for region: ${pfmFile.name}`);
            warpMap = await loadPfmFile(pfmFile);
            if (warpMap) break;
          }
        }
      }

      // Strategy 4: Match PFM filename by buffer path prefix
      if (!warpMap) {
        for (const pfmFile of allPfmFiles) {
          const nameLower = pfmFile.name.toLowerCase();
          if (nameLower.startsWith(bufferId.toLowerCase() + '/')) {
            diag(`    PFM under buffer directory: ${pfmFile.name}`);
            warpMap = await loadPfmFile(pfmFile);
            if (warpMap) break;
          }
        }
      }

      // Strategy 5: If there's only one PFM and one region, just use it
      if (!warpMap && allPfmFiles.length === 1 && regionEls.length === 1) {
        diag(`    Single PFM + single region fallback: ${allPfmFiles[0].name}`);
        warpMap = await loadPfmFile(allPfmFiles[0]);
      }

      // Strategy 6: Match PFM by region index — e.g., Projector1 → pfm[0]
      if (!warpMap && allPfmFiles.length >= regions.length + 1) {
        const pfmFile = allPfmFiles[regions.length]; // current region index
        diag(`    PFM by index fallback: ${pfmFile.name}`);
        warpMap = await loadPfmFile(pfmFile);
      }

      if (warpMap) {
        diag(`    ✓ Warp loaded: ${warpMap.width}×${warpMap.height} from ${warpMap.path}`);
      } else {
        diag(`    ✗ No warp map found for region "${regionId}"`);
      }

      // ── Blend map discovery ────────────────────────────────────
      const blendMaps = await loadBlendMaps(zip, regEl, doc, bufferId, regionId, allPngFiles);

      regions.push({
        id: regionId,
        x, y, xSize, ySize,
        xResolution: xRes,
        yResolution: yRes,
        frustum,
        warpMap,
        blendMaps,
      });
    }

    buffers.push({ id: bufferId, xResolution: bxRes, yResolution: byRes, regions });
  }

  return { profile, version, date, buffers };
}

/**
 * Load a standalone PFM file (for manual warp map loading).
 * Returns a WarpMap that can be assigned to a region.
 */
export async function loadStandalonePfm(file: File): Promise<WarpMap> {
  const buffer = await file.arrayBuffer();
  const pfm = parsePFM(buffer);
  const data = normalizeWarpData(pfm);
  return {
    width: pfm.width,
    height: pfm.height,
    data,
    path: file.name,
  };
}

// ── XML element finders ──────────────────────────────────────────────

/** Search for the geometry warp file element using multiple strategies */
function findGeoWarpElement(regionEl: Element): Element | null {
  // Direct descendant search (handles any nesting depth: fileSet, files, etc.)
  const selectors = [
    'geometryWarpFile',
    'GeometryWarpFile',
    'geometrywarpfile',
    'fileResource[type="GeometryWarpFile"]',
    'fileResource[type="geometryWarpFile"]',
  ];
  for (const sel of selectors) {
    try {
      const el = regionEl.querySelector(sel);
      if (el) return el;
    } catch { /* invalid selector for this doc */ }
  }
  return null;
}

function logChildren(el: Element, indent: string) {
  for (const child of el.children) {
    const attrs = Array.from(child.attributes).map(a => `${a.name}="${a.value}"`).join(' ');
    const text = child.children.length === 0 ? child.textContent?.trim() : '';
    diag(`${indent}<${child.tagName}${attrs ? ' ' + attrs : ''}>${text ? ' → ' + text : ''}`);
    if (child.children.length > 0) logChildren(child, indent + '  ');
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function intAttr(el: Element, name: string, fallback: number): number {
  const v = el.getAttribute(name);
  return v ? parseInt(v, 10) : fallback;
}

function floatAttr(el: Element, name: string, fallback: number): number {
  const v = el.getAttribute(name);
  return v ? parseFloat(v) : fallback;
}

function parseFrustum(el: Element | null): Frustum | undefined {
  if (!el) return undefined;
  return {
    yaw: floatChild(el, 'yaw'),
    pitch: floatChild(el, 'pitch'),
    roll: floatChild(el, 'roll'),
    rightAngle: floatChild(el, 'rightAngle'),
    leftAngle: floatChild(el, 'leftAngle'),
    upAngle: floatChild(el, 'upAngle'),
    downAngle: floatChild(el, 'downAngle'),
  };
}

function floatChild(parent: Element, tag: string): number {
  const el = parent.querySelector(tag);
  return el ? parseFloat(el.textContent ?? '0') : 0;
}

/** Resolve a file path from an XML element */
function resolveFilePath(el: Element, _bufferId: string): string {
  // Try: attribute, nested <path>, direct text content
  return (
    el.getAttribute('path') ??
    el.querySelector('path')?.textContent?.trim() ??
    el.querySelector('Path')?.textContent?.trim() ??
    el.textContent?.trim() ??
    ''
  );
}

/** Try multiple path variations to find a file inside the zip */
function findInZip(zip: JSZip, path: string, bufferId: string): JSZip.JSZipObject | null {
  if (!path) return null;

  // Try exact path
  let f = zip.file(path);
  if (f) return f;

  // Try with buffer prefix
  if (bufferId) {
    f = zip.file(`${bufferId}/${path}`);
    if (f) return f;
  }

  // Try just the filename (strip any directory prefix from path)
  const basename = path.split('/').pop() ?? path;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir && name.endsWith(basename)) return entry;
  }

  // Case-insensitive search on full path
  const lower = path.toLowerCase();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir && name.toLowerCase() === lower) return entry;
  }

  // Case-insensitive search on basename
  const lowerBase = basename.toLowerCase();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir && name.toLowerCase().endsWith(lowerBase)) return entry;
  }

  return null;
}

async function loadWarpMap(zip: JSZip, path: string, bufferId: string): Promise<WarpMap | undefined> {
  const file = findInZip(zip, path, bufferId);
  if (!file) {
    diag(`    findInZip failed for path="${path}" bufferId="${bufferId}"`);
    return undefined;
  }
  return loadPfmFile(file);
}

async function loadPfmFile(file: JSZip.JSZipObject): Promise<WarpMap | undefined> {
  try {
    const buf = await file.async('arraybuffer');
    const pfm = parsePFM(buf);
    const data = normalizeWarpData(pfm);
    return { width: pfm.width, height: pfm.height, data, path: file.name };
  } catch (err: any) {
    diag(`    PFM parse error for ${file.name}: ${err.message}`);
    return undefined;
  }
}

async function loadBlendMaps(
  zip: JSZip,
  regionEl: Element,
  doc: Document,
  bufferId: string,
  regionId: string,
  allPngFiles: JSZip.JSZipObject[]
): Promise<BlendMapSet> {
  const result: BlendMapSet = {};

  // Strategy 1: Direct XML references
  const alphaEl = regionEl.querySelector('alphaMap, AlphaMap, distortionMap');
  if (alphaEl) {
    const path = resolveFilePath(alphaEl, bufferId);
    diag(`    Alpha path from XML: "${path}"`);
    result.alphaMap = await loadBlendFile(zip, path, bufferId);
  }

  const betaEl = regionEl.querySelector('betaMap, BetaMap');
  if (betaEl) {
    const path = resolveFilePath(betaEl, bufferId);
    result.betaMap = await loadBlendFile(zip, path, bufferId);
  }

  const blEl = regionEl.querySelector('blackLevelMap, BlackLevelMap');
  if (blEl) {
    const path = resolveFilePath(blEl, bufferId);
    result.blackLevelMap = await loadBlendFile(zip, path, bufferId);
  }

  // Strategy 2: Search entire doc for alpha maps referencing this region
  if (!result.alphaMap) {
    const allAlphaEls = doc.querySelectorAll('alphaMap, AlphaMap');
    for (const el of allAlphaEls) {
      const path = resolveFilePath(el, bufferId);
      if (path && path.toLowerCase().includes(regionId.toLowerCase())) {
        result.alphaMap = await loadBlendFile(zip, path, bufferId);
        if (result.alphaMap) break;
      }
    }
  }

  // Strategy 3: Match PNG filename to region ID
  if (!result.alphaMap) {
    const regionLower = regionId.toLowerCase();
    for (const pngFile of allPngFiles) {
      const nameLower = pngFile.name.toLowerCase();
      if (nameLower.includes(regionLower) &&
          (nameLower.includes('alpha') || nameLower.includes('blend'))) {
        diag(`    Alpha PNG match: ${pngFile.name}`);
        const buf = await pngFile.async('arraybuffer');
        result.alphaMap = await loadPngAsBlendMap(buf, pngFile.name);
        break;
      }
    }
  }

  // Strategy 4: Match PNG to region by name without requiring alpha/blend keyword
  if (!result.alphaMap) {
    const regionLower = regionId.toLowerCase();
    for (const pngFile of allPngFiles) {
      if (pngFile.name.toLowerCase().includes(regionLower)) {
        diag(`    PNG region name match: ${pngFile.name}`);
        const buf = await pngFile.async('arraybuffer');
        result.alphaMap = await loadPngAsBlendMap(buf, pngFile.name);
        break;
      }
    }
  }

  return result;
}

async function loadBlendFile(
  zip: JSZip,
  path: string,
  bufferId: string
): Promise<import('../model/types').BlendMap | undefined> {
  const file = findInZip(zip, path, bufferId);
  if (!file) {
    diag(`    Blend file not found: "${path}"`);
    return undefined;
  }
  const buf = await file.async('arraybuffer');
  return loadPngAsBlendMap(buf, file.name);
}

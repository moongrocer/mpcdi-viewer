import JSZip from 'jszip';
import type {
  MpcdiProject, MpcdiBuffer, Region, Frustum,
  WarpMap, BlendMap, BlendMapSet, MpcdiProfile,
} from '../model/types';
import { parsePFM, normalizeWarpData, computeWarpStats } from './pfm';
import { loadPngAsBlendMap } from './png';

export const parseDiag: string[] = [];
function diag(msg: string) {
  parseDiag.push(msg);
  console.log(`[MPCDI] ${msg}`);
}

/**
 * Parse an MPCDI package (a zip archive with a .mpcdi extension).
 *
 * Real-world layout, per the MPCDI 2.0 spec:
 *
 *   <MPCDI profile="2d" version="2.0">
 *     <display>
 *       <buffer id="..."><region id="R1" .../></buffer>
 *     </display>
 *     <files>
 *       <fileset region="R1">
 *         <geometryWarpFile><path>...pfm</path></geometryWarpFile>
 *         <alphaMap><path>...png</path><gammaEmbedded>2.2</gammaEmbedded></alphaMap>
 *       </fileset>
 *     </files>
 *   </MPCDI>
 *
 * Note the file references live in a SEPARATE <files> tree keyed by
 * region id — they are not children of <region>. That indirection is
 * the single most common reason a naive parser reports "no warp map".
 */
export async function parseMpcdiPackage(file: File): Promise<MpcdiProject> {
  parseDiag.length = 0;
  const zip = await JSZip.loadAsync(file);

  const entries = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  diag(`Archive: ${entries.length} file(s)`);
  entries.forEach(n => diag(`  ${n}`));

  const xmlFile =
    zip.file('mpcdi.xml') ?? zip.file('MPCDI.xml') ?? zip.file(/\.xml$/i)[0];
  if (!xmlFile) throw new Error('No XML manifest found in MPCDI package');
  diag(`Manifest: ${xmlFile.name}`);

  const doc = new DOMParser().parseFromString(await xmlFile.async('string'), 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`XML parse error: ${err.textContent?.slice(0, 200)}`);

  const root = doc.documentElement;
  const profile = (root.getAttribute('profile') ?? '2d') as MpcdiProfile;
  const version = root.getAttribute('version') ?? '2.0';
  const date = root.getAttribute('date') ?? undefined;
  diag(`profile=${profile} version=${version} date=${date ?? '—'}`);

  // ── Index the <files> tree by region id ────────────────────────
  const filesetIndex = indexFilesets(doc);
  diag(`Filesets indexed: ${[...filesetIndex.keys()].join(', ') || 'none'}`);

  const displayEl = root.querySelector('display') ?? root;
  const buffers: MpcdiBuffer[] = [];

  for (const bufEl of displayEl.querySelectorAll('buffer')) {
    const bufferId = bufEl.getAttribute('id') ?? 'default';
    const bxRes = intAttr(bufEl, 'xResolution', 1920);
    const byRes = intAttr(bufEl, 'yResolution', 1080);
    diag(`buffer "${bufferId}" ${bxRes}x${byRes}`);

    const regions: Region[] = [];

    for (const regEl of bufEl.querySelectorAll('region')) {
      const id = regEl.getAttribute('id') ?? 'default';
      const x = floatAttr(regEl, 'x', 0);
      const y = floatAttr(regEl, 'y', 0);
      const xSize = floatAttr(regEl, 'xSize', 1);
      const ySize = floatAttr(regEl, 'ySize', 1);
      const xResolution = intAttr(regEl, 'xResolution', bxRes);
      const yResolution = intAttr(regEl, 'yResolution', byRes);
      diag(`  region "${id}" rect=(${x.toFixed(6)}, ${y.toFixed(6)}, ${xSize.toFixed(6)}, ${ySize.toFixed(6)}) res=${xResolution}x${yResolution}`);

      const fileset = filesetIndex.get(id);
      if (!fileset) diag(`    no <fileset region="${id}"> — will fall back to filename matching`);

      const warpMap = await resolveWarpMap(zip, fileset, id, bufferId);
      const blendMaps = await resolveBlendMaps(zip, fileset, id, bufferId);

      if (warpMap) {
        const s = warpMap.stats;
        diag(`    warp ${warpMap.width}x${warpMap.height} from ${warpMap.path}`);
        diag(`      U range [${s.minX.toFixed(6)}, ${s.maxX.toFixed(6)}]`);
        diag(`      V range [${s.minY.toFixed(6)}, ${s.maxY.toFixed(6)}]`);
        diag(`      unmapped (NaN): ${s.nanCount} (${(100 * s.nanCount / s.totalTexels).toFixed(2)}%)`);
        diag(`      interpretation: ${s.looksNormalized ? 'normalized [0,1]' : 'ABSOLUTE pixels'}`);

        // Cross-check the measured UV span against the declared region
        // rect. A match confirms the warp is in full-display content
        // space rather than region-local space.
        const dx = Math.abs(s.minX - x) + Math.abs(s.maxX - (x + xSize));
        if (s.looksNormalized && dx < 0.01) {
          diag(`      ✓ U span matches region rect → content-space UVs`);
        }
      } else {
        diag(`    ✗ no warp map resolved`);
      }
      if (blendMaps.alphaMap) diag(`    alpha ${blendMaps.alphaMap.width}x${blendMaps.alphaMap.height} gamma=${blendMaps.alphaMap.gammaEmbedded ?? '—'}`);

      regions.push({
        id, x, y, xSize, ySize, xResolution, yResolution,
        frustum: parseFrustum(regEl.querySelector('frustum')),
        warpMap, blendMaps,
      });
    }

    buffers.push({ id: bufferId, xResolution: bxRes, yResolution: byRes, regions });
  }

  return { profile, version, date, buffers };
}

/** Build a map of region id → its <fileset> element. */
function indexFilesets(doc: Document): Map<string, Element> {
  const index = new Map<string, Element>();
  for (const fs of doc.querySelectorAll('fileset')) {
    const region = fs.getAttribute('region');
    if (region) index.set(region, fs);
  }
  return index;
}

// ── Warp resolution ──────────────────────────────────────────────────

async function resolveWarpMap(
  zip: JSZip, fileset: Element | undefined, regionId: string, bufferId: string
): Promise<WarpMap | undefined> {
  // 1. Declared path inside the region's fileset — the correct route.
  if (fileset) {
    const el = fileset.querySelector('geometryWarpFile');
    const path = el ? readPath(el) : '';
    if (path) {
      const f = findInZip(zip, path, bufferId);
      if (f) return loadPfm(f);
      diag(`    declared warp path not in archive: "${path}"`);
    }
  }

  // 2. Fall back to matching a .pfm filename against the region id.
  const pfms = zip.file(/\.pfm$/i);
  const hit = pfms.find(f => f.name.toLowerCase().includes(regionId.toLowerCase()));
  if (hit) return loadPfm(hit);

  // 3. Single unambiguous .pfm in the package.
  if (pfms.length === 1) return loadPfm(pfms[0]);

  return undefined;
}

async function loadPfm(f: JSZip.JSZipObject): Promise<WarpMap | undefined> {
  try {
    const pfm = parsePFM(await f.async('arraybuffer'));
    const data = normalizeWarpData(pfm);
    return {
      width: pfm.width,
      height: pfm.height,
      data,
      path: f.name,
      stats: computeWarpStats(data, pfm.width, pfm.height),
    };
  } catch (e: any) {
    diag(`    PFM parse failed for ${f.name}: ${e.message}`);
    return undefined;
  }
}

// ── Blend map resolution ─────────────────────────────────────────────

async function resolveBlendMaps(
  zip: JSZip, fileset: Element | undefined, regionId: string, bufferId: string
): Promise<BlendMapSet> {
  const out: BlendMapSet = {};

  if (fileset) {
    out.alphaMap = await loadDeclared(zip, fileset.querySelector('alphaMap'), bufferId);
    out.betaMap = await loadDeclared(zip, fileset.querySelector('betaMap'), bufferId);
    out.blackLevelMap = await loadDeclared(zip, fileset.querySelector('blackLevelMap'), bufferId);
  }

  // Filename fallback for the alpha map only — beta and black-level are
  // rare enough that guessing does more harm than good.
  if (!out.alphaMap) {
    const pngs = zip.file(/\.png$/i);
    const hit = pngs.find(f => {
      const n = f.name.toLowerCase();
      return n.includes(regionId.toLowerCase()) && n.includes('alpha');
    }) ?? (pngs.length === 1 ? pngs[0] : undefined);
    if (hit) out.alphaMap = await loadPngAsBlendMap(await hit.async('arraybuffer'), hit.name);
  }

  return out;
}

async function loadDeclared(
  zip: JSZip, el: Element | null, bufferId: string
): Promise<BlendMap | undefined> {
  if (!el) return undefined;
  const path = readPath(el);
  if (!path) return undefined;
  const f = findInZip(zip, path, bufferId);
  if (!f) { diag(`    declared map not in archive: "${path}"`); return undefined; }

  const map = await loadPngAsBlendMap(await f.async('arraybuffer'), f.name);
  const g = el.querySelector('gammaEmbedded')?.textContent;
  if (g) map.gammaEmbedded = parseFloat(g);
  return map;
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Read a file path: nested <path> child, path attribute, or text. */
function readPath(el: Element): string {
  return (
    el.querySelector('path')?.textContent?.trim() ||
    el.getAttribute('path')?.trim() ||
    el.textContent?.trim() ||
    ''
  );
}

/** Locate a file in the zip, tolerating directory prefixes and case. */
function findInZip(zip: JSZip, path: string, bufferId: string): JSZip.JSZipObject | null {
  if (!path) return null;
  const direct = zip.file(path) ?? (bufferId ? zip.file(`${bufferId}/${path}`) : null);
  if (direct) return direct;

  const base = (path.split('/').pop() ?? path).toLowerCase();
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!entry.dir && name.toLowerCase().endsWith(base)) return entry;
  }
  return null;
}

function intAttr(el: Element, name: string, fallback: number): number {
  const v = el.getAttribute(name);
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function floatAttr(el: Element, name: string, fallback: number): number {
  const v = el.getAttribute(name);
  const n = v ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function parseFrustum(el: Element | null): Frustum | undefined {
  if (!el) return undefined;
  const f = (tag: string) => {
    const c = el.querySelector(tag);
    return c ? parseFloat(c.textContent ?? '0') : 0;
  };
  return {
    yaw: f('yaw'), pitch: f('pitch'), roll: f('roll'),
    rightAngle: f('rightAngle'), leftAngle: f('leftAngle'),
    upAngle: f('upAngle'), downAngle: f('downAngle'),
  };
}

// ── Standalone PFM loading (manual override) ─────────────────────────

export async function loadStandalonePfm(file: File): Promise<WarpMap> {
  const pfm = parsePFM(await file.arrayBuffer());
  const data = normalizeWarpData(pfm);
  return {
    width: pfm.width,
    height: pfm.height,
    data,
    path: file.name,
    stats: computeWarpStats(data, pfm.width, pfm.height),
  };
}

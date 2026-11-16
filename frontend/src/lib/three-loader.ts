import { unzipSync } from "fflate";
import type * as THREEType from "three";

export const THREE_ACCEPT = ".glb,.gltf,.stl,.obj,.mtl,.ply,.fbx,.dae,.3mf,.pcd,.xyz,.zip,.bin,.png,.jpg,.jpeg,.webp,.tga";
export const THREE_FORMATS_LABEL = "GLB · GLTF · STL · OBJ (+MTL) · FBX · PLY · 3MF · DAE · PCD · XYZ · ZIP bundle";
export const THREE_MAX_MB = 150;

export type MeshNodeInfo = {
  uuid: string;
  name: string;
  triangles: number;
  vertices: number;
  materialNames: string[];
  visible: boolean;
};

export type ModelStats = {
  vertices: number;
  triangles: number;
  meshes: number;
  materials: number;
  textures: number;
  animations: number;
  hasVertexColors: boolean;
  hasNormals: boolean;
  size: [number, number, number];
  center: [number, number, number];
  nodes: MeshNodeInfo[];
};

export type LoadedModel = {
  root: THREEType.Group;
  animations: THREEType.AnimationClip[];
  stats: ModelStats;
  format: string;
  fileName: string;
  totalBytes: number;
  bundledFiles: number;
  warnings: string[];
};

const MODEL_PRIORITY = ["glb", "gltf", "fbx", "dae", "3mf", "obj", "stl", "ply", "pcd", "xyz"] as const;

const extOf = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";

function normalizeAssetKey(p: string): string {
  return decodeURIComponent(p.split("?")[0].split("#")[0])
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .toLowerCase();
}

function guessMimeType(name: string): string {
  const e = extOf(name);
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    bin: "application/octet-stream",
    mtl: "text/plain",
    obj: "text/plain",
    stl: "application/sla",
  };
  return map[e] ?? "application/octet-stream";
}

async function collectFileEntries(inputFiles: File[]): Promise<{
  entries: Map<string, Blob>;
  totalBytes: number;
  bundledFiles: number;
}> {
  const entries = new Map<string, Blob>();
  let totalBytes = 0;

  for (const f of inputFiles) {
    totalBytes += f.size;
  }
  if (totalBytes > THREE_MAX_MB * 1024 * 1024) {
    throw new Error(`Upload is over ${THREE_MAX_MB} MB total.`);
  }

  if (inputFiles.length === 1 && extOf(inputFiles[0].name) === "zip") {
    const raw = new Uint8Array(await inputFiles[0].arrayBuffer());
    const unpacked = unzipSync(raw);
    for (const [path, data] of Object.entries(unpacked)) {
      if (path.endsWith("/") || path.startsWith("__MACOSX/") || data.length === 0) continue;
      const copy = new Uint8Array(data.byteLength);
      copy.set(data);
      entries.set(normalizeAssetKey(path), new Blob([copy.buffer], { type: guessMimeType(path) }));
    }
    return { entries, totalBytes, bundledFiles: entries.size };
  }

  for (const f of inputFiles) {
    const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
    entries.set(normalizeAssetKey(rel), f);
  }
  return { entries, totalBytes, bundledFiles: entries.size };
}

function findPrimaryModelKey(entries: Map<string, Blob>): { key: string; ext: string } | null {
  for (const targetExt of MODEL_PRIORITY) {
    for (const key of entries.keys()) {
      if (extOf(key) === targetExt) {
        return { key, ext: targetExt };
      }
    }
  }
  return null;
}

export function inspectObjectTree(root: THREEType.Object3D, animations: THREEType.AnimationClip[], THREE: typeof THREEType): ModelStats {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const sizeVec = new THREE.Vector3();
  const centerVec = new THREE.Vector3();
  if (!box.isEmpty()) {
    box.getSize(sizeVec);
    box.getCenter(centerVec);
  }

  let vertices = 0;
  let triangles = 0;
  let meshes = 0;
  let hasVertexColors = false;
  let hasNormals = false;
  const matSet = new Set<string>();
  const texSet = new Set<string>();
  const nodes: MeshNodeInfo[] = [];

  root.traverse((obj) => {
    const maybeMesh = obj as THREEType.Mesh | THREEType.Points | THREEType.Line;
    if (!(maybeMesh as THREEType.Mesh).isMesh && !(maybeMesh as THREEType.Points).isPoints) return;
    const geom = maybeMesh.geometry;
    if (!geom) return;
    const pos = geom.getAttribute("position");
    if (!pos) return;

    meshes += 1;
    const vCount = pos.count;
    vertices += vCount;

    let tCount = 0;
    if ((maybeMesh as THREEType.Mesh).isMesh) {
      tCount = geom.index ? Math.round(geom.index.count / 3) : Math.round(vCount / 3);
      triangles += tCount;
    }

    if (geom.getAttribute("color")) hasVertexColors = true;
    if (geom.getAttribute("normal")) hasNormals = true;

    const rawMat = (maybeMesh as THREEType.Mesh).material;
    const mats = Array.isArray(rawMat) ? rawMat : rawMat ? [rawMat] : [];
    const materialNames: string[] = [];
    for (const m of mats) {
      if (!m) continue;
      matSet.add(m.uuid);
      if (m.name) materialNames.push(m.name);
      const std = m as THREEType.MeshStandardMaterial;
      for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap, std.emissiveMap]) {
        if (tex) texSet.add(tex.uuid);
      }
    }

    nodes.push({
      uuid: obj.uuid,
      name: obj.name || `Mesh ${meshes}`,
      triangles: tCount,
      vertices: vCount,
      materialNames,
      visible: obj.visible,
    });
  });

  return {
    vertices,
    triangles,
    meshes,
    materials: matSet.size,
    textures: texSet.size,
    animations: animations.length,
    hasVertexColors,
    hasNormals,
    size: [sizeVec.x, sizeVec.y, sizeVec.z],
    center: [centerVec.x, centerVec.y, centerVec.z],
    nodes,
  };
}

/** Ensures geometry without normals gets computed normals and lifts model so its floor sits cleanly at y=0 centered on X/Z. */
function prepareLoadedRoot(root: THREEType.Object3D, THREE: typeof THREEType) {
  root.traverse((obj) => {
    const mesh = obj as THREEType.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      if (!mesh.geometry.getAttribute("normal")) {
        mesh.geometry.computeVertexNormals();
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }
  });
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  if (!box.isEmpty()) {
    const center = box.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= box.min.y;
  }
}

export async function loadModelFromFiles(inputFiles: File[]): Promise<LoadedModel> {
  const THREE = await import("three");
  const { entries, totalBytes, bundledFiles } = await collectFileEntries(inputFiles);
  const primary = findPrimaryModelKey(entries);
  if (!primary) {
    throw new Error("No supported 3D model found (.glb, .gltf, .stl, .obj, .fbx, .ply, .3mf, .dae, .pcd, .xyz).");
  }

  const blobUrls = new Map<string, string>();
  const createdUrls: string[] = [];
  for (const [k, blob] of entries.entries()) {
    const u = URL.createObjectURL(blob);
    blobUrls.set(k, u);
    createdUrls.push(u);
  }

  const resolveBlobUrl = (url: string): string => {
    if (/^(data:|blob:)/i.test(url)) return url;
    const norm = normalizeAssetKey(url);
    if (blobUrls.has(norm)) return blobUrls.get(norm)!;
    // Try basename fallback (common when OBJ/MTL/GLTF references relative paths like textures/albedo.png).
    const base = norm.split("/").pop() ?? norm;
    for (const [k, v] of blobUrls.entries()) {
      if (k === base || k.endsWith(`/${base}`)) return v;
    }
    return url;
  };

  const warnings: string[] = [];
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(resolveBlobUrl);

  const mainUrl = blobUrls.get(primary.key)!;
  const group = new THREE.Group();
  let animations: THREEType.AnimationClip[] = [];

  try {
    if (primary.ext === "glb" || primary.ext === "gltf") {
      const [{ GLTFLoader }, { DRACOLoader }] = await Promise.all([
        import("three/examples/jsm/loaders/GLTFLoader.js"),
        import("three/examples/jsm/loaders/DRACOLoader.js"),
      ]);
      const loader = new GLTFLoader(manager);
      const draco = new DRACOLoader(manager);
      draco.setDecoderPath("/vendor/draco/");
      loader.setDRACOLoader(draco);
      try {
        const gltf = await loader.loadAsync(mainUrl);
        group.add(gltf.scene);
        animations = gltf.animations ?? [];
      } finally {
        draco.dispose();
      }
    } else if (primary.ext === "stl") {
      const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
      const geom = await new STLLoader(manager).loadAsync(mainUrl);
      const hasColor = Boolean(geom.getAttribute("color"));
      const mat = new THREE.MeshStandardMaterial({
        color: hasColor ? 0xffffff : 0xc5bfb3,
        vertexColors: hasColor,
        roughness: 0.45,
        metalness: 0.12,
      });
      const mesh = new THREE.Mesh(geom, mat);
      mesh.name = primary.key.split("/").pop() ?? "STL Mesh";
      group.add(mesh);
    } else if (primary.ext === "obj") {
      const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
      const objLoader = new OBJLoader(manager);
      const mtlEntry = Array.from(entries.keys()).find((k) => extOf(k) === "mtl");
      if (mtlEntry) {
        const { MTLLoader } = await import("three/examples/jsm/loaders/MTLLoader.js");
        const mtlLoader = new MTLLoader(manager);
        const mtlCreator = await mtlLoader.loadAsync(blobUrls.get(mtlEntry)!);
        mtlCreator.preload();
        objLoader.setMaterials(mtlCreator);
      } else {
        warnings.push("Loaded without an .mtl material file (using default clay surface). Drop the .mtl & textures alongside .obj if available.");
      }
      const obj = await objLoader.loadAsync(mainUrl);
      group.add(obj);
    } else if (primary.ext === "ply") {
      const { PLYLoader } = await import("three/examples/jsm/loaders/PLYLoader.js");
      const geom = await new PLYLoader(manager).loadAsync(mainUrl);
      const hasColor = Boolean(geom.getAttribute("color"));
      if (!geom.index && geom.getAttribute("position") && !geom.getAttribute("normal")) {
        const pts = new THREE.Points(
          geom,
          new THREE.PointsMaterial({ size: 0.03, vertexColors: hasColor, color: hasColor ? 0xffffff : 0x57544a }),
        );
        pts.name = primary.key.split("/").pop() ?? "PLY Point Cloud";
        group.add(pts);
      } else {
        const mesh = new THREE.Mesh(
          geom,
          new THREE.MeshStandardMaterial({
            color: hasColor ? 0xffffff : 0xc5bfb3,
            vertexColors: hasColor,
            roughness: 0.5,
            metalness: 0.1,
          }),
        );
        mesh.name = primary.key.split("/").pop() ?? "PLY Mesh";
        group.add(mesh);
      }
    } else if (primary.ext === "fbx") {
      const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
      const fbx = await new FBXLoader(manager).loadAsync(mainUrl);
      group.add(fbx);
      animations = (fbx as unknown as { animations?: THREEType.AnimationClip[] }).animations ?? [];
    } else if (primary.ext === "dae") {
      const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
      const collada = await new ColladaLoader(manager).loadAsync(mainUrl);
      group.add(collada.scene);
      animations = (collada.scene as unknown as { animations?: THREEType.AnimationClip[] }).animations ?? [];
    } else if (primary.ext === "3mf") {
      const { ThreeMFLoader } = await import("three/examples/jsm/loaders/3MFLoader.js");
      const tm = await new ThreeMFLoader(manager).loadAsync(mainUrl);
      group.add(tm);
    } else if (primary.ext === "pcd") {
      const { PCDLoader } = await import("three/examples/jsm/loaders/PCDLoader.js");
      const pcd = await new PCDLoader(manager).loadAsync(mainUrl);
      group.add(pcd);
    } else if (primary.ext === "xyz") {
      const { XYZLoader } = await import("three/examples/jsm/loaders/XYZLoader.js");
      const geom = await new XYZLoader(manager).loadAsync(mainUrl);
      const hasColor = Boolean(geom.getAttribute("color"));
      const pts = new THREE.Points(
        geom,
        new THREE.PointsMaterial({ size: 0.03, vertexColors: hasColor, color: hasColor ? 0xffffff : 0xeb4a10 }),
      );
      pts.name = primary.key.split("/").pop() ?? "XYZ Cloud";
      group.add(pts);
    }

    prepareLoadedRoot(group, THREE);
    const stats = inspectObjectTree(group, animations, THREE);
    if (stats.vertices === 0) {
      throw new Error("The 3D file loaded without any drawable geometry vertices.");
    }

    return {
      root: group,
      animations,
      stats,
      format: primary.ext.toUpperCase(),
      fileName: primary.key.split("/").pop() ?? primary.key,
      totalBytes,
      bundledFiles,
      warnings,
    };
  } finally {
    // Allow internal texture decode microtasks before revoking blob URLs safely.
    setTimeout(() => {
      for (const u of createdUrls) URL.revokeObjectURL(u);
    }, 3000);
  }
}

export async function createSampleModel(kind: "gear" | "knot"): Promise<LoadedModel> {
  const THREE = await import("three");
  const root = new THREE.Group();
  root.name = kind === "gear" ? "Planetary-Gear-Sample" : "Sculptural-Torus-Sample";

  if (kind === "knot") {
    const outer = new THREE.Mesh(
      new THREE.TorusKnotGeometry(1.15, 0.36, 220, 32, 2, 3),
      new THREE.MeshStandardMaterial({ color: 0xeb4a10, roughness: 0.28, metalness: 0.35 }),
    );
    outer.name = "Knot-Ribbon";

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.42, 2),
      new THREE.MeshStandardMaterial({ color: 0x26241d, roughness: 0.2, metalness: 0.85 }),
    );
    core.name = "Inner-Core";

    const pedestal = new THREE.Mesh(
      new THREE.CylinderGeometry(1.65, 1.8, 0.16, 64),
      new THREE.MeshStandardMaterial({ color: 0xdad5c8, roughness: 0.7, metalness: 0.05 }),
    );
    pedestal.name = "Studio-Plinth";
    pedestal.position.y = -1.65;

    root.add(outer, core, pedestal);
  } else {
    const steelMat = new THREE.MeshStandardMaterial({ color: 0x57544a, roughness: 0.35, metalness: 0.75 });
    const brassMat = new THREE.MeshStandardMaterial({ color: 0xc98a2c, roughness: 0.25, metalness: 0.85 });
    const accentMat = new THREE.MeshStandardMaterial({ color: 0xeb4a10, roughness: 0.35, metalness: 0.4 });
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x23221c, roughness: 0.65, metalness: 0.2 });

    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.85, 0.22, 24, 72), baseMat);
    ring.rotation.x = Math.PI / 2;
    ring.name = "Outer-Housing-Ring";
    root.add(ring);

    const sun = new THREE.Mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.46, 36), brassMat);
    sun.name = "Sun-Gear-Hub";
    root.add(sun);

    const sunCap = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.64, 24), accentMat);
    sunCap.name = "Center-Shaft";
    root.add(sunCap);

    for (let i = 0; i < 3; i++) {
      const ang = (i * Math.PI * 2) / 3;
      const planet = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.38, 28), steelMat);
      planet.position.set(Math.cos(ang) * 1.18, 0, Math.sin(ang) * 1.18);
      planet.name = `Planet-Gear-${i + 1}`;

      const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.56, 16), accentMat);
      pin.position.copy(planet.position);
      pin.name = `Bearing-Pin-${i + 1}`;
      root.add(planet, pin);
    }
  }

  prepareLoadedRoot(root, THREE);
  const stats = inspectObjectTree(root, [], THREE);
  return {
    root,
    animations: [],
    stats,
    format: "3D SAMPLE",
    fileName: kind === "gear" ? "planetary-gear-assembly.glb" : "sculptural-knot.glb",
    totalBytes: 0,
    bundledFiles: 1,
    warnings: [],
  };
}

export function disposeObjectTree(root: THREEType.Object3D) {
  root.traverse((obj) => {
    const mesh = obj as THREEType.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const raw = mesh.material;
    const mats = Array.isArray(raw) ? raw : raw ? [raw] : [];
    for (const m of mats) {
      const std = m as THREEType.MeshStandardMaterial;
      for (const tex of [std.map, std.normalMap, std.roughnessMap, std.metalnessMap, std.aoMap, std.emissiveMap]) {
        if (tex) tex.dispose();
      }
      m.dispose();
    }
  });
}

export async function exportModelAsGlb(root: THREEType.Object3D, animations: THREEType.AnimationClip[]): Promise<Blob> {
  const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
  const exporter = new GLTFExporter();
  const buffer = await exporter.parseAsync(root, { binary: true, animations, onlyVisible: true });
  return new Blob([buffer as ArrayBuffer], { type: "model/gltf-binary" });
}

export async function exportModelAsStl(root: THREEType.Object3D): Promise<Blob> {
  const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
  const data = new STLExporter().parse(root, { binary: true }) as DataView;
  const copy = new Uint8Array(data.byteLength);
  copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return new Blob([copy.buffer], { type: "model/stl" });
}

export async function exportModelAsObj(root: THREEType.Object3D): Promise<Blob> {
  const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js");
  const text = new OBJExporter().parse(root);
  return new Blob([text], { type: "text/plain;charset=utf-8" });
}

export async function exportPreparedModel(
  root: THREEType.Object3D,
  fmt: "glb" | "stl" | "obj",
  opts: {
    originalMaterials?: Map<string, THREEType.Material | THREEType.Material[]>;
    wireEdges?: THREEType.LineSegments[];
    animations?: THREEType.AnimationClip[];
  },
): Promise<Blob> {
  const savedMats = new Map<THREEType.Mesh, THREEType.Material | THREEType.Material[]>();
  const savedWireVis = new Map<THREEType.LineSegments, boolean>();
  try {
    if (fmt === "glb" && opts.originalMaterials) {
      root.traverse((obj) => {
        const mesh = obj as THREEType.Mesh;
        if (mesh.isMesh) {
          const orig = opts.originalMaterials?.get(mesh.uuid);
          if (orig) {
            savedMats.set(mesh, mesh.material);
            mesh.material = orig;
          }
        }
      });
    }
    for (const edge of opts.wireEdges ?? []) {
      savedWireVis.set(edge, edge.visible);
      edge.visible = false;
    }
    if (fmt === "glb") return await exportModelAsGlb(root, opts.animations ?? []);
    if (fmt === "stl") return await exportModelAsStl(root);
    return await exportModelAsObj(root);
  } finally {
    for (const [mesh, mat] of savedMats.entries()) {
      mesh.material = mat;
    }
    for (const [edge, vis] of savedWireVis.entries()) {
      edge.visible = vis;
    }
  }
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as THREEType from "three";
import {
  Box,
  Camera,
  Download,
  Eye,
  EyeOff,
  Focus,
  Grid,
  Layers,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Scissors,
  SlidersHorizontal,
  Sparkles,
  Sun,
} from "lucide-react";
import { saveBlob } from "@/lib/files";
import { formatBytes } from "@/lib/media";
import {
  createSampleModel,
  disposeObjectTree,
  exportPreparedModel,
  inspectObjectTree,
  loadModelFromFiles,
  THREE_ACCEPT,
  THREE_FORMATS_LABEL,
  THREE_MAX_MB,
  type LoadedModel,
  type MeshNodeInfo,
  type ModelStats,
} from "@/lib/three-loader";
import { getTool, stepsFor } from "@/lib/tools";
import { cn } from "@/lib/utils";
import { FileDrop } from "../file-drop";
import { Workbench } from "../workbench";
import { Chips, Notice, Panel, Row, Slider, Toggle } from "../pdf/kit";

type ShadingMode = "pbr" | "clay" | "wireframe" | "normals" | "xray";
type BackdropMode = "paper" | "neutral" | "charcoal" | "checker";
type LightingPreset = "studio" | "rim" | "flat" | "warm";
type CameraView = "iso" | "front" | "back" | "left" | "right" | "top";
type InspectorTab = "display" | "transform" | "tree" | "stats";
type SliceAxis = "off" | "x" | "y" | "z";
type UnitScale = "units" | "mm" | "cm" | "m" | "in";

const BACKDROP_STYLES: Record<BackdropMode, { label: string; hex: string | null; darkGrid: boolean; css: string }> = {
  paper: { label: "Paper light", hex: "#f3f0e8", darkGrid: false, css: "bg-paper" },
  neutral: { label: "Studio mist", hex: "#e2dfd7", darkGrid: false, css: "bg-[#e2dfd7]" },
  charcoal: { label: "Charcoal", hex: "#1b1a16", darkGrid: true, css: "bg-[#1b1a16]" },
  checker: {
    label: "Transparent",
    hex: null,
    darkGrid: false,
    css: "bg-[radial-gradient(#dad5c8_1px,transparent_1px)] [background-size:16px_16px] bg-surface",
  },
};

const UNIT_FACTORS: Record<UnitScale, number> = {
  units: 1,
  mm: 1,
  cm: 0.1,
  m: 0.001,
  in: 1 / 25.4,
};

function formatDim(n: number): string {
  if (n >= 100) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

type ModelMeta = {
  seq: number;
  format: string;
  fileName: string;
  totalBytes: number;
  bundledFiles: number;
  warnings: string[];
  animations: { name: string; duration: number }[];
  stats: ModelStats;
};

export function ThreeViewerTool({ toolId }: { toolId: string }) {
  const tool = getTool(toolId)!;
  const [loaded, setLoaded] = useState<ModelMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<THREEType.Group | null>(null);
  const animationsRef = useRef<THREEType.AnimationClip[]>([]);

  // Viewport controls
  const [tab, setTab] = useState<InspectorTab>("display");
  const [shading, setShading] = useState<ShadingMode>("pbr");
  const [wireOverlay, setWireOverlay] = useState(false);
  const [doubleSided, setDoubleSided] = useState(false);
  const [flatShading, setFlatShading] = useState(false);
  const [backdrop, setBackdrop] = useState<BackdropMode>("paper");
  const [lighting, setLighting] = useState<LightingPreset>("studio");
  const [exposure, setExposure] = useState(1.1);
  const [showGrid, setShowGrid] = useState(true);
  const [showAxes, setShowAxes] = useState(true);
  const [showBbox, setShowBbox] = useState(false);
  const [shadows, setShadows] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [autoRotateSpeed, setAutoRotateSpeed] = useState(1.5);
  const [ortho, setOrtho] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // Orientation & slice
  const [sliceAxis, setSliceAxis] = useState<SliceAxis>("off");
  const [slicePct, setSlicePct] = useState(50);
  const [sliceFlip, setSliceFlip] = useState(false);
  const [unit, setUnit] = useState<UnitScale>("units");

  // Hierarchy / animations
  const [nodes, setNodes] = useState<MeshNodeInfo[]>([]);
  const [treeSearch, setTreeSearch] = useState("");
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);
  const [animPlaying, setAnimPlaying] = useState(true);
  const [animIndex, setAnimIndex] = useState(0);
  const [animSpeed, setAnimSpeed] = useState(1);
  const [animProgress, setAnimProgress] = useState(0);
  const [exporting, setExporting] = useState<string | null>(null);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<{
    THREE: typeof THREEType;
    renderer: THREEType.WebGLRenderer;
    scene: THREEType.Scene;
    persp: THREEType.PerspectiveCamera;
    orthoCam: THREEType.OrthographicCamera;
    activeCam: THREEType.PerspectiveCamera | THREEType.OrthographicCamera;
    controls: import("three/examples/jsm/controls/OrbitControls.js").OrbitControls;
    keyLight: THREEType.DirectionalLight;
    fillLight: THREEType.DirectionalLight;
    hemiLight: THREEType.HemisphereLight;
    shadowFloor: THREEType.Mesh;
    grid: THREEType.GridHelper | null;
    axes: THREEType.AxesHelper | null;
    bboxHelper: THREEType.Box3Helper | null;
    clipPlane: THREEType.Plane;
    modelHolder: THREEType.Group;
    originalMaterials: Map<string, THREEType.Material | THREEType.Material[]>;
    syntheticMaterials: THREEType.Material[];
    wireEdges: THREEType.LineSegments[];
    mixer: THREEType.AnimationMixer | null;
    activeAction: THREEType.AnimationAction | null;
    modelRadius: number;
    modelCenter: THREEType.Vector3;
    modelBox: THREEType.Box3;
  } | null>(null);

  const animPlayingRef = useRef(animPlaying);
  const animSpeedRef = useRef(animSpeed);

  useEffect(() => {
    animPlayingRef.current = animPlaying;
    animSpeedRef.current = animSpeed;
  }, [animPlaying, animSpeed]);

  // Cleanup loaded model when swapping or unmounting
  const teardownLoaded = useCallback(() => {
    if (rootRef.current) {
      disposeObjectTree(rootRef.current);
      rootRef.current = null;
    }
    animationsRef.current = [];
  }, []);

  useEffect(() => () => teardownLoaded(), [teardownLoaded]);

  const applyLoadedResult = (next: LoadedModel) => {
    teardownLoaded();
    rootRef.current = next.root;
    animationsRef.current = next.animations;
    setLoaded((prev) => ({
      seq: (prev?.seq ?? 0) + 1,
      format: next.format,
      fileName: next.fileName,
      totalBytes: next.totalBytes,
      bundledFiles: next.bundledFiles,
      warnings: next.warnings,
      animations: next.animations.map((c) => ({ name: c.name, duration: c.duration })),
      stats: next.stats,
    }));
    setNodes(next.stats.nodes);
    setSelectedUuid(null);
    setSliceAxis("off");
    setSlicePct(50);
    setAnimIndex(0);
    setAnimPlaying(true);
  };

  const loadFiles = async (files: File[]) => {
    setError(null);
    setLoading(true);
    try {
      const next = await loadModelFromFiles(files);
      applyLoadedResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that 3D file.");
    } finally {
      setLoading(false);
    }
  };

  const loadSample = async (kind: "gear" | "knot") => {
    setError(null);
    setLoading(true);
    try {
      const next = await createSampleModel(kind);
      applyLoadedResult(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create sample scene.");
    } finally {
      setLoading(false);
    }
  };

  // Frame camera to a bounding box from a given normalized direction
  const frameBox = useCallback((box: THREEType.Box3, dirVec?: [number, number, number]) => {
    const eng = engineRef.current;
    if (!eng || box.isEmpty()) return;
    const { THREE, controls, persp, orthoCam, stage } = (() => ({
      THREE: eng.THREE,
      controls: eng.controls,
      persp: eng.persp,
      orthoCam: eng.orthoCam,
      stage: stageRef.current,
    }))();
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    const fov = THREE.MathUtils.degToRad(persp.fov);
    const dist = (maxDim / (2 * Math.tan(fov / 2))) * 1.48;

    const dir = dirVec
      ? new THREE.Vector3(...dirVec).normalize()
      : new THREE.Vector3(1, 0.72, 1.15).normalize();

    const pos = center.clone().addScaledVector(dir, dist);
    persp.position.copy(pos);
    persp.near = Math.max(dist * 0.001, 0.001);
    persp.far = Math.max(dist * 50, 200);
    persp.updateProjectionMatrix();

    const w = Math.max(1, stage?.clientWidth ?? 640);
    const h = Math.max(1, stage?.clientHeight ?? 480);
    const aspect = w / h;
    const halfH = maxDim * 0.82;
    orthoCam.left = -halfH * aspect;
    orthoCam.right = halfH * aspect;
    orthoCam.top = halfH;
    orthoCam.bottom = -halfH;
    orthoCam.near = -dist * 20;
    orthoCam.far = dist * 40;
    orthoCam.position.copy(pos);
    orthoCam.zoom = 1;
    orthoCam.updateProjectionMatrix();

    controls.target.copy(center);
    controls.minDistance = maxDim * 0.12;
    controls.maxDistance = maxDim * 18;
    controls.update();

    eng.modelCenter.copy(center);
    eng.modelRadius = maxDim;
  }, []);

  const setCameraPreset = useCallback(
    (view: CameraView) => {
      const eng = engineRef.current;
      if (!eng) return;
      const box = new eng.THREE.Box3().setFromObject(eng.modelHolder);
      const dirs: Record<CameraView, [number, number, number]> = {
        iso: [1, 0.72, 1.15],
        front: [0, 0, 1],
        back: [0, 0, -1],
        right: [1, 0, 0],
        left: [-1, 0, 0],
        top: [0, 1, 0.001],
      };
      frameBox(box, dirs[view]);
    },
    [frameBox],
  );

  const modelSeq = loaded?.seq ?? 0;

  // Build / teardown WebGL scene whenever a new model loads
  useEffect(() => {
    const container = stageRef.current;
    const root = rootRef.current;
    const animations = animationsRef.current;
    if (!container || !root || modelSeq === 0) return;

    let dead = false;
    let raf = 0;
    let resizeObserver: ResizeObserver | null = null;
    let renderer: THREEType.WebGLRenderer | null = null;
    let envTarget: THREEType.WebGLRenderTarget | null = null;

    void (async () => {
      const [THREE, { OrbitControls }, { RoomEnvironment }] = await Promise.all([
        import("three"),
        import("three/examples/jsm/controls/OrbitControls.js"),
        import("three/examples/jsm/environments/RoomEnvironment.js"),
      ]);
      if (dead) return;

      const width = Math.max(300, container.clientWidth);
      const height = Math.max(320, container.clientHeight);

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(width, height, false);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.localClippingEnabled = true;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.domElement.className = "block h-full w-full touch-none outline-none";

      container.innerHTML = "";
      container.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const pmrem = new THREE.PMREMGenerator(renderer);
      const room = new RoomEnvironment();
      envTarget = pmrem.fromScene(room, 0.04);
      scene.environment = envTarget.texture;
      room.dispose();
      pmrem.dispose();

      const persp = new THREE.PerspectiveCamera(42, width / height, 0.01, 2000);
      const orthoCam = new THREE.OrthographicCamera(-2, 2, 2, -2, -100, 100);

      const controls = new OrbitControls(persp, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.07;

      // Lights
      const hemiLight = new THREE.HemisphereLight(0xffffff, 0x8a867a, 0.75);
      const keyLight = new THREE.DirectionalLight(0xfffcf5, 1.9);
      keyLight.position.set(6, 10, 8);
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.bias = -0.0005;

      const fillLight = new THREE.DirectionalLight(0xdce6f5, 0.7);
      fillLight.position.set(-7, 4, -6);

      scene.add(hemiLight, keyLight, fillLight);

      const modelHolder = new THREE.Group();
      modelHolder.add(root);
      scene.add(modelHolder);

      const modelBox = new THREE.Box3().setFromObject(modelHolder);
      const sizeVec = modelBox.getSize(new THREE.Vector3());
      const centerVec = modelBox.getCenter(new THREE.Vector3());
      const radius = Math.max(sizeVec.x, sizeVec.y, sizeVec.z, 0.5);

      // Adaptive shadow frustum + ground shadow receiver
      const shadowSpan = radius * 1.8;
      keyLight.shadow.camera.left = -shadowSpan;
      keyLight.shadow.camera.right = shadowSpan;
      keyLight.shadow.camera.top = shadowSpan;
      keyLight.shadow.camera.bottom = -shadowSpan;
      keyLight.shadow.camera.far = radius * 12;
      keyLight.position.set(radius * 1.4, radius * 2.2, radius * 1.6);

      const shadowFloor = new THREE.Mesh(
        new THREE.PlaneGeometry(radius * 10, radius * 10),
        new THREE.ShadowMaterial({ color: 0x15140f, opacity: 0.14 }),
      );
      shadowFloor.rotation.x = -Math.PI / 2;
      shadowFloor.position.y = modelBox.min.y - radius * 0.002;
      shadowFloor.receiveShadow = true;
      scene.add(shadowFloor);

      // Adaptive grid & helpers
      const gridSize = Math.pow(10, Math.ceil(Math.log10(Math.max(radius * 2.2, 1))));
      const grid = new THREE.GridHelper(gridSize, 20, 0x8a867a, 0xcbc5b7);
      grid.position.y = modelBox.min.y - radius * 0.001;
      scene.add(grid);

      const axes = new THREE.AxesHelper(radius * 0.8);
      scene.add(axes);

      const bboxHelper = new THREE.Box3Helper(modelBox, 0xeb4a10);
      bboxHelper.visible = false;
      scene.add(bboxHelper);

      const originalMaterials = new Map<string, THREEType.Material | THREEType.Material[]>();
      root.traverse((obj) => {
        const mesh = obj as THREEType.Mesh;
        if (mesh.isMesh && mesh.material) {
          originalMaterials.set(mesh.uuid, mesh.material);
        }
      });

      let mixer: THREEType.AnimationMixer | null = null;
      let activeAction: THREEType.AnimationAction | null = null;
      if (animations.length > 0) {
        mixer = new THREE.AnimationMixer(root);
        activeAction = mixer.clipAction(animations[0]);
        activeAction.play();
      }

      engineRef.current = {
        THREE,
        renderer,
        scene,
        persp,
        orthoCam,
        activeCam: persp,
        controls,
        keyLight,
        fillLight,
        hemiLight,
        shadowFloor,
        grid,
        axes,
        bboxHelper,
        clipPlane: new THREE.Plane(new THREE.Vector3(0, -1, 0), 10000),
        modelHolder,
        originalMaterials,
        syntheticMaterials: [],
        wireEdges: [],
        mixer,
        activeAction,
        modelRadius: radius,
        modelCenter: centerVec,
        modelBox,
      };

      frameBox(modelBox, [1, 0.72, 1.15]);

      resizeObserver = new ResizeObserver((entries) => {
        const eng = engineRef.current;
        if (!eng || !entries[0]) return;
        const { width: w, height: h } = entries[0].contentRect;
        if (w < 10 || h < 10) return;
        const aspect = w / h;
        eng.persp.aspect = aspect;
        eng.persp.updateProjectionMatrix();
        const halfH = eng.modelRadius * 0.82;
        eng.orthoCam.left = -halfH * aspect;
        eng.orthoCam.right = halfH * aspect;
        eng.orthoCam.top = halfH;
        eng.orthoCam.bottom = -halfH;
        eng.orthoCam.updateProjectionMatrix();
        eng.renderer.setSize(Math.round(w), Math.round(h), false);
      });
      resizeObserver.observe(container);

      let prevTime = performance.now();
      let uiTick = 0;
      const tick = (now: number) => {
        if (dead) return;
        raf = requestAnimationFrame(tick);
        const dt = Math.min(0.1, (now - prevTime) / 1000);
        prevTime = now;

        const eng = engineRef.current;
        if (!eng) return;
        if (eng.mixer && eng.activeAction && animPlayingRef.current) {
          eng.mixer.update(dt * animSpeedRef.current);
          uiTick += 1;
          if (uiTick % 6 === 0) {
            const clip = eng.activeAction.getClip();
            if (clip.duration > 0) {
              setAnimProgress((eng.activeAction.time % clip.duration) / clip.duration);
            }
          }
        }
        eng.controls.update();
        eng.renderer.render(eng.scene, eng.activeCam);
      };
      raf = requestAnimationFrame(tick);
    })();

    return () => {
      dead = true;
      cancelAnimationFrame(raf);
      resizeObserver?.disconnect();
      const eng = engineRef.current;
      if (eng) {
        eng.controls.dispose();
        for (const m of eng.syntheticMaterials) m.dispose();
        for (const edge of eng.wireEdges) {
          edge.geometry.dispose();
          (edge.material as THREEType.Material).dispose();
        }
        eng.shadowFloor.geometry.dispose();
        (eng.shadowFloor.material as THREEType.Material).dispose();
        eng.grid?.dispose();
        eng.axes?.dispose();
        eng.bboxHelper?.dispose();
        engineRef.current = null;
      }
      envTarget?.dispose();
      renderer?.dispose();
      if (container) container.innerHTML = "";
    };
  }, [modelSeq, frameBox]);

  // Sync camera projection mode & autoRotate
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const nextCam = ortho ? eng.orthoCam : eng.persp;
    if (eng.activeCam !== nextCam) {
      nextCam.position.copy(eng.activeCam.position);
      nextCam.quaternion.copy(eng.activeCam.quaternion);
      eng.activeCam = nextCam;
      eng.controls.object = nextCam;
      eng.controls.update();
    }
    eng.controls.autoRotate = autoRotate;
    eng.controls.autoRotateSpeed = autoRotateSpeed;
  }, [ortho, autoRotate, autoRotateSpeed, modelSeq]);

  // Sync backdrop, lighting, helpers & shadows
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const { THREE, scene, renderer, keyLight, fillLight, hemiLight, shadowFloor, grid, axes, bboxHelper } = eng;
    const bg = BACKDROP_STYLES[backdrop];
    scene.background = bg.hex ? new THREE.Color(bg.hex) : null;
    renderer.toneMappingExposure = exposure;
    renderer.shadowMap.enabled = shadows;
    shadowFloor.visible = shadows;
    keyLight.castShadow = shadows;

    if (lighting === "studio") {
      hemiLight.intensity = 0.75;
      keyLight.intensity = 1.9;
      keyLight.color.set(0xfffcf5);
      fillLight.intensity = 0.7;
    } else if (lighting === "rim") {
      hemiLight.intensity = 0.25;
      keyLight.intensity = 2.6;
      keyLight.color.set(0xffffff);
      fillLight.intensity = 1.3;
    } else if (lighting === "flat") {
      hemiLight.intensity = 1.6;
      keyLight.intensity = 0.65;
      keyLight.color.set(0xffffff);
      fillLight.intensity = 0.65;
    } else {
      hemiLight.intensity = 0.7;
      keyLight.intensity = 2.1;
      keyLight.color.set(0xffebd4);
      fillLight.intensity = 0.55;
    }

    if (grid) grid.visible = showGrid;
    if (axes) axes.visible = showAxes;
    if (bboxHelper) bboxHelper.visible = showBbox;
  }, [backdrop, lighting, exposure, showGrid, showAxes, showBbox, shadows, modelSeq]);

  // Sync shading mode, wireframe overlay, double-sided, flatShading, and clipping plane
  useEffect(() => {
    const eng = engineRef.current;
    const root = rootRef.current;
    if (!eng || !root || modelSeq === 0) return;
    const { THREE, modelHolder, originalMaterials, syntheticMaterials, clipPlane } = eng;

    // Dispose prior synthetic materials and wire overlays cleanly
    for (const m of syntheticMaterials) m.dispose();
    eng.syntheticMaterials = [];
    for (const w of eng.wireEdges) {
      w.parent?.remove(w);
      w.geometry.dispose();
      (w.material as THREEType.Material).dispose();
    }
    eng.wireEdges = [];

    // Compute slice plane from current model bounds
    const box = new THREE.Box3().setFromObject(modelHolder);
    const activeClips: THREEType.Plane[] = [];
    if (sliceAxis !== "off" && !box.isEmpty()) {
      const sign = sliceFlip ? 1 : -1;
      const normal =
        sliceAxis === "x"
          ? new THREE.Vector3(sign, 0, 0)
          : sliceAxis === "y"
            ? new THREE.Vector3(0, sign, 0)
            : new THREE.Vector3(0, 0, sign);
      const minV = sliceAxis === "x" ? box.min.x : sliceAxis === "y" ? box.min.y : box.min.z;
      const maxV = sliceAxis === "x" ? box.max.x : sliceAxis === "y" ? box.max.y : box.max.z;
      const pos = minV + ((maxV - minV) * slicePct) / 100;
      clipPlane.setFromNormalAndCoplanarPoint(normal, new THREE.Vector3(sliceAxis === "x" ? pos : 0, sliceAxis === "y" ? pos : 0, sliceAxis === "z" ? pos : 0));
      activeClips.push(clipPlane);
    }

    const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    const clayMat =
      shading === "clay"
        ? new THREE.MeshStandardMaterial({
            color: 0xd8d3c8,
            roughness: 0.52,
            metalness: 0.08,
            side,
            flatShading,
            clippingPlanes: activeClips,
          })
        : null;
    const normalMat =
      shading === "normals"
        ? new THREE.MeshNormalMaterial({
            side,
            flatShading,
            clippingPlanes: activeClips,
          })
        : null;
    const xrayMat =
      shading === "xray"
        ? new THREE.MeshPhysicalMaterial({
            color: 0xeb4a10,
            roughness: 0.2,
            metalness: 0.05,
            transparent: true,
            opacity: 0.28,
            depthWrite: false,
            side: THREE.DoubleSide,
            clippingPlanes: activeClips,
          })
        : null;

    for (const m of [clayMat, normalMat, xrayMat]) {
      if (m) eng.syntheticMaterials.push(m);
    }

    const edgeMat = wireOverlay
      ? new THREE.LineBasicMaterial({ color: 0x15140f, transparent: true, opacity: 0.35 })
      : null;

    root.traverse((obj) => {
      const mesh = obj as THREEType.Mesh;
      if (!mesh.isMesh) return;

      const orig = originalMaterials.get(mesh.uuid);
      if (shading === "clay" && clayMat) {
        mesh.material = clayMat;
      } else if (shading === "normals" && normalMat) {
        mesh.material = normalMat;
      } else if (shading === "xray" && xrayMat) {
        mesh.material = xrayMat;
      } else if (orig) {
        mesh.material = orig;
        const list = Array.isArray(orig) ? orig : [orig];
        for (const m of list) {
          m.side = side;
          if ("wireframe" in m) (m as THREEType.MeshStandardMaterial).wireframe = shading === "wireframe";
          if ("flatShading" in m) (m as THREEType.MeshStandardMaterial).flatShading = flatShading;
          m.clippingPlanes = activeClips.length ? activeClips : null;
          m.needsUpdate = true;
        }
      }

      if (wireOverlay && edgeMat && mesh.geometry) {
        const triCount = mesh.geometry.index
          ? mesh.geometry.index.count / 3
          : (mesh.geometry.getAttribute("position")?.count ?? 0) / 3;
        if (triCount <= 120_000) {
          const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, 20), edgeMat);
          edges.raycast = () => {};
          mesh.add(edges);
          eng.wireEdges.push(edges);
        }
      }
    });
  }, [shading, wireOverlay, doubleSided, flatShading, sliceAxis, slicePct, sliceFlip, modelSeq]);

  // Switch active animation clip
  const selectAnimClip = (idx: number) => {
    const eng = engineRef.current;
    const clip = animationsRef.current[idx];
    if (!eng || !eng.mixer || !clip) return;
    eng.activeAction?.stop();
    const act = eng.mixer.clipAction(clip);
    act.reset().play();
    eng.activeAction = act;
    setAnimIndex(idx);
    setAnimPlaying(true);
    setAnimProgress(0);
  };

  // Rotate model orientation cleanly and refit floor grid
  const rotateModel = (axis: "x" | "y", rad: number) => {
    const eng = engineRef.current;
    const root = rootRef.current;
    if (!root || !eng) return;
    if (axis === "x") root.rotation.x += rad;
    else root.rotation.y += rad;
    root.updateMatrixWorld(true);
    // Re-center horizontally and rest minY cleanly on y=0
    const box = new eng.THREE.Box3().setFromObject(root);
    if (!box.isEmpty()) {
      const center = box.getCenter(new eng.THREE.Vector3());
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
    }
    const updatedBox = new eng.THREE.Box3().setFromObject(eng.modelHolder);
    eng.bboxHelper?.box.copy(updatedBox);
    if (eng.grid) eng.grid.position.y = updatedBox.min.y - eng.modelRadius * 0.001;
    eng.shadowFloor.position.y = updatedBox.min.y - eng.modelRadius * 0.002;
    const nextStats = inspectObjectTree(root, animationsRef.current, eng.THREE);
    setLoaded((prev) => (prev ? { ...prev, stats: nextStats } : null));
    frameBox(updatedBox);
  };

  const resetOrientation = () => {
    const eng = engineRef.current;
    const root = rootRef.current;
    if (!root || !eng) return;
    root.rotation.set(0, 0, 0);
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
    const box = new eng.THREE.Box3().setFromObject(root);
    if (!box.isEmpty()) {
      const center = box.getCenter(new eng.THREE.Vector3());
      root.position.x -= center.x;
      root.position.z -= center.z;
      root.position.y -= box.min.y;
    }
    const updatedBox = new eng.THREE.Box3().setFromObject(eng.modelHolder);
    eng.bboxHelper?.box.copy(updatedBox);
    if (eng.grid) eng.grid.position.y = updatedBox.min.y - eng.modelRadius * 0.001;
    eng.shadowFloor.position.y = updatedBox.min.y - eng.modelRadius * 0.002;
    const nextStats = inspectObjectTree(root, animationsRef.current, eng.THREE);
    setLoaded((prev) => (prev ? { ...prev, stats: nextStats } : null));
    frameBox(updatedBox, [1, 0.72, 1.15]);
  };

  // Mesh visibility & solo controls
  const toggleNodeVisible = (uuid: string) => {
    const root = rootRef.current;
    if (!root) return;
    const obj = root.getObjectByProperty("uuid", uuid);
    if (!obj) return;
    obj.visible = !obj.visible;
    setNodes((prev) => prev.map((n) => (n.uuid === uuid ? { ...n, visible: obj.visible } : n)));
  };

  const soloNode = (uuid: string) => {
    const root = rootRef.current;
    if (!root || !engineRef.current) return;
    const isAlreadySolo = nodes.every((n) => (n.uuid === uuid ? n.visible : !n.visible));
    root.traverse((obj) => {
      if ((obj as THREEType.Mesh).isMesh || (obj as THREEType.Points).isPoints) {
        obj.visible = isAlreadySolo ? true : obj.uuid === uuid;
      }
    });
    setNodes((prev) => prev.map((n) => ({ ...n, visible: isAlreadySolo ? true : n.uuid === uuid })));
    const target = root.getObjectByProperty("uuid", uuid);
    if (target && !isAlreadySolo) {
      setSelectedUuid(uuid);
      frameBox(new engineRef.current.THREE.Box3().setFromObject(target));
    } else if (isAlreadySolo) {
      setSelectedUuid(null);
      frameBox(new engineRef.current.THREE.Box3().setFromObject(engineRef.current.modelHolder));
    }
  };

  const focusNode = (uuid: string) => {
    const eng = engineRef.current;
    const root = rootRef.current;
    if (!root || !eng) return;
    const target = root.getObjectByProperty("uuid", uuid);
    if (!target) return;
    setSelectedUuid(uuid);
    frameBox(new eng.THREE.Box3().setFromObject(target));
  };

  // Exports
  const takeScreenshot = () => {
    const eng = engineRef.current;
    if (!eng || !loaded) return;
    eng.renderer.render(eng.scene, eng.activeCam);
    eng.renderer.domElement.toBlob((blob) => {
      if (!blob) return;
      const base = loaded.fileName.replace(/\.[^.]+$/, "");
      saveBlob(blob, `${base}-3d-view.png`);
    }, "image/png");
  };

  const runExport = async (fmt: "glb" | "stl" | "obj") => {
    const root = rootRef.current;
    const eng = engineRef.current;
    if (!loaded || !root || exporting) return;
    setExporting(fmt);
    try {
      const base = loaded.fileName.replace(/\.[^.]+$/, "");
      const blob = await exportPreparedModel(root, fmt, {
        originalMaterials: eng?.originalMaterials,
        wireEdges: eng?.wireEdges,
        animations: animationsRef.current,
      });
      saveBlob(blob, `${base}.${fmt}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not export .${fmt.toUpperCase()}.`);
    } finally {
      setExporting(null);
    }
  };

  const filteredNodes = useMemo(() => {
    const q = treeSearch.trim().toLowerCase();
    return q ? nodes.filter((n) => n.name.toLowerCase().includes(q)) : nodes;
  }, [nodes, treeSearch]);

  const unitMult = UNIT_FACTORS[unit];
  const unitSuffix = unit === "units" ? "" : ` ${unit}`;
  const step = !loaded ? 0 : 1;

  return (
    <Workbench
      steps={stepsFor(tool)}
      current={step}
      footer="Everything renders locally on your GPU via WebGL — no 3D models are uploaded."
    >
      <div className="@container grid gap-4 p-3 sm:p-4 md:p-5">
        {!loaded ? (
          <div className="grid gap-3">
            <FileDrop
              multiple
              accept={THREE_ACCEPT}
              title={loading ? "Loading 3D scene…" : "Drop a 3D file, multi-file OBJ/GLTF folder, or .ZIP bundle"}
              formats={`${THREE_FORMATS_LABEL} · up to ${THREE_MAX_MB} MB`}
              error={error}
              onFiles={(files) => void loadFiles(files)}
            />
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2.5">
              <p className="text-xs text-ink-2">
                No model handy? Open a multi-part mechanical assembly or sculptural PBR sample:
              </p>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void loadSample("gear")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-ink-3"
                >
                  <Sparkles aria-hidden className="size-3.5 text-accent" /> Planetary gear assembly
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void loadSample("knot")}
                  className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-ink-3"
                >
                  <Box aria-hidden className="size-3.5 text-ink-2" /> Sculptural PBR knot
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            {/* Header strip */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-paper px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="rounded-sm bg-ink px-1.5 py-0.5 font-mono text-[11px] font-semibold text-paper">
                  {loaded.format}
                </span>
                <p className="min-w-0 truncate text-sm font-medium text-ink">
                  {loaded.fileName}
                </p>
                <span className="font-mono text-[12px] text-ink-3">
                  · {loaded.stats.triangles.toLocaleString("en")} tris · {loaded.stats.vertices.toLocaleString("en")} verts · {loaded.stats.meshes}{" "}
                  {loaded.stats.meshes === 1 ? "part" : "parts"}
                  {loaded.totalBytes > 0 ? ` · ${formatBytes(loaded.totalBytes)}` : ""}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={takeScreenshot}
                  className="inline-flex h-8 items-center gap-1 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink-2 hover:border-ink-3 hover:text-ink"
                >
                  <Camera aria-hidden className="size-3.5" /> Snapshot
                </button>
                <button
                  type="button"
                  onClick={() => {
                    teardownLoaded();
                    setLoaded(null);
                    setError(null);
                  }}
                  className="inline-flex h-8 items-center rounded-sm px-2.5 text-xs font-medium text-ink-2 hover:bg-paper-2 hover:text-ink"
                >
                  Open another
                </button>
              </div>
            </div>

            {loaded.warnings.map((w) => (
              <Notice key={w} tone="info">
                {w}
              </Notice>
            ))}
            {error && <Notice tone="danger">{error}</Notice>}

            {/* Main Viewport + Inspector Split */}
            <div className={cn("grid gap-4", fullscreen ? "fixed inset-3 z-50 grid-cols-1 lg:grid-cols-12 rounded-xl border border-line bg-paper p-3 shadow-float" : "grid-cols-1 lg:grid-cols-12")}>
              {/* WebGL Canvas Column */}
              <div className="relative flex flex-col overflow-hidden rounded-lg border border-line lg:col-span-8">
                {/* Floating top toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-1.5 border-b border-line bg-surface/95 px-2.5 py-2 backdrop-blur-xs">
                  <div className="flex flex-wrap items-center gap-1">
                    {(["iso", "front", "back", "left", "right", "top"] as const).map((view) => (
                      <button
                        key={view}
                        type="button"
                        onClick={() => setCameraPreset(view)}
                        className="rounded-sm border border-line bg-paper px-2 py-1 font-mono text-[11px] uppercase text-ink-2 hover:border-ink-3 hover:text-ink"
                      >
                        {view}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setOrtho((o) => !o)}
                      title="Toggle Perspective / Orthographic camera"
                      className={cn(
                        "rounded-sm border px-2 py-1 font-mono text-[11px]",
                        ortho ? "border-ink bg-ink text-paper" : "border-line bg-paper text-ink-2 hover:text-ink",
                      )}
                    >
                      {ortho ? "Ortho" : "Persp"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setAutoRotate((a) => !a)}
                      title="Toggle Auto-Rotate"
                      className={cn(
                        "inline-flex items-center gap-1 rounded-sm border px-2 py-1 font-mono text-[11px]",
                        autoRotate ? "border-accent bg-accent/15 text-accent" : "border-line bg-paper text-ink-2 hover:text-ink",
                      )}
                    >
                      <RotateCw aria-hidden className={cn("size-3", autoRotate && "animate-spin")} />
                      Spin
                    </button>
                    <button
                      type="button"
                      onClick={() => setCameraPreset("iso")}
                      title="Reset camera framing"
                      className="inline-flex size-7 items-center justify-center rounded-sm border border-line bg-paper text-ink-2 hover:text-ink"
                    >
                      <Focus aria-hidden className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setFullscreen((f) => !f)}
                      title={fullscreen ? "Exit expanded view" : "Expand viewport"}
                      className="inline-flex size-7 items-center justify-center rounded-sm border border-line bg-paper text-ink-2 hover:text-ink"
                    >
                      {fullscreen ? <Minimize2 aria-hidden className="size-3.5" /> : <Maximize2 aria-hidden className="size-3.5" />}
                    </button>
                  </div>
                </div>

                {/* Interactive Canvas */}
                <div
                  ref={stageRef}
                  className={cn(
                    "relative w-full select-none",
                    BACKDROP_STYLES[backdrop].css,
                    fullscreen ? "min-h-[420px] flex-1" : "h-[380px] sm:h-[460px] lg:h-[520px]",
                  )}
                />

                {/* Quick overlay hint */}
                <div className="pointer-events-none absolute bottom-2.5 left-2.5 flex flex-wrap gap-1.5">
                  <span className="rounded-sm bg-paper/80 px-2 py-0.5 font-mono text-[10px] text-ink-2 backdrop-blur-xs">
                    Left drag: orbit · Right drag / 2-finger: pan · Scroll / pinch: zoom
                  </span>
                </div>

                {/* Animation player bar if animations exist */}
                {loaded.animations.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line bg-surface px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setAnimPlaying((p) => !p)}
                      className="inline-flex h-7 items-center gap-1 rounded-sm bg-ink px-2.5 text-xs font-medium text-paper"
                    >
                      {animPlaying ? <Pause aria-hidden className="size-3" /> : <Play aria-hidden className="size-3" />}
                      {animPlaying ? "Pause" : "Play"}
                    </button>
                    <select
                      value={animIndex}
                      onChange={(e) => selectAnimClip(Number(e.target.value))}
                      aria-label="Animation clip"
                      className="h-7 max-w-[160px] rounded-sm border border-line bg-paper px-2 text-xs text-ink"
                    >
                      {loaded.animations.map((clip, i) => (
                        <option key={i} value={i}>
                          {clip.name || `Clip ${i + 1}`} ({clip.duration.toFixed(1)}s)
                        </option>
                      ))}
                    </select>
                    <div className="h-1.5 min-w-[80px] flex-1 overflow-hidden rounded-full bg-paper-2">
                      <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.round(animProgress * 100)}%` }} />
                    </div>
                    <select
                      value={animSpeed}
                      onChange={(e) => setAnimSpeed(Number(e.target.value))}
                      aria-label="Animation playback speed"
                      className="h-7 rounded-sm border border-line bg-paper px-1.5 font-mono text-[11px] text-ink"
                    >
                      {[0.25, 0.5, 1, 1.5, 2].map((s) => (
                        <option key={s} value={s}>
                          {s}×
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* Controls Dock Column */}
              <div className="flex flex-col gap-3 lg:col-span-4">
                <div className="grid grid-cols-4 gap-1 rounded-md border border-line bg-paper p-1">
                  {(
                    [
                      { id: "display", label: "Display", Icon: Sun },
                      { id: "transform", label: "Slice", Icon: Scissors },
                      { id: "tree", label: "Meshes", Icon: Layers },
                      { id: "stats", label: "Inspect", Icon: SlidersHorizontal },
                    ] as const
                  ).map(({ id, label, Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setTab(id)}
                      className={cn(
                        "inline-flex flex-col items-center gap-0.5 rounded-[5px] py-1.5 text-[11px] font-medium transition-colors",
                        tab === id ? "bg-ink text-paper" : "text-ink-2 hover:text-ink",
                      )}
                    >
                      <Icon aria-hidden className="size-3.5" />
                      {label}
                    </button>
                  ))}
                </div>

                <div className="max-h-[480px] overflow-y-auto pr-0.5" data-lenis-prevent>
                  {tab === "display" && (
                    <Panel>
                      <Row label="Surface shading">
                        <Chips
                          value={shading}
                          onChange={setShading}
                          label="Shading"
                          options={[
                            { value: "pbr", label: "Textured / PBR" },
                            { value: "clay", label: "Clay" },
                            { value: "wireframe", label: "Wireframe" },
                            { value: "normals", label: "Normals" },
                            { value: "xray", label: "X-Ray" },
                          ]}
                        />
                        <div className="mt-3 grid gap-2">
                          <Toggle checked={wireOverlay} onChange={setWireOverlay} label="Edge wireframe overlay" />
                          <Toggle checked={doubleSided} onChange={setDoubleSided} label="Double-sided faces (find inverted normals)" />
                          <Toggle checked={flatShading} onChange={setFlatShading} label="Flat face shading" />
                        </div>
                      </Row>

                      <Row label="Backdrop & guides">
                        <Chips
                          value={backdrop}
                          onChange={setBackdrop}
                          label="Backdrop"
                          options={(Object.keys(BACKDROP_STYLES) as BackdropMode[]).map((k) => ({
                            value: k,
                            label: BACKDROP_STYLES[k].label,
                          }))}
                        />
                        <div className="mt-3 grid gap-2">
                          <Toggle checked={showGrid} onChange={setShowGrid} label={<span className="inline-flex items-center gap-1"><Grid aria-hidden className="size-3.5" /> Floor grid</span>} />
                          <Toggle checked={showAxes} onChange={setShowAxes} label="XYZ coordinate axes" />
                          <Toggle checked={showBbox} onChange={setShowBbox} label="Bounding box frame" />
                          <Toggle checked={shadows} onChange={setShadows} label="Ground contact shadows" />
                        </div>
                      </Row>

                      <Row label="Lighting">
                        <Chips
                          value={lighting}
                          onChange={setLighting}
                          label="Lighting preset"
                          options={[
                            { value: "studio", label: "Studio" },
                            { value: "rim", label: "Dramatic rim" },
                            { value: "flat", label: "Even / Flat" },
                            { value: "warm", label: "Warm clay" },
                          ]}
                        />
                        <div className="mt-3 grid gap-2">
                          <Slider
                            label="Exposure"
                            value={exposure}
                            min={0.4}
                            max={2.2}
                            step={0.05}
                            onChange={setExposure}
                            format={(v) => v.toFixed(2)}
                          />
                          {autoRotate && (
                            <Slider
                              label="Spin speed"
                              value={autoRotateSpeed}
                              min={0.5}
                              max={6}
                              step={0.5}
                              onChange={setAutoRotateSpeed}
                              format={(v) => `${v.toFixed(1)}×`}
                            />
                          )}
                        </div>
                      </Row>
                    </Panel>
                  )}

                  {tab === "transform" && (
                    <Panel>
                      <Row label="Orientation" hint="CAD exports often use Z-up instead of Y-up">
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            onClick={() => rotateModel("x", -Math.PI / 2)}
                            className="inline-flex h-8 items-center rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-ink-3"
                          >
                            Z-up → Y-up (-90° X)
                          </button>
                          <button
                            type="button"
                            onClick={() => rotateModel("x", Math.PI / 2)}
                            className="inline-flex h-8 items-center rounded-sm border border-line bg-surface px-2.5 text-xs text-ink-2 hover:border-ink-3"
                          >
                            +90° X
                          </button>
                          <button
                            type="button"
                            onClick={() => rotateModel("y", Math.PI / 2)}
                            className="inline-flex h-8 items-center rounded-sm border border-line bg-surface px-2.5 text-xs text-ink-2 hover:border-ink-3"
                          >
                            +90° Y
                          </button>
                          <button
                            type="button"
                            onClick={resetOrientation}
                            className="inline-flex h-8 items-center gap-1 rounded-sm px-2 text-xs text-ink-3 hover:text-ink"
                          >
                            <RotateCcw aria-hidden className="size-3.5" /> Reset
                          </button>
                        </div>
                      </Row>

                      <Row label="Cross-section slice" hint="Inspect internal cavities & wall thickness">
                        <Chips
                          value={sliceAxis}
                          onChange={setSliceAxis}
                          label="Slice axis"
                          options={[
                            { value: "off", label: "Off" },
                            { value: "x", label: "X plane" },
                            { value: "y", label: "Y plane" },
                            { value: "z", label: "Z plane" },
                          ]}
                        />
                        {sliceAxis !== "off" && (
                          <div className="mt-3 grid gap-2.5">
                            <Slider
                              label="Slice depth"
                              value={slicePct}
                              min={0}
                              max={100}
                              step={1}
                              onChange={setSlicePct}
                              format={(v) => `${v}%`}
                            />
                            <Toggle checked={sliceFlip} onChange={setSliceFlip} label="Flip cut side" />
                          </div>
                        )}
                      </Row>
                    </Panel>
                  )}

                  {tab === "tree" && (
                    <Panel>
                      <Row label={`Scene hierarchy (${nodes.length})`} hint="Click to focus, Eye to hide, Solo to isolate">
                        <input
                          type="text"
                          value={treeSearch}
                          onChange={(e) => setTreeSearch(e.target.value)}
                          placeholder="Filter mesh names…"
                          className="mb-2.5 h-9 w-full rounded-sm border border-line bg-surface px-2.5 text-xs text-ink placeholder:text-ink-3 focus:border-ink focus:outline-none"
                        />
                        <ul className="grid max-h-72 gap-1.5 overflow-y-auto pr-0.5" data-lenis-prevent>
                          {filteredNodes.map((n) => (
                            <li
                              key={n.uuid}
                              className={cn(
                                "flex items-center justify-between gap-2 rounded-sm border px-2.5 py-1.5 text-xs transition-colors",
                                selectedUuid === n.uuid ? "border-ink bg-paper-2/70" : "border-line bg-surface",
                                !n.visible && "opacity-55",
                              )}
                            >
                              <button
                                type="button"
                                onClick={() => focusNode(n.uuid)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <span className="block truncate font-medium text-ink">{n.name}</span>
                                <span className="font-mono text-[10px] text-ink-3">
                                  {n.triangles.toLocaleString("en")} tris · {n.vertices.toLocaleString("en")} verts
                                </span>
                              </button>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => soloNode(n.uuid)}
                                  className="rounded-sm border border-line bg-paper px-1.5 py-0.5 font-mono text-[10px] text-ink-2 hover:border-ink-3 hover:text-ink"
                                >
                                  Solo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => toggleNodeVisible(n.uuid)}
                                  aria-label={n.visible ? `Hide ${n.name}` : `Show ${n.name}`}
                                  className="inline-flex size-7 items-center justify-center rounded-sm border border-line bg-paper text-ink-2 hover:text-ink"
                                >
                                  {n.visible ? <Eye aria-hidden className="size-3.5" /> : <EyeOff aria-hidden className="size-3.5" />}
                                </button>
                              </div>
                            </li>
                          ))}
                          {filteredNodes.length === 0 && <p className="py-4 text-center text-xs text-ink-3">No matching meshes.</p>}
                        </ul>
                      </Row>
                    </Panel>
                  )}

                  {tab === "stats" && (
                    <Panel>
                      <Row label="Dimensions" hint="Scale readout">
                        <Chips
                          value={unit}
                          onChange={setUnit}
                          label="Unit scale"
                          options={[
                            { value: "units", label: "Raw" },
                            { value: "mm", label: "mm" },
                            { value: "cm", label: "cm" },
                            { value: "m", label: "m" },
                            { value: "in", label: "in" },
                          ]}
                        />
                        <dl className="mt-3 grid grid-cols-3 gap-2 rounded-sm border border-line bg-surface p-2 text-center font-mono">
                          {(["Width (X)", "Height (Y)", "Depth (Z)"] as const).map((lbl, idx) => (
                            <div key={lbl}>
                              <dt className="text-[10px] text-ink-3">{lbl}</dt>
                              <dd className="mt-0.5 text-xs font-semibold text-ink">
                                {formatDim(loaded.stats.size[idx] * unitMult)}
                                {unitSuffix}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </Row>

                      <Row label="Model checks">
                        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                          <div className="flex justify-between border-b border-line py-1">
                            <dt className="text-ink-3">Vertices</dt>
                            <dd className="font-mono text-ink">{loaded.stats.vertices.toLocaleString("en")}</dd>
                          </div>
                          <div className="flex justify-between border-b border-line py-1">
                            <dt className="text-ink-3">Triangles</dt>
                            <dd className="font-mono text-ink">{loaded.stats.triangles.toLocaleString("en")}</dd>
                          </div>
                          <div className="flex justify-between border-b border-line py-1">
                            <dt className="text-ink-3">Mesh parts</dt>
                            <dd className="font-mono text-ink">{loaded.stats.meshes}</dd>
                          </div>
                          <div className="flex justify-between border-b border-line py-1">
                            <dt className="text-ink-3">Materials</dt>
                            <dd className="font-mono text-ink">{loaded.stats.materials}</dd>
                          </div>
                          <div className="flex justify-between border-b border-line py-1">
                            <dt className="text-ink-3">Textures</dt>
                            <dd className="font-mono text-ink">{loaded.stats.textures}</dd>
                          </div>
                          <div className="flex justify-between border-b border-line py-1">
                            <dt className="text-ink-3">Animations</dt>
                            <dd className="font-mono text-ink">{loaded.stats.animations}</dd>
                          </div>
                        </dl>
                      </Row>

                      <Row label="Convert & export locally">
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={takeScreenshot}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-ink-3"
                          >
                            <Camera aria-hidden className="size-3.5" /> PNG render
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(exporting)}
                            onClick={() => void runExport("glb")}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm bg-ink px-2.5 text-xs font-medium text-paper hover:opacity-90 disabled:opacity-50"
                          >
                            <Download aria-hidden className="size-3.5" /> {exporting === "glb" ? "Exporting…" : "Export .GLB"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(exporting)}
                            onClick={() => void runExport("stl")}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-ink-3 disabled:opacity-50"
                          >
                            <Download aria-hidden className="size-3.5" /> {exporting === "stl" ? "Exporting…" : "Export .STL"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(exporting)}
                            onClick={() => void runExport("obj")}
                            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-sm border border-line bg-surface px-2.5 text-xs font-medium text-ink hover:border-ink-3 disabled:opacity-50"
                          >
                            <Download aria-hidden className="size-3.5" /> {exporting === "obj" ? "Exporting…" : "Export .OBJ"}
                          </button>
                        </div>
                      </Row>
                    </Panel>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </Workbench>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { MotionValue } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * "The toolbox" — 27 paper blocks that assemble into one cube.
 *
 * - On load the blocks fly in from a scatter and lock into place.
 * - The cube leans toward the mouse and slowly sways.
 * - Drag it (mouse, pen or a sideways swipe) to turn it; it keeps a little momentum.
 * - Hovering a block lifts it; clicking or tapping one slides it out and back.
 * - Every few seconds the orange block (the tool you picked) slides out and back.
 * - Scrolling past the hero pulls the blocks apart along their axes.
 *
 * The camera fits the cube to whatever box it is given, so it is never cropped on any
 * screen. three.js is loaded on demand and the loop sleeps while the canvas is off-screen
 * or the tab is hidden. Reduced motion renders still frames (dragging still turns it).
 */

/** Colors come from the design tokens, so the object can never drift off-palette. */
function token(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
  return v || fallback;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** Radius (world units) of the assembled cube plus its contact shadow, and how much of the box it fills. */
const FIT_RADIUS = 2.8;
const FIT_FILL = 0.86;
const FOV = 28;
/** A drag must travel this far (px) before it stops counting as a tap. */
const TAP_SLOP = 6;

export function HeroObject({
  progress,
  className,
  onUnavailable,
}: {
  /** 0 → 1 as the hero scrolls out of view. */
  progress: MotionValue<number>;
  className?: string;
  /** Called when WebGL can't run, so the hero can drop the figure instead of showing an empty box. */
  onUnavailable?: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const unavailable = useRef(onUnavailable);
  useEffect(() => {
    unavailable.current = onUnavailable;
  }, [onUnavailable]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let cancelled = false;
    let teardown = () => {};

    (async () => {
      const THREE = await import("three");
      const { RoundedBoxGeometry } = await import("three/examples/jsm/geometries/RoundedBoxGeometry.js");
      if (cancelled) return;

      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power" });
      } catch {
        unavailable.current?.(); // No WebGL: the object is decorative, so the hero simply goes without it.
        return;
      }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      const canvas = renderer.domElement;
      canvas.style.width = "100%";
      canvas.style.height = "100%";
      canvas.style.display = "block";
      host.appendChild(canvas);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

      /* ---------- Light: soft daylight on paper ---------- */
      const paper2 = new THREE.Color(token("paper-2", "#eae6db"));
      scene.add(new THREE.HemisphereLight(0xffffff, paper2, 2.1));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(-2.5, 10, 4);
      key.castShadow = true;
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -6;
      key.shadow.camera.right = 6;
      key.shadow.camera.top = 6;
      key.shadow.camera.bottom = -6;
      key.shadow.radius = 8;
      key.shadow.bias = -0.0005;
      scene.add(key);
      const rim = new THREE.DirectionalLight(0xffffff, 0.6);
      rim.position.set(6, 2, -4);
      scene.add(rim);

      // Contact shadow on an invisible floor, so the cube sits on the page.
      const floor = new THREE.Mesh(
        new THREE.PlaneGeometry(30, 30),
        new THREE.ShadowMaterial({ color: new THREE.Color(token("ink", "#15140f")), opacity: 0.09 }),
      );
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -2.7;
      floor.receiveShadow = true;
      scene.add(floor);

      /* ---------- The blocks ---------- */
      const size = 0.9;
      const step = 1.02;
      const geometry = new RoundedBoxGeometry(size, size, size, 4, 0.12);
      const mat = (color: string, roughness = 0.88) =>
        new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness: 0 });
      const materials = {
        surface: mat(token("surface", "#fbfaf6")),
        paper: mat(token("paper-2", "#eae6db")),
        ink: mat(token("ink", "#15140f"), 0.6),
        accent: mat(token("accent", "#eb4a10"), 0.55),
      };

      const group = new THREE.Group();
      scene.add(group);

      type Block = {
        mesh: InstanceType<typeof THREE.Mesh>;
        home: InstanceType<typeof THREE.Vector3>;
        /** Unit vector from the centre, the way this block slides when lifted or poked. */
        out: InstanceType<typeof THREE.Vector3>;
        from: InstanceType<typeof THREE.Vector3>;
        spin: InstanceType<typeof THREE.Quaternion>;
        delay: number;
        accent: boolean;
        /** 0 → 1 hover lift, eased. */
        lift: number;
      };
      const blocks: Block[] = [];
      const identity = new THREE.Quaternion();
      // Deterministic pseudo-random so the scatter is the same on every visit.
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

      for (let x = -1; x <= 1; x++)
        for (let y = -1; y <= 1; y++)
          for (let z = -1; z <= 1; z++) {
            const accent = x === 1 && y === 1 && z === 1;
            const ink = x === -1 && y === 1 && z === -1;
            const tone = accent ? "accent" : ink ? "ink" : (x + y + z) % 2 === 0 ? "surface" : "paper";
            const mesh = new THREE.Mesh(geometry, materials[tone]);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            const home = new THREE.Vector3(x, y, z).multiplyScalar(step);
            const out = home.lengthSq() ? home.clone().normalize() : new THREE.Vector3();
            const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
            const from = home.clone().add(dir.multiplyScalar(5 + rand() * 3));
            const spin = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI),
            );
            blocks.push({ mesh, home, out, from, spin, delay: (y + 1) * 0.12 + rand() * 0.25, accent, lift: 0 });
            group.add(mesh);
          }
      const meshes = blocks.map((b) => b.mesh);
      const byMesh = new Map(blocks.map((b) => [b.mesh, b]));

      /* ---------- Sizing: fit the cube to the box, whatever its shape ---------- */
      const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        const aspect = width / height;
        camera.aspect = aspect;
        // Fit against the narrower of the two fields of view, so tall phone boxes don't crop it.
        const half = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        const fitHalf = Math.min(half, half * aspect);
        const distance = FIT_RADIUS / (FIT_FILL * fitHalf);
        camera.position.set(0, distance * 0.084, distance);
        camera.lookAt(0, -0.3, 0);
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(() => {
        resize();
        if (reduced) requestFrame();
      });
      ro.observe(host);

      /* ---------- Pointer: lean, hover, drag, tap ---------- */
      const pointer = { x: 0, y: 0 };
      const lean = { x: 0, y: 0 };
      const user = { yaw: 0, pitch: 0, vYaw: 0, vPitch: 0 };
      let hovered: Block | null = null;
      let poke: { block: Block; at: number } | null = null;
      let drag: {
        id: number;
        x: number;
        y: number;
        startX: number;
        startY: number;
        lastMove: number;
        moved: boolean;
        block: Block | null;
      } | null = null;
      let now = 0;
      const raycaster = new THREE.Raycaster();
      const ndc = new THREE.Vector2();

      const blockAt = (e: PointerEvent) => {
        const r = host.getBoundingClientRect();
        ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = raycaster.intersectObjects(meshes, false)[0];
        return hit ? (byMesh.get(hit.object as InstanceType<typeof THREE.Mesh>) ?? null) : null;
      };
      const setCursor = (c: string) => {
        if (host.style.cursor !== c) host.style.cursor = c;
      };

      const onWindowPointer = (e: PointerEvent) => {
        if (e.pointerType !== "mouse") return; // fingers don't hover; leaning to a tap point looks like a jump
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      };
      const onDown = (e: PointerEvent) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        const block = blockAt(e);
        if (!block) return; // only the cube itself is grabbable; the rest of the box stays inert
        if (e.pointerType === "mouse") e.preventDefault(); // no text selection while turning it
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, lastMove: performance.now(), moved: false, block };
        user.vYaw = user.vPitch = 0;
        host.setPointerCapture(e.pointerId);
        setCursor("grabbing");
        wake();
      };
      const onMove = (e: PointerEvent) => {
        if (drag && e.pointerId === drag.id) {
          const dx = e.clientX - drag.x;
          const dy = e.clientY - drag.y;
          drag.x = e.clientX;
          drag.y = e.clientY;
          drag.lastMove = performance.now();
          if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > TAP_SLOP) drag.moved = true;
          if (!drag.moved) return;
          user.yaw += dx * 0.009;
          user.pitch = clamp(user.pitch + dy * 0.006, -0.75, 0.75);
          user.vYaw = dx * 0.009;
          user.vPitch = dy * 0.006;
          if (reduced) requestFrame();
          return;
        }
        if (e.pointerType !== "mouse") return;
        const next = blockAt(e);
        setCursor(next ? "grab" : "");
        if (next !== hovered) {
          hovered = next;
          wake();
        }
      };
      const onUp = (e: PointerEvent) => {
        if (!drag || e.pointerId !== drag.id) return;
        if (!drag.moved && drag.block && !reduced) poke = { block: drag.block, at: now };
        // A drag that paused before letting go shouldn't fling.
        if (performance.now() - drag.lastMove > 80) user.vYaw = user.vPitch = 0;
        if (reduced) user.vYaw = user.vPitch = 0;
        if (host.hasPointerCapture(e.pointerId)) host.releasePointerCapture(e.pointerId);
        drag = null;
        setCursor(e.pointerType === "mouse" && blockAt(e) ? "grab" : "");
        wake();
      };
      const onCancel = (e: PointerEvent) => {
        // The browser took the gesture (a vertical swipe became a page scroll).
        if (drag && e.pointerId === drag.id) drag = null;
        user.vYaw = user.vPitch = 0;
        setCursor("");
      };
      const onLeave = () => {
        if (drag) return;
        hovered = null;
        setCursor("");
        wake();
      };

      window.addEventListener("pointermove", onWindowPointer, { passive: true });
      host.addEventListener("pointerdown", onDown);
      host.addEventListener("pointermove", onMove);
      host.addEventListener("pointerup", onUp);
      host.addEventListener("pointercancel", onCancel);
      host.addEventListener("pointerleave", onLeave);

      /* ---------- Frame ---------- */
      let spread = 0;
      const tmp = new THREE.Vector3();

      function draw(t: number) {
        now = t;
        // Scroll spread, eased so it never jumps.
        const target = reduced ? 0 : clamp01(progress.get() * 1.4);
        spread += (target - spread) * (reduced ? 1 : 0.08);
        if (!drag) {
          lean.x += (pointer.x - lean.x) * 0.05;
          lean.y += (pointer.y - lean.y) * 0.05;
        }

        // Momentum after a flick, and the tilt drifts back to level so it never ends up upside down.
        if (!drag && !reduced) {
          user.yaw += user.vYaw;
          user.pitch = clamp(user.pitch + user.vPitch, -0.75, 0.75);
          user.vYaw *= 0.94;
          user.vPitch *= 0.9;
          user.pitch *= 0.985;
        }

        // A pick every 5s: the orange block slides out along its diagonal, then back.
        const cycle = (t - 2.6) % 5;
        const pick = reduced || t < 2.6 || cycle > 1.6 ? 0 : Math.sin((cycle / 1.6) * Math.PI);

        let poked = 0;
        if (poke) {
          const pt = (t - poke.at) / 1.1;
          if (pt >= 1) poke = null;
          else poked = Math.sin(pt * Math.PI);
        }

        for (const b of blocks) {
          const k = reduced ? 1 : easeOut(clamp01((t - 0.15 - b.delay) / 1.25));
          const want = hovered === b && !drag ? 1 : 0;
          b.lift = reduced ? want : b.lift + (want - b.lift) * 0.2;
          tmp.copy(b.home).multiplyScalar(1 + spread * 0.75);
          if (b.accent) tmp.addScaledVector(b.home, pick * 0.55);
          tmp.addScaledVector(b.out, b.lift * 0.16 + (poke?.block === b ? poked * 0.75 : 0));
          b.mesh.position.lerpVectors(b.from, tmp, k);
          b.mesh.quaternion.slerpQuaternions(b.spin, identity, k);
          b.mesh.scale.setScalar(0.4 + 0.6 * k);
        }

        const sway = reduced ? 0 : Math.sin(t * 0.32) * 0.35;
        group.rotation.set(
          0.5 + lean.y * 0.18 + spread * 0.3 + user.pitch,
          -0.72 + sway + lean.x * 0.4 + spread * 0.9 + user.yaw,
          0,
        );
        group.position.y = reduced ? 0 : Math.sin(t * 0.9) * 0.08;

        renderer.render(scene, camera);
      }

      /* ---------- Loop: only while visible ---------- */
      let raf = 0;
      let visible = true;
      const clock = new THREE.Timer();
      const loop = (ts: number) => {
        clock.update(ts);
        draw(clock.getElapsed());
        raf = requestAnimationFrame(loop);
      };
      const run = () => {
        if (reduced || raf || !visible || document.hidden) return;
        raf = requestAnimationFrame(loop);
      };
      const pause = () => {
        cancelAnimationFrame(raf);
        raf = 0;
      };
      // Reduced motion: no loop, just one still frame whenever something changes.
      let pending = 0;
      function requestFrame() {
        if (pending) return;
        pending = requestAnimationFrame(() => {
          pending = 0;
          draw(10);
        });
      }
      function wake() {
        if (reduced) requestFrame();
        else run();
      }
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) run();
        else pause();
      });
      io.observe(host);
      const onVisibility = () => (document.hidden ? pause() : run());
      document.addEventListener("visibilitychange", onVisibility);

      // A lost GPU context (common on phones in the background) comes back with a fresh frame.
      const onLost = (e: Event) => {
        e.preventDefault();
        pause();
      };
      const onRestored = () => {
        resize();
        wake();
      };
      canvas.addEventListener("webglcontextlost", onLost);
      canvas.addEventListener("webglcontextrestored", onRestored);

      if (reduced) draw(10);
      else run();

      teardown = () => {
        pause();
        cancelAnimationFrame(pending);
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pointermove", onWindowPointer);
        host.removeEventListener("pointerdown", onDown);
        host.removeEventListener("pointermove", onMove);
        host.removeEventListener("pointerup", onUp);
        host.removeEventListener("pointercancel", onCancel);
        host.removeEventListener("pointerleave", onLeave);
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        geometry.dispose();
        floor.geometry.dispose();
        (floor.material as InstanceType<typeof THREE.Material>).dispose();
        Object.values(materials).forEach((m) => m.dispose());
        clock.dispose();
        renderer.dispose();
        canvas.remove();
        host.style.cursor = "";
      };
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [progress]);

  // pan-y: a vertical swipe still scrolls the page; a sideways one turns the cube.
  return <div ref={hostRef} aria-hidden className={cn("touch-pan-y select-none", className)} />;
}

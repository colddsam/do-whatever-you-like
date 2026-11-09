"use client";

import { useEffect, useRef, useState } from "react";
import type { MotionValue } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * "The toolbox" — 27 paper blocks that assemble into one cube.
 *
 * - On load the blocks fly in from a scatter and lock into place.
 * - The cube leans toward the pointer and slowly sways.
 * - Every few seconds the orange block (the tool you picked) slides out and back.
 * - Scrolling past the hero pulls the blocks apart along their axes.
 *
 * three.js is loaded on demand, only on large screens, and the loop sleeps while the
 * canvas is off-screen or the tab is hidden. Reduced motion renders one still frame.
 */

const DESKTOP = "(min-width: 1024px)";

/** Colors come from the design tokens, so the object can never drift off-palette. */
function token(name: string, fallback: string) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--color-${name}`).trim();
  return v || fallback;
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 4);
const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);

export function HeroObject({
  progress,
  className,
}: {
  /** 0 → 1 as the hero scrolls out of view. */
  progress: MotionValue<number>;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [enabled, setEnabled] = useState(false);

  // Only mount WebGL where the object is actually shown.
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const sync = () => setEnabled(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || !host) return;

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
        return; // No WebGL: the object is decorative, so the hero simply goes without it.
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
      const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
      camera.position.set(0, 1.6, 19);
      camera.lookAt(0, -0.3, 0);

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
        from: InstanceType<typeof THREE.Vector3>;
        spin: InstanceType<typeof THREE.Quaternion>;
        delay: number;
        accent: boolean;
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
            const dir = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).normalize();
            const from = home.clone().add(dir.multiplyScalar(5 + rand() * 3));
            const spin = new THREE.Quaternion().setFromEuler(
              new THREE.Euler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI),
            );
            blocks.push({ mesh, home, from, spin, delay: (y + 1) * 0.12 + rand() * 0.25, accent });
            group.add(mesh);
          }

      /* ---------- Sizing ---------- */
      const resize = () => {
        const { width, height } = host.getBoundingClientRect();
        if (!width || !height) return;
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(() => {
        resize();
        if (reduced) draw(10);
      });
      ro.observe(host);

      /* ---------- Pointer lean ---------- */
      const pointer = { x: 0, y: 0 };
      const lean = { x: 0, y: 0 };
      const onPointer = (e: PointerEvent) => {
        pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
        pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
      };
      if (!reduced) window.addEventListener("pointermove", onPointer, { passive: true });

      /* ---------- Frame ---------- */
      let spread = 0;
      const tmp = new THREE.Vector3();

      function draw(t: number) {
        // Scroll spread, eased so it never jumps.
        const target = reduced ? 0 : clamp01(progress.get() * 1.4);
        spread += (target - spread) * 0.08;
        lean.x += (pointer.x - lean.x) * 0.05;
        lean.y += (pointer.y - lean.y) * 0.05;

        // A pick every 5s: the orange block slides out along its diagonal, then back.
        const cycle = (t - 2.6) % 5;
        const pick = reduced || t < 2.6 || cycle > 1.6 ? 0 : Math.sin((cycle / 1.6) * Math.PI);

        for (const b of blocks) {
          const k = reduced ? 1 : easeOut(clamp01((t - 0.15 - b.delay) / 1.25));
          tmp.copy(b.home).multiplyScalar(1 + spread * 0.75);
          if (b.accent) tmp.addScaledVector(b.home, pick * 0.55);
          b.mesh.position.lerpVectors(b.from, tmp, k);
          b.mesh.quaternion.slerpQuaternions(b.spin, identity, k);
          b.mesh.scale.setScalar(0.4 + 0.6 * k);
        }

        const sway = reduced ? 0 : Math.sin(t * 0.32) * 0.35;
        group.rotation.set(0.5 + lean.y * 0.18 + spread * 0.3, -0.72 + sway + lean.x * 0.4 + spread * 0.9, 0);
        group.position.y = reduced ? 0 : Math.sin(t * 0.9) * 0.08;

        renderer.render(scene, camera);
      }

      /* ---------- Loop: only while visible ---------- */
      let raf = 0;
      let visible = true;
      const clock = new THREE.Timer();
      const loop = (now: number) => {
        clock.update(now);
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
      const io = new IntersectionObserver(([entry]) => {
        visible = entry.isIntersecting;
        if (visible) run();
        else pause();
      });
      io.observe(host);
      const onVisibility = () => (document.hidden ? pause() : run());
      document.addEventListener("visibilitychange", onVisibility);

      if (reduced) draw(10);
      else run();

      teardown = () => {
        pause();
        io.disconnect();
        ro.disconnect();
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pointermove", onPointer);
        geometry.dispose();
        floor.geometry.dispose();
        (floor.material as InstanceType<typeof THREE.Material>).dispose();
        Object.values(materials).forEach((m) => m.dispose());
        clock.dispose();
        renderer.dispose();
        canvas.remove();
      };
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [enabled, progress]);

  return <div ref={hostRef} aria-hidden className={cn("pointer-events-none", className)} />;
}

import * as THREE from "three";

type Chip = {
  label: string;
  tone: string;
  y: number;
  tilt: number;
  size: number;
};
type Print = {
  k: string;
  n: number;
  x: number;
  y: number;
  rot: number;
  tone: string;
};
type Glyph = {
  c: string;
  s: number;
  col: string;
  dx: number;
  b: number;
  r: number;
  d: number;
};
type SceneData = {
  chips: readonly Chip[];
  prints: readonly Print[];
  spill: readonly Glyph[];
  scanStart: number;
  scanTime: number;
  fallMs: number;
  started: number;
};
export type IntroController = {
  leave(): void;
  focus(on: boolean): void;
  dispose(): void;
};

const D = 1200; // World units = CSS pixels at z=0. Native text shares the camera perspective.
const rad = THREE.MathUtils.degToRad;
const deg = THREE.MathUtils.radToDeg;
const clamp = THREE.MathUtils.clamp;
const ease = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);

function rounded(w: number, h: number) {
  const [tl, tr, br, bl] = [30, 26, 34, 24].map((r) =>
    Math.min(r, w / 2, h / 2),
  );
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + bl, -h / 2);
  s.lineTo(w / 2 - br, -h / 2);
  s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + br);
  s.lineTo(w / 2, h / 2 - tr);
  s.quadraticCurveTo(w / 2, h / 2, w / 2 - tr, h / 2);
  s.lineTo(-w / 2 + tl, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - tl);
  s.lineTo(-w / 2, -h / 2 + bl);
  s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + bl, -h / 2);
  return s;
}

/** DOM faces live in one preserve-3d context: orbit labels behind the opaque window
 * are depth-occluded by the browser. Lit extrusions/planes share these world poses.
 * No texture atlas / rasterized text and no CSS3DRenderer zoom dependency.
 */
export function mountIntro(
  root: HTMLElement,
  data: SceneData,
  fail: () => void,
): IntroController {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    powerPreference: "low-power",
  });
  renderer.setClearColor(0, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.VSMShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const gl = renderer.getContext();
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const software =
    debug &&
    /SwiftShader|llvmpipe|Software Rasterizer|Microsoft Basic Render/i.test(
      gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),
    );
  // Keep real lit geometry on software renderers, but avoid two VSM blur passes
  // on every moving frame. The prefiltered contact shadow keeps the soft paper look.
  renderer.shadowMap.enabled = !software;
  const canvas = renderer.domElement;
  canvas.className = "intro-webgl";
  canvas.setAttribute("aria-hidden", "true");
  const dom = document.createElement("div");
  dom.className = "intro-dom";
  dom.setAttribute("aria-hidden", "true");
  root.querySelector(".stack")!.append(canvas, dom);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 1, 4000);
  camera.position.z = D;
  scene.add(new THREE.AmbientLight("#ffffff", 2.1));
  const light = new THREE.DirectionalLight("#ffffff", 2.4);
  light.position.set(-260, 650, 750);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  Object.assign(light.shadow.camera, {
    left: -900,
    right: 900,
    top: 800,
    bottom: -900,
    near: 1,
    far: 2400,
  });
  light.shadow.normalBias = 2;
  light.shadow.radius = 6;
  light.shadow.blurSamples = 4;
  scene.add(light);
  const rig = new THREE.Group();
  scene.add(rig);
  const win = new THREE.Group();
  win.rotation.order = "ZYX";
  rig.add(win);
  const body = new THREE.Mesh(
    new THREE.BufferGeometry(),
    new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 1 }),
  );
  body.castShadow = true;
  win.add(body);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(2200, 1800),
    new THREE.ShadowMaterial({ opacity: 0.07 }),
  );
  floor.rotation.x = -1.05;
  floor.receiveShadow = true;
  rig.add(floor);
  let contactTexture: THREE.CanvasTexture | null = null;
  let contact: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> | null =
    null;
  if (software) {
    const source = document.createElement("canvas");
    source.width = 256;
    source.height = 128;
    const ctx = source.getContext("2d")!;
    ctx.filter = "blur(12px)";
    ctx.fillStyle = "#1d2420";
    ctx.fillRect(26, 28, 204, 72);
    contactTexture = new THREE.CanvasTexture(source);
    contact = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: contactTexture,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    contact.rotation.x = -1.05;
    rig.add(contact);
    floor.visible = false;
  }
  const sourceWin = root.querySelector<HTMLElement>(".scene .win")!;
  const face = sourceWin.cloneNode(true) as HTMLElement;
  face.classList.add("webgl-window");
  const note = root
    .querySelector<HTMLElement>(".scene .note")!
    .cloneNode(true) as HTMLElement;
  face.append(note);
  dom.append(face);
  const title = face.querySelector(".win-title")!;

  const prints = data.prints.map((p) => {
    const el = document.createElement("span");
    el.className = `webgl-print ${p.tone}`;
    el.innerHTML = `<b class="pk">${p.k}</b><b class="webgl-count">0</b>`;
    dom.append(el);
    const mat = new THREE.MeshStandardMaterial({
      color: "#ffffff",
      roughness: 1,
      transparent: true,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 3), mat);
    mesh.rotation.order = "ZYX";
    mesh.castShadow = true;
    rig.add(mesh);
    return {
      p,
      el,
      mesh,
      mat,
      count: el.querySelector(".webgl-count")!,
      lastA: NaN,
      lastFade: NaN,
      lastCount: -1,
    };
  });
  const chips = data.chips.map((c) => {
    const el = document.createElement("span");
    el.className = `chip3 webgl-chip ${c.tone}`;
    el.textContent = c.label;
    dom.append(el);
    return { c, el, pos: new THREE.Vector3() };
  });
  const glyphs = data.spill.map((g) => {
    const el = document.createElement("span");
    el.className = `sp webgl-glyph ${g.col}`;
    el.textContent = g.c;
    dom.append(el);
    return {
      g,
      el,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      bounces: 0,
      born: false,
      angle: 0,
    };
  });
  const rings = [0, 1].map(() => {
    const mat = new THREE.MeshBasicMaterial({
      color: "#2f7a5e",
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 96), mat);
    mesh.rotation.x = -1.05;
    rig.add(mesh);
    return { mesh, mat };
  });
  let width = 0,
    height = 0,
    w = 0,
    h = 0,
    mobile = false,
    baseY = 0;
  let dead = false,
    raf = 0,
    last = performance.now(),
    elapsed = (last - data.started) / 1000;
  let hiddenAt = 0,
    focused = false,
    hovering = false,
    orbit = 0;
  let tx = 0,
    ty = 0,
    rx = 0,
    ry = 0;
  let exitAt: number | null = null,
    exitTime = 0,
    physicsTime = 0;
  let drop = 0,
    dropV = 0,
    impact = false,
    lastImpact = -10,
    bounce = 0,
    fall = 0,
    gravity = 0;
  let dirty = true,
    previousRx = 0,
    previousRy = 0;
  let titleDone = false;
  const transforms = new WeakMap<HTMLElement, string>();
  const styles = new WeakMap<HTMLElement, Map<string, string>>();
  function style(el: HTMLElement, property: string, value: string) {
    let cache = styles.get(el);
    if (!cache) {
      cache = new Map();
      styles.set(el, cache);
    }
    if (cache.get(property) !== value) {
      el.style.setProperty(property, value);
      cache.set(property, value);
    }
  }
  const pos = new THREE.Vector3();

  const resize = () => {
    dirty = true;
    width = root.clientWidth;
    height = root.clientHeight;
    mobile = width < 600;
    w = sourceWin.offsetWidth;
    h = sourceWin.offsetHeight;
    baseY = height / 2 - height * 0.28 - h / 2;
    camera.aspect = width / height;
    camera.fov = deg(2 * Math.atan(height / (2 * D)));
    camera.updateProjectionMatrix();
    // Software rasterizers cannot sustain a full DPR-2 shadow canvas. Native DOM
    // text retains device resolution; only the decorative WebGL layer uses DPR 1.
    renderer.setPixelRatio(
      Math.min(devicePixelRatio, mobile ? 1.5 : 2, software ? 1 : 2),
    );
    renderer.setSize(width, height);
    root.dataset.dpr = String(renderer.getPixelRatio());
    face.style.width = `${w}px`;
    body.geometry.dispose();
    body.geometry = new THREE.ExtrudeGeometry(rounded(w, h), {
      depth: 8,
      bevelEnabled: false,
      curveSegments: 16,
    });
    body.position.z = -8;
    floor.position.set(0, baseY - h / 2 - 28, -80);
    if (contact) contact.position.copy(floor.position);
    prints.forEach(({ mesh, el }) => {
      const pw = mobile ? 88 : 150,
        ph = mobile ? 84 : 128;
      mesh.scale.set(pw, ph, 1);
      el.style.width = `${pw}px`;
      el.style.height = `${ph}px`;
    });
    chips.forEach(({ el, c }) => {
      el.style.fontSize = `${mobile ? Math.max(10, c.size * 0.76) : c.size}px`;
    });
    glyphs.forEach(({ el, g }) => {
      el.style.fontSize = `${g.s * (mobile ? 0.76 : 1)}px`;
    });
  };
  resize();
  function place(
    el: HTMLElement,
    p: THREE.Vector3,
    r: THREE.Euler,
    sx = 1,
    sy = 1,
  ) {
    pos.copy(p).applyEuler(rig.rotation);
    const value = `translate(-50%, -50%) translate3d(${pos.x}px,${-pos.y}px,${pos.z}px) rotateZ(${-deg(r.z)}deg) rotateY(${deg(r.y + rig.rotation.y)}deg) rotateX(${-deg(r.x + rig.rotation.x)}deg) scale(${sx},${sy})`;
    if (transforms.get(el) !== value) {
      el.style.transform = value;
      transforms.set(el, value);
    }
  }
  function step(dt: number) {
    physicsTime += dt;
    if (physicsTime < 0.12) {
      drop = -26 * ease(physicsTime / 0.12);
      return;
    }
    if (!impact) {
      const t = Math.min(physicsTime, data.fallMs / 1000) - 0.12;
      drop = -26 + 0.5 * gravity * t * t;
      dropV = gravity * t;
      if (physicsTime >= data.fallMs / 1000) {
        drop = fall;
        impact = true;
        lastImpact = physicsTime;
        bounce = 1;
        dropV = -Math.sqrt(2 * gravity * 96);
      }
    } else if (bounce < 3) {
      dropV += gravity * dt;
      drop += dropV * dt;
      if (drop >= fall && dropV > 0) {
        drop = fall;
        lastImpact = physicsTime;
        bounce++;
        dropV = bounce === 2 ? -Math.sqrt(2 * gravity * 24) : 0;
      }
    }
    if (!impact) return;
    glyphs.forEach((s, i) => {
      if (physicsTime - data.fallMs / 1000 - s.g.d < 0) return;
      if (!s.born) {
        s.born = true;
        s.x = (i % 2 ? 1 : -1) * Math.min(w * 0.3, 90);
        s.y = 8;
        s.vx = s.g.dx * (mobile ? 0.4 : 1) * 1.4;
        s.vy = Math.sqrt(2 * 9000 * s.g.b * (mobile ? 0.65 : 1));
      }
      if (s.bounces < 3) {
        s.vy -= 9000 * dt;
        s.y += s.vy * dt;
        s.x += s.vx * dt;
        if (s.y <= 0 && s.vy < 0) {
          s.y = 0;
          s.vy *= -0.66;
          s.vx *= 0.66;
          s.bounces++;
        }
      } else {
        s.x += s.vx * dt;
        s.vx *= Math.exp(-7 * dt);
      }
      s.angle += rad(s.g.r) * dt * 2.2;
    });
  }
  function draw(now: number) {
    if (dead || document.hidden) return;
    const frameSeconds = Math.max(0, (now - last) / 1000);
    const dt = Math.min(frameSeconds, 0.064);
    last = now;
    elapsed += frameSeconds;
    if (exitAt !== null) {
      exitTime = (now - exitAt) / 1000;
      while (physicsTime + 1 / 240 <= exitTime) step(1 / 240);
    }
    rx += (tx - rx) * (1 - Math.exp(-9 * dt));
    ry += (ty - ry) * (1 - Math.exp(-9 * dt));
    if (Math.abs(tx - rx) < 0.00001) rx = tx;
    if (Math.abs(ty - ry) < 0.00001) ry = ty;
    const tiltChanged = rx !== previousRx || ry !== previousRy;
    rig.rotation.set(exitAt === null ? rx : 0, exitAt === null ? ry : 0, 0);
    const t = elapsed,
      wobble = Math.max(0, t - 0.52);
    const envelope = t > 0.52 && wobble < 1.6 ? Math.exp(-3.5 * wobble) : 0;
    const squash = Math.sin(wobble * 17) * envelope;
    let y =
      t < 0.52
        ? -height * Math.pow(1 - ease(t / 0.52), 1.1)
        : -22 * Math.sin(wobble * 14) * envelope;
    let sx = 1 + 0.055 * squash,
      sy = 1 - 0.075 * squash;
    let ax = rad(5) * Math.sin(wobble * 13) * envelope;
    let az = -rad(mobile ? 0 : 2.2) + rad(5) * Math.sin(wobble * 15) * envelope;
    let ay = rad(3) * Math.sin(wobble * 11) * envelope;
    if (exitAt !== null) {
      y = drop;
      const hit = Math.max(0, 1 - (physicsTime - lastImpact) / 0.11);
      sx = 1 + 0.14 * hit;
      sy = 1 - 0.19 * hit;
      if (!impact) {
        sx = 1.03;
        sy = 0.97;
      }
      ax = -rad(7) * Math.max(0, 1 - physicsTime / 0.5);
      ay = 0;
      az = rad(
        impact
          ? Math.sin((physicsTime - 0.615) * 18) *
              3 *
              Math.exp(-(physicsTime - 0.615) * 3)
          : -2 + 7 * clamp(physicsTime / 0.615, 0, 1),
      );
    }
    win.position.set(0, baseY - y, 0);
    win.rotation.set(ax, ay, az, "ZYX");
    win.scale.set(sx, sy, 1);
    place(face, win.position, win.rotation, sx, sy);
    const phase =
      exitAt === null
        ? t < 0.52
          ? "landing"
          : t < 1.6
            ? "wobble"
            : t < 3.4
              ? "scan"
              : "orbit"
        : exitTime < 0.12
          ? "charge"
          : !impact
            ? "fall"
            : physicsTime - lastImpact < 0.1
              ? "impact"
              : "bounce";
    if (face.dataset.phase !== phase) face.dataset.phase = phase;
    if (!titleDone && t >= data.scanStart + data.scanTime + 0.2) {
      title.textContent = "已解析 · 6 个技能词 · 2 处待确认";
      titleDone = true;
    }
    style(
      note,
      "visibility",
      exitAt === null && t >= 3.5 ? "visible" : "hidden",
    );
    const fading = exitAt === null ? 1 : 1 - clamp(exitTime / 0.18, 0, 1);
    prints.forEach((print, i) => {
      const { p, el, mesh, mat, count } = print;
      const start = data.scanStart + 0.4 + i * 0.42,
        a = ease((t - start) / 0.76);
      const n = Math.round(p.n * ease((t - start - 0.2) / 1.4));
      if (n !== print.lastCount) {
        count.textContent = String(n);
        print.lastCount = n;
      }
      if (
        print.lastA === a &&
        print.lastFade === fading &&
        !tiltChanged &&
        !dirty
      )
        return;
      mesh.position.set(
        mobile ? [-125, -42, 42, 125][i] : p.x,
        baseY - h / 2 - (mobile ? 58 : 78) - p.y * 0.33 + (1 - a) * 150,
        20 + i * 3,
      );
      mesh.rotation.set(
        rad(-44) * a,
        rad(8) * (1 - a),
        -rad(mobile ? 0 : p.rot) * a,
        "ZYX",
      );
      mesh.visible = t >= start && fading > 0;
      mat.opacity = a * fading;
      style(el, "opacity", String(a * fading));
      style(el, "filter", a < 1 ? `blur(${(1 - a) * 7}px)` : "none");
      place(el, mesh.position, mesh.rotation);
      print.lastA = a;
      print.lastFade = fading;
    });
    if (!focused && !hovering && exitAt === null)
      orbit += (frameSeconds * Math.PI * 2) / 26;
    const paused = String(focused || hovering);
    if (root.dataset.paused !== paused) root.dataset.paused = paused;
    chips.forEach(({ c, el, pos: cp }, i) => {
      const start =
        data.scanStart +
        ([1, 2, 2, 3, 5, 8, 6, 9, 9, 9, 9][i] / 10) * data.scanTime +
        0.15;
      const a = ease((t - start) / 0.9),
        angle = (i / chips.length) * Math.PI * 2 + orbit;
      const radius = Math.min(410, width * (mobile ? 0.34 : 0.44)) * a;
      cp.set(
        Math.sin(angle) * radius,
        baseY + c.y + Math.cos(angle) * radius * 0.16,
        Math.cos(angle) * radius * 0.5,
      );
      style(el, "opacity", String(a * fading));
      place(
        el,
        cp,
        new THREE.Euler(
          -rig.rotation.x,
          -rig.rotation.y,
          -rad(mobile ? 0 : clamp(c.tilt, -3, 3)),
          "ZYX",
        ),
      );
    });
    rings.forEach(({ mesh, mat }, i) => {
      const age = (t - 0.5 - i * 0.13) / 1.2;
      mesh.position.set(0, baseY - h / 2 - 14, 8);
      const scale = 170 + ease(age) * 370;
      mesh.scale.set(scale, scale, 1);
      mat.opacity = age > 0 && age < 1 ? (1 - age) * 0.22 * fading : 0;
      mesh.visible = mat.opacity > 0;
    });
    if (contact) {
      const landed = clamp(1 - Math.abs(y) / height, 0, 1);
      contact.scale.set(w * (1.4 - 0.25 * landed), h * (0.9 - 0.2 * landed), 1);
      contact.material.opacity = landed * 0.13 * fading;
      contact.visible = contact.material.opacity > 0;
    }
    const floorY = height / 2 - height * 0.87;
    glyphs.forEach((s, i) => {
      if (!s.born) return;
      style(s.el, "opacity", String(1 - clamp((exitTime - 1.66) / 0.2, 0, 1)));
      // z>=32: strictly in front of the 8px extrusion, emitted from the bottom lip.
      place(
        s.el,
        new THREE.Vector3(
          s.x,
          floorY + s.y + s.g.s * (mobile ? 0.38 : 0.5),
          32 + (i % 3) * 4,
        ),
        new THREE.Euler(0, 0, s.angle, "ZYX"),
      );
      if (s.el.dataset.bounces !== String(s.bounces))
        s.el.dataset.bounces = String(s.bounces);
    });
    // Orbiting DOM billboards do not change WebGL geometry or its shadow map.
    // Stable scenes need no repeated GPU draw; hovering only redraws while tilt settles.
    const tiltMoving =
      Math.abs(rx - previousRx) + Math.abs(ry - previousRy) > 0.00005;
    const geometryMoving = exitAt === null ? t < 4.1 : exitTime < 1.65;
    if (dirty || geometryMoving || tiltMoving) {
      if (!software) renderer.shadowMap.needsUpdate = true;
      renderer.render(scene, camera);
      dirty = false;
    }
    previousRx = rx;
    previousRy = ry;
    raf = requestAnimationFrame(draw);
  }
  void face.offsetHeight;
  face.getAnimations({ subtree: true }).forEach((a) => {
    a.currentTime = elapsed * 1000;
  });
  const pointer = (e: PointerEvent) => {
    if (
      e.pointerType !== "mouse" ||
      !matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return;
    tx = rad(clamp((e.clientY / height - 0.5) * 16, -8, 8));
    ty = rad(clamp((e.clientX / width - 0.5) * 24, -12, 12));
    const b = face.getBoundingClientRect();
    hovering =
      e.clientX >= b.left &&
      e.clientX <= b.right &&
      e.clientY >= b.top &&
      e.clientY <= b.bottom;
  };
  const leavePointer = () => {
    hovering = false;
    tx = 0;
    ty = 0;
  };
  const visibility = () => {
    if (document.hidden) {
      hiddenAt = performance.now();
      cancelAnimationFrame(raf);
      root.dataset.rendering = "paused";
      root.getAnimations({ subtree: true }).forEach((a) => a.pause());
    } else {
      const now = performance.now();
      if (exitAt !== null && hiddenAt) exitAt += now - hiddenAt;
      last = now;
      hiddenAt = 0;
      root.getAnimations({ subtree: true }).forEach((a) => a.play());
      root.dataset.rendering = "active";
      raf = requestAnimationFrame(draw);
    }
  };
  const lost = (e: Event) => {
    e.preventDefault();
    fail();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(root);
  root.addEventListener("pointermove", pointer);
  root.addEventListener("pointerleave", leavePointer);
  document.addEventListener("visibilitychange", visibility);
  canvas.addEventListener("webglcontextlost", lost);
  root.dataset.rendering = "active";
  if (!document.hidden) raf = requestAnimationFrame(draw);
  return {
    leave() {
      if (exitAt !== null) return;
      exitAt = performance.now();
      fall = Math.max(20, height * 0.87 - (height * 0.28 + h));
      gravity = (2 * (fall + 26)) / Math.pow(data.fallMs / 1000 - 0.12, 2);
    },
    focus(on) {
      focused = on;
    },
    dispose() {
      if (dead) return;
      dead = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      root.removeEventListener("pointermove", pointer);
      root.removeEventListener("pointerleave", leavePointer);
      document.removeEventListener("visibilitychange", visibility);
      canvas.removeEventListener("webglcontextlost", lost);
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const materials = Array.isArray(o.material)
            ? o.material
            : [o.material];
          materials.forEach((m) => m.dispose());
        }
      });
      light.shadow.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      contactTexture?.dispose();
      canvas.remove();
      dom.remove();
      scene.clear();
      root.dataset.rendering = "disposed";
    },
  };
}

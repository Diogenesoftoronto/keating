/**
 * Procedural Three.js rendition of the Keating brand CRT monitor.
 * Built from primitives (no GLTF assets) so it ships as pure code and
 * always matches the brand palette. The screen uses a canvas texture
 * styled after the Keating CLI, with physical model controls.
 */
import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, RoundedBox } from "@react-three/drei";
import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import * as THREE from "three";

const C = {
  cream: "#ece2cb",
  creamDark: "#ddd1b5",
  ink: "#26261f",
  green: "#1e9b50",
  bezel: "#15150f",
  screen: "#0c1510",
  ledRed: "#d5604b",
  ledAmber: "#e8a33d",
  ledGreen: "#43b964",
  button: "#5fbe72",
} as const;

const SCREEN_W = 1.86;
const SCREEN_H = 1.12;
const SCREEN_CANVAS_W = 1040;
const SCREEN_CANVAS_H = 626;

const INTRO_LINES = [
  { text: "KEATING CLI", color: "#4be388", bold: true, size: 32 },
  { text: "v0.0.0 // hyperteacher protocol", color: "#9dbfa8", bold: false, size: 22 },
  { text: "$ keating learn recursion", color: "#dcefe0", bold: false, size: 24 },
  { text: "diagnosing knowledge graph... 3 gaps mapped", color: "#2e9a5c", bold: false, size: 24 },
  { text: "you      | can you just explain it to me?", color: "#e8a33d", bold: false, size: 24 },
  { text: "keating  | no. you explain it to me.", color: "#4be388", bold: false, size: 24 },
  { text: "keating  | what happens without a base case?", color: "#4be388", bold: false, size: 24 },
  { text: "you      | the call stack grows until it overflows.", color: "#e8a33d", bold: false, size: 24 },
  { text: "gap closed: call_stack. 2 remaining.", color: "#4be388", bold: false, size: 24 },
  { text: "keating@web:~$ _", color: "#dcefe0", bold: false, size: 24 },
] as const;

const BOOT_SEQUENCE = [
  "BIOS OK",
  "MEM TEST ........ 64K OK",
  "CRT DRIVER v2.1",
  "LOADING hyperteacher.bin",
  "MOUNT /dev/keating",
  "LINK ESTABLISHED",
  "STANDBY",
] as const;

function useMaterials() {
  return useMemo(() => {
    const mk = (color: string, rough = 0.55, metal = 0.05) =>
      new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
    const led = (color: string) =>
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, roughness: 0.3 });
    return {
      cream: mk(C.cream, 0.5),
      creamDark: mk(C.creamDark, 0.6),
      ink: mk(C.ink, 0.45, 0.15),
      green: mk(C.green, 0.45),
      bezel: mk(C.bezel, 0.35, 0.1),
      ledRed: led(C.ledRed),
      ledAmber: led(C.ledAmber),
      ledGreen: led(C.ledGreen),
      button: mk(C.button, 0.4),
      buttonHover: mk("#7ed896", 0.35),
    };
  }, []);
}

type Mats = ReturnType<typeof useMaterials>;

/** Load an image as a Three texture without suspending the Canvas. */
function useBrandTexture(url: string) {
  const [tex, setTex] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    let active = true;
    new THREE.TextureLoader().load(url, (t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 8;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      if (active) setTex(t);
      else t.dispose();
    });
    return () => {
      active = false;
    };
  }, [url]);
  return tex;
}

function makeScreenTexture(
  powered: boolean,
  bootProgress: number,
  typeProgress: number,
  version: string,
  cursorBlink: number,
  hoverLine: number,
) {
  const canvas = document.createElement("canvas");
  canvas.width = SCREEN_CANVAS_W;
  canvas.height = SCREEN_CANVAS_H;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (!ctx) return texture;

  ctx.fillStyle = powered ? C.screen : "#050806";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let y = 0; y < canvas.height; y += 4) {
    ctx.fillStyle = powered ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.28)";
    ctx.fillRect(0, y, canvas.width, 1);
  }

  if (!powered) {
    ctx.fillStyle = "#1e9b50";
    ctx.font = "700 30px 'JetBrains Mono', 'Space Mono', monospace";
    ctx.globalAlpha = 0.3 + Math.abs(Math.sin(cursorBlink * 4)) * 0.7;
    ctx.fillText("KEATING CRT // STANDBY", 34, 60);
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#2e9a5c";
    ctx.font = "22px 'JetBrains Mono', 'Space Mono', monospace";
    ctx.fillText("press the green hardware button", 34, 104);
    return texture;
  }

  if (bootProgress < BOOT_SEQUENCE.length) {
    ctx.fillStyle = "#4be388";
    ctx.font = "24px 'JetBrains Mono', 'Space Mono', monospace";
    const visibleLines = Math.floor(bootProgress);
    for (let i = 0; i <= visibleLines && i < BOOT_SEQUENCE.length; i++) {
      const line = BOOT_SEQUENCE[i];
      const frac = i === visibleLines ? bootProgress - visibleLines : 1;
      const chars = Math.floor(line.length * frac);
      ctx.globalAlpha = 0.5 + frac * 0.5;
      ctx.fillText(line.slice(0, chars), 34, 60 + i * 36);
    }
    ctx.globalAlpha = 1;
    return texture;
  }

  let totalChars = 0;
  const charSpeed = 1.5;

  for (const line of INTRO_LINES) {
    totalChars += line.text.length;
  }

  const progress = Math.min(typeProgress * charSpeed, totalChars);
  let drawn = 0;
  const baseX = 34;
  let baseY = 58;

  for (let i = 0; i < INTRO_LINES.length; i++) {
    const line = INTRO_LINES[i];
    const lineChars = line.text.length;
    const lineStart = drawn;
    const lineEnd = drawn + lineChars;
    let charsToDraw = 0;

    if (progress >= lineEnd) {
      charsToDraw = lineChars;
    } else if (progress > lineStart) {
      charsToDraw = Math.floor(progress - lineStart);
    }

    drawn += lineChars;

    if (charsToDraw > 0) {
      ctx.font = `${line.bold ? "700 " : ""}${line.size}px 'JetBrains Mono', 'Space Mono', monospace`;

      if (i === hoverLine && charsToDraw === lineChars) {
        ctx.fillStyle = "rgba(75, 227, 136, 0.1)";
        ctx.fillRect(baseX - 8, baseY - line.size + 4, SCREEN_CANVAS_W - 60, line.size + 8);
      }

      ctx.fillStyle = line.color;

      if (line.text.startsWith("keating") || line.text.startsWith("you")) {
        ctx.shadowColor = line.color;
        ctx.shadowBlur = hoverLine === i ? 12 : 4;
      }

      const visible = line.text.slice(0, charsToDraw);
      ctx.fillText(visible, baseX, baseY);
      ctx.shadowBlur = 0;

      if (charsToDraw < lineChars && Math.sin(cursorBlink * 6) > 0) {
        const metrics = ctx.measureText(visible);
        ctx.fillStyle = line.color;
        ctx.fillRect(baseX + metrics.width, baseY - line.size + 6, 14, line.size - 6);
      }
    }

    baseY += line.size + 12;
  }

  ctx.fillStyle = "rgba(75, 227, 136, 0.04)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // CRT vignette: brighter center, darkened corners (matches brand crt-monitor)
  const vignette = ctx.createRadialGradient(
    canvas.width / 2,
    canvas.height / 2,
    canvas.height * 0.25,
    canvas.width / 2,
    canvas.height / 2,
    canvas.width * 0.62,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(0.7, "rgba(0,0,0,0.12)");
  vignette.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (Math.random() > 0.98) {
    ctx.fillStyle = "rgba(75, 227, 136, 0.02)";
    ctx.fillRect(0, Math.random() * canvas.height, canvas.width, 4);
  }

  return texture;
}

function TuiScreen({
  powered,
  bootProgress,
  typeProgress,
  onNavigate,
  cursorBlink,
}: {
  powered: boolean;
  bootProgress: number;
  typeProgress: number;
  onNavigate: (to: string) => void;
  cursorBlink: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const [hoverLine, setHoverLine] = useState(-1);
  const version = String(import.meta.env.APP_VERSION ?? "dev");

  const texture = useMemo(() => {
    const tex = makeScreenTexture(powered, bootProgress, typeProgress, version, cursorBlink, hoverLine);
    tex.needsUpdate = true;
    return tex;
  }, [powered, bootProgress, typeProgress, version, cursorBlink, hoverLine]);

  useFrame(() => {
    if (texture) texture.needsUpdate = true;
  });

  const handlePointerMove = useCallback(
    (e: THREE.Event) => {
      if (!powered || bootProgress < BOOT_SEQUENCE.length) return;
      const uv = (e as any).uv;
      if (!uv) return;
      const y = (1 - uv.y) * SCREEN_CANVAS_H;
      const lineIndex = Math.floor((y - 58) / 36);
      setHoverLine(lineIndex >= 0 && lineIndex < INTRO_LINES.length ? lineIndex : -1);
    },
    [powered, bootProgress],
  );

  return (
    <mesh
      ref={meshRef}
      position={[0, 1.04, 0.936]}
      onClick={() => powered && bootProgress >= BOOT_SEQUENCE.length && onNavigate("/chat")}
      onPointerMove={handlePointerMove}
      onPointerOver={() => {
        document.body.style.cursor = powered && bootProgress >= BOOT_SEQUENCE.length ? "pointer" : "default";
      }}
      onPointerOut={() => {
        document.body.style.cursor = "";
        setHoverLine(-1);
      }}
    >
      <planeGeometry args={[SCREEN_W, SCREEN_H]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
}

function Monitor({
  mats,
  powered,
  onTogglePower,
  onNavigate,
  bootProgress,
  typeProgress,
  cursorBlink,
}: {
  mats: Mats;
  powered: boolean;
  onTogglePower: () => void;
  onNavigate: (to: string) => void;
  bootProgress: number;
  typeProgress: number;
  cursorBlink: number;
}) {
  const [hoverPart, setHoverPart] = useState<string | null>(null);
  const lockupTex = useBrandTexture("/brand/logo-lockup.png");
  const kMarkTex = useBrandTexture("/brand/logo-k-cream.png");

  return (
    <group>
      <RoundedBox args={[2.5, 1.84, 1.5]} radius={0.12} position={[0, 0.94, 0.16]} material={mats.cream} />
      <RoundedBox args={[2.3, 1.68, 1.1]} radius={0.12} position={[0, 0.92, -0.5]} material={mats.creamDark} />

      <RoundedBox args={[2.04, 1.28, 0.08]} radius={0.1} position={[0, 1.04, 0.89]} material={mats.bezel} />
      <mesh position={[0, 1.04, 0.932]}>
        <planeGeometry args={[1.9, 1.16]} />
        <meshStandardMaterial
          color={C.screen}
          roughness={0.25}
          emissive={powered ? "#0c1510" : "#000000"}
          emissiveIntensity={powered ? 0.15 : 0}
        />
      </mesh>

      <TuiScreen
        powered={powered}
        bootProgress={bootProgress}
        typeProgress={typeProgress}
        onNavigate={onNavigate}
        cursorBlink={cursorBlink}
      />

      {([mats.ledRed, mats.ledAmber, mats.ledGreen] as const).map((m, i) => {
        const isActive = powered && (i === 2 || (i === 1 && bootProgress < BOOT_SEQUENCE.length));
        return (
          <mesh
            key={i}
            position={[-1.02 + i * 0.14, 1.78, 0.915]}
            rotation={[Math.PI / 2, 0, 0]}
          >
            <cylinderGeometry args={[0.035, 0.035, 0.03, 12]} />
            <meshStandardMaterial
              color={[C.ledRed, C.ledAmber, C.ledGreen][i]}
              emissive={[C.ledRed, C.ledAmber, C.ledGreen][i]}
              emissiveIntensity={isActive ? 0.8 + Math.sin(cursorBlink * 8 + i) * 0.4 : 0.15}
              roughness={0.3}
            />
          </mesh>
        );
      })}

      {[0, 1, 2, 3, 4].map((i) => (
        <RoundedBox
          key={i}
          args={[0.035, 0.09, 0.02]}
          radius={0.01}
          position={[0.78 + i * 0.08, 1.77, 0.915]}
          material={mats.bezel}
        />
      ))}

      {/* Power LED */}
      <mesh
        position={[-1.05, 0.22, 0.915]}
        rotation={[Math.PI / 2, 0, 0]}
        onClick={onTogglePower}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
          setHoverPart("power");
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
          setHoverPart(null);
        }}
      >
        <cylinderGeometry args={[0.035, 0.035, 0.03, 12]} />
        <meshStandardMaterial
          color={powered ? C.ledGreen : C.ledRed}
          emissive={powered ? C.ledGreen : C.ledRed}
          emissiveIntensity={hoverPart === "power" ? 1.2 : powered ? 0.8 : 0.4}
          roughness={0.3}
        />
      </mesh>

      {/* Brand lockup printed on the bezel (K KEATING), like the brand CRT */}
      {lockupTex && (
        <mesh
          position={[-0.66, 0.22, 0.917]}
          onClick={() => powered && onNavigate("/chat")}
          onPointerOver={() => {
            if (powered) {
              document.body.style.cursor = "pointer";
              setHoverPart("lockup");
            }
          }}
          onPointerOut={() => {
            document.body.style.cursor = "";
            setHoverPart(null);
          }}
        >
          <planeGeometry args={[0.5, 0.5 / 1.836]} />
          <meshBasicMaterial
            map={lockupTex}
            transparent
            toneMapped={false}
            opacity={hoverPart === "lockup" ? 1 : 0.92}
          />
        </mesh>
      )}

      {/* Ports */}
      <RoundedBox args={[0.5, 0.18, 0.03]} radius={0.08} position={[0.28, 0.22, 0.915]} material={mats.creamDark} />
      <mesh position={[0.14, 0.22, 0.935]} rotation={[Math.PI / 2, 0, 0]} material={mats.bezel}>
        <cylinderGeometry args={[0.04, 0.04, 0.02, 12]} />
      </mesh>
      <mesh position={[0.42, 0.22, 0.935]} rotation={[Math.PI / 2, 0, 0]} material={mats.bezel}>
        <cylinderGeometry args={[0.04, 0.04, 0.02, 12]} />
      </mesh>

      {/* Power button */}
      <RoundedBox
        args={[0.18, 0.14, 0.06]}
        radius={0.03}
        position={[0.78, 0.22, 0.92]}
        material={hoverPart === "powerBtn" ? mats.buttonHover : powered ? mats.button : mats.creamDark}
        onClick={onTogglePower}
        onPointerOver={() => {
          document.body.style.cursor = "pointer";
          setHoverPart("powerBtn");
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
          setHoverPart(null);
        }}
      />

      {/* Action button — the Keating launch key, branded with the K mark */}
      <group
        position={[1.04, 0.22, 0]}
        onClick={() => powered && onNavigate("/chat")}
        onPointerOver={() => {
          document.body.style.cursor = powered ? "pointer" : "default";
          if (powered) setHoverPart("actionBtn");
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
          setHoverPart(null);
        }}
      >
        <RoundedBox
          args={[0.18, 0.14, 0.06]}
          radius={0.03}
          position={[0, 0, 0.92 + (hoverPart === "actionBtn" ? -0.012 : 0)]}
          material={hoverPart === "actionBtn" ? mats.buttonHover : powered ? mats.button : mats.creamDark}
        />
        {kMarkTex && (
          <mesh position={[0, 0, 0.951 + (hoverPart === "actionBtn" ? -0.012 : 0)]}>
            <planeGeometry args={[0.1, 0.1]} />
            <meshBasicMaterial
              map={kMarkTex}
              transparent
              toneMapped={false}
              opacity={powered ? 0.95 : 0.4}
            />
          </mesh>
        )}
      </group>

      {/* feet */}
      {[1, -1].map((s) => (
        <RoundedBox key={s} args={[0.5, 0.08, 0.9]} radius={0.03} position={[s * 0.85, 0.0, 0]} material={mats.ink} />
      ))}
    </group>
  );
}

function Sway({ children, animate }: { children: React.ReactNode; animate: boolean }) {
  const group = useRef<THREE.Group>(null);
  const mouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!animate) return;
    const onMove = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.current.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [animate]);

  useFrame(({ clock }) => {
    if (!animate || !group.current) return;
    const t = clock.elapsedTime;
    const idleY = Math.sin(t * 0.4) * 0.025;
    const idleX = Math.cos(t * 0.3) * 0.012;

    const targetY = mouse.current.x * 0.22 + idleY;
    const targetX = -mouse.current.y * 0.12 + idleX;

    const clampedY = Math.max(-0.45, Math.min(0.45, targetY));
    const clampedX = Math.max(-0.25, Math.min(0.25, targetX));

    group.current.rotation.y = THREE.MathUtils.lerp(group.current.rotation.y, clampedY, 0.06);
    group.current.rotation.x = THREE.MathUtils.lerp(group.current.rotation.x, clampedX, 0.06);
  });

  return <group ref={group}>{children}</group>;
}

function Scene({
  animate,
  powered,
  onTogglePower,
  onNavigate,
}: {
  animate: boolean;
  powered: boolean;
  onTogglePower: () => void;
  onNavigate: (to: string) => void;
}) {
  const mats = useMaterials();
  const [bootProgress, setBootProgress] = useState<number>(BOOT_SEQUENCE.length);
  const [typeProgress, setTypeProgress] = useState<number>(9999);
  const cursorBlink = useRef(0);
  const lastPowerOn = useRef(0);

  useFrame(({ clock }) => {
    cursorBlink.current = clock.elapsedTime;

    if (!powered) {
      setBootProgress(0);
      setTypeProgress(0);
      return;
    }

    const t = clock.elapsedTime;
    if (lastPowerOn.current === 0) lastPowerOn.current = t;
    const elapsed = t - lastPowerOn.current;

    const bootProg = Math.min(BOOT_SEQUENCE.length, elapsed * 4);
    setBootProgress(bootProg);

    if (bootProg >= BOOT_SEQUENCE.length) {
      const typeElapsed = elapsed - BOOT_SEQUENCE.length * 0.25;
      setTypeProgress(Math.max(0, typeElapsed * 2.5));
    }
  });

  useEffect(() => {
    if (powered) {
      lastPowerOn.current = 0;
    }
  }, [powered]);

  return (
    <>
      <ambientLight intensity={0.85} />
      <directionalLight position={[4, 7, 6]} intensity={1.5} color="#fff7e6" />
      <directionalLight position={[-5, 3, -4]} intensity={0.5} color="#dfeede" />
      <pointLight
        position={[0, 1.5, 2]}
        intensity={powered ? 0.6 : 0}
        color="#4be388"
        distance={4}
        decay={2}
      />
      <Sway animate={animate}>
        <group position={[0, -1.0, 0]}>
          <Monitor
            mats={mats}
            powered={powered}
            onTogglePower={onTogglePower}
            onNavigate={onNavigate}
            bootProgress={bootProgress}
            typeProgress={typeProgress}
            cursorBlink={cursorBlink.current}
          />
          <ContactShadows position={[0, -0.05, 0]} opacity={0.3} scale={5.5} blur={2.4} far={2.5} color={C.ink} />
        </group>
      </Sway>
    </>
  );
}

export default function KeatingHero3D({ onNavigate }: { onNavigate?: (to: string) => void }) {
  const navigate = onNavigate ?? ((to: string) => window.location.assign(to));
  const [powered, setPowered] = useState(true);

  const reducedMotion = useMemo(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    [],
  );

  return (
    <Canvas
      dpr={[1, 2]}
      camera={{ fov: 30, position: [0, 0.1, 5.8] }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
      aria-label="Retro Keating CRT monitor running the Keating terminal"
    >
      <Scene
        animate={!reducedMotion}
        powered={powered}
        onTogglePower={() => setPowered((value) => !value)}
        onNavigate={navigate}
      />
    </Canvas>
  );
}

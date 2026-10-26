"use client";

import { MutableRefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D, { ForceGraphMethods, LinkObject, NodeObject } from "react-force-graph-3d";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { forceCollide, forceX, forceY, forceZ } from "d3-force-3d";
import { EVIDENCE_LINK_COLOR, mapNodeColor, mapNodeRadius } from "./mapPalette";
import type { MapData, MapLink, MapNode } from "./types";

export interface MapSceneControls {
  resetView: () => void;
  flyTo: (id: string) => void;
}

type GNode = NodeObject<MapNode & { anchor: [number, number, number] }>;
type GLink = LinkObject<GNode, Omit<MapLink, "source" | "target"> & { sourceKind: MapNode["kind"] }>;

interface MaterialSet {
  core: THREE.MeshLambertMaterial;
  coreDim: THREE.MeshLambertMaterial;
  halo: THREE.SpriteMaterial;
  haloDim: THREE.SpriteMaterial;
}

interface NodeVisual {
  kind: MapNode["kind"];
  core: THREE.Mesh;
  halo: THREE.Sprite;
  label: SpriteText | null;
  mats: MaterialSet;
  haloScale: number;
  pulse: boolean;
}

const FIT_PADDING = 40;

function idOf(end: GLink["source"]): string {
  return typeof end === "object" && end ? String(end.id) : String(end);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Evenly spread domain anchors over a sphere so each domain grows its own lobe. */
function fibonacciSphere(count: number, radius: number): [number, number, number][] {
  const points: [number, number, number][] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = count === 1 ? 0 : 1 - (i / (count - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    points.push([Math.cos(theta) * r * radius, y * radius, Math.sin(theta) * r * radius]);
  }
  return points;
}

function createResources() {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.22, "rgba(255,255,255,0.45)");
    g.addColorStop(0.55, "rgba(255,255,255,0.08)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const haloTexture = new THREE.CanvasTexture(canvas);
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const materials = new Map<string, MaterialSet>();

  const materialsFor = (color: string, faded: boolean): MaterialSet => {
    const key = `${color}|${faded}`;
    const cached = materials.get(key);
    if (cached) return cached;
    const base = faded ? 0.45 : 1;
    const core = (opacity: number) =>
      new THREE.MeshLambertMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.55,
        transparent: opacity < 1,
        opacity,
      });
    const halo = (opacity: number) =>
      new THREE.SpriteMaterial({
        map: haloTexture,
        color,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity,
      });
    const set = { core: core(base), coreDim: core(0.14), halo: halo(0.7 * base), haloDim: halo(0.05) };
    materials.set(key, set);
    return set;
  };

  const dispose = () => {
    haloTexture.dispose();
    sphere.dispose();
    for (const set of materials.values()) Object.values(set).forEach((m) => m.dispose());
    materials.clear();
  };

  return { sphere, materialsFor, dispose };
}

function createStarfield(): THREE.Points {
  const count = 500;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 700 + Math.random() * 700;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: "#8c9093",
    size: 1.6,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  return new THREE.Points(geometry, material);
}

export default function ConstitutionMapScene({
  data,
  width,
  height,
  compact = false,
  paused = false,
  showCorpus = true,
  showLabels = true,
  selectedId = null,
  onSelect,
  controlRef,
}: {
  data: MapData;
  width: number;
  height: number;
  compact?: boolean;
  paused?: boolean;
  showCorpus?: boolean;
  showLabels?: boolean;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  controlRef?: MutableRefObject<MapSceneControls | null>;
}) {
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const resources = useMemo(createResources, []);
  const visuals = useRef(new Map<string, NodeVisual>());
  // Until the user takes the camera, keep the whole constellation framed: the
  // custom forces keep spreading the layout for seconds after mount, and the
  // container may still be settling its measured size.
  const userCamera = useRef(false);
  const lastFit = useRef(0);
  const autoFit = useCallback(
    (durationMs: number) => {
      if (userCamera.current) return;
      lastFit.current = performance.now();
      fgRef.current?.zoomToFit(durationMs, compact ? 10 : FIT_PADDING);
    },
    [compact],
  );
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const fontFace = useRef("monospace");

  const focusId = compact ? null : (hoverId ?? selectedId);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!map.has(a)) map.set(a, new Set());
      map.get(a)!.add(b);
    };
    for (const l of data.links) {
      add(l.source, l.target);
      add(l.target, l.source);
    }
    return map;
  }, [data]);

  const prevGraph = useRef<{ nodes: GNode[]; links: GLink[] } | null>(null);
  const graphData = useMemo(() => {
    const previous = new Map((prevGraph.current?.nodes ?? []).map((n) => [String(n.id), n]));
    const domains = data.nodes.filter((n) => n.kind === "domain");
    const anchorPoints = fibonacciSphere(domains.length, 150 + domains.length * 10);
    const anchors = new Map(domains.map((d, i) => [d.label, anchorPoints[i]]));
    const kinds = new Map(data.nodes.map((n) => [n.id, n.kind]));
    const nodes: GNode[] = data.nodes.map((n) => {
      let anchor: [number, number, number] = [0, 0, 0];
      const own = n.kind === "domain" ? [anchors.get(n.label)] : (n.domains ?? []).map((d) => anchors.get(d));
      const points = own.filter((p): p is [number, number, number] => !!p);
      if (points.length) {
        anchor = [0, 1, 2].map((axis) => points.reduce((sum, p) => sum + p[axis], 0) / points.length) as [
          number,
          number,
          number,
        ];
      }
      const prev = previous.get(n.id);
      return { ...n, anchor, ...(prev ? { x: prev.x, y: prev.y, z: prev.z } : {}) };
    });
    const links: GLink[] = data.links.map((l) => ({ ...l, sourceKind: kinds.get(l.source) ?? "position" }));
    visuals.current.clear();
    const graph = { nodes, links };
    prevGraph.current = graph;
    return graph;
  }, [data]);

  // Below this width compact labels are unreadable specks.
  const compactLabels = width >= 220;
  const focusRef = useRef({ focusId, showLabels, neighbors, compact, compactLabels });
  focusRef.current = { focusId, showLabels, neighbors, compact, compactLabels };

  const applyVisual = useCallback((id: string, v: NodeVisual) => {
    const { focusId, showLabels, neighbors, compact, compactLabels } = focusRef.current;
    const lit = !focusId || id === focusId || !!neighbors.get(focusId)?.has(id);
    v.core.material = lit ? v.mats.core : v.mats.coreDim;
    v.halo.material = lit ? v.mats.halo : v.mats.haloDim;
    if (!v.pulse) v.halo.scale.setScalar(v.haloScale * (id === focusId ? 1.5 : 1));
    if (v.label) {
      const always = v.kind === "domain";
      v.label.visible = compact ? always && compactLabels : always || showLabels || (!!focusId && lit);
      v.label.material.opacity = lit ? 1 : 0.1;
    }
  }, []);

  useEffect(() => {
    visuals.current.forEach((v, id) => applyVisual(id, v));
  }, [focusId, showLabels, neighbors, compactLabels, applyVisual]);

  const buildNode = useCallback(
    (node: GNode) => {
      const n = node as GNode & MapNode;
      const radius = mapNodeRadius(n);
      const color = mapNodeColor(n);
      const mats = resources.materialsFor(color, n.kind === "position" && n.status === "Retired");
      const group = new THREE.Group();
      const core = new THREE.Mesh(resources.sphere, mats.core);
      core.scale.setScalar(radius);
      const halo = new THREE.Sprite(mats.halo);
      const haloScale = radius * (n.kind === "domain" ? 3.4 : 4.6);
      halo.scale.setScalar(haloScale);
      // Only the sphere is hoverable; halos and labels overlap neighbours.
      halo.raycast = () => {};
      group.add(halo, core);

      let label: SpriteText | null = null;
      if (!compact || n.kind === "domain") {
        const textHeight = compact ? 14 : n.kind === "domain" ? 7.5 : n.kind === "capture" ? 2 : 2.6;
        label = new SpriteText(
          truncate(n.label, n.kind === "domain" ? 40 : 46),
          textHeight,
          n.kind === "domain" ? "#f2f2ef" : "rgba(232,232,227,0.62)",
        );
        label.fontFace = fontFace.current;
        label.fontWeight = n.kind === "domain" ? "600" : "400";
        label.material.depthWrite = false;
        label.material.transparent = true;
        label.position.y = -(radius + textHeight * 0.9);
        label.raycast = () => {};
        group.add(label);
      }

      const v: NodeVisual = {
        kind: n.kind,
        core,
        halo,
        label,
        mats,
        haloScale,
        pulse: n.kind === "position" && n.confidence === "Contested",
      };
      visuals.current.set(String(n.id), v);
      applyVisual(String(n.id), v);
      return group;
    },
    [resources, compact, applyVisual],
  );

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = () => setReducedMotion(mq.matches);
    mq.addEventListener("change", onChange);
    const geist = getComputedStyle(document.documentElement).getPropertyValue("--font-geist-mono").trim();
    if (geist) fontFace.current = `${geist}, ui-monospace, monospace`;
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Forces, starfield and imperative controls — once per mounted graph.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    fg.d3Force("charge")?.strength((n: GNode) => (n.kind === "domain" ? (compact ? -200 : -320) : -60));
    fg.d3Force("link")?.distance((l: GLink) => (l.kind === "domain" ? 40 : 70));
    const pull = (n: GNode) => (n.kind === "domain" ? 0.12 : 0.04);
    fg.d3Force("x", forceX<GNode>((n) => n.anchor[0]).strength(pull));
    fg.d3Force("y", forceY<GNode>((n) => n.anchor[1]).strength(pull));
    fg.d3Force("z", forceZ<GNode>((n) => n.anchor[2]).strength(pull));
    fg.d3Force(
      "collide",
      forceCollide<GNode>((n) => mapNodeRadius(n as GNode & MapNode) * 1.7 + 1.5).iterations(2),
    );
    fg.d3ReheatSimulation();

    const controls = fg.controls() as THREE.EventDispatcher<{ start: object }>;
    const takeCamera = () => {
      userCamera.current = true;
    };
    controls.addEventListener("start", takeCamera);

    const stars = createStarfield();
    fg.scene().add(stars);

    if (controlRef) {
      controlRef.current = {
        resetView: () => fgRef.current?.zoomToFit(800, FIT_PADDING),
        flyTo: (id) => {
          const node = prevGraph.current?.nodes.find((n) => n.id === id);
          if (node) flyTo(node);
        },
      };
    }
    return () => {
      controls.removeEventListener("start", takeCamera);
      fg.scene().remove(stars);
      stars.geometry.dispose();
      (stars.material as THREE.Material).dispose();
      if (controlRef) controlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => resources.dispose(), [resources]);

  useEffect(() => {
    autoFit(0);
  }, [width, height, autoFit]);

  // Compact mode orbits slowly on its own; the Map view leaves the camera to the user.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    const controls = fg.controls() as { autoRotate?: boolean; autoRotateSpeed?: number };
    controls.autoRotate = compact && !reducedMotion && !paused;
    controls.autoRotateSpeed = 0.6;
    if (compact && paused) fg.pauseAnimation();
    else fg.resumeAnimation();
  }, [compact, paused, reducedMotion]);

  // Contested positions breathe: one shared halo material per colour, so the
  // per-frame work is a single opacity write plus a scale per contested node.
  useEffect(() => {
    if (reducedMotion || paused) return;
    let raf = 0;
    const tick = (t: number) => {
      const s = 0.5 + 0.5 * Math.sin(t / 420);
      const { focusId } = focusRef.current;
      let pulseMat: THREE.SpriteMaterial | null = null;
      visuals.current.forEach((v, id) => {
        if (!v.pulse) return;
        pulseMat = v.mats.halo;
        v.halo.scale.setScalar(v.haloScale * (id === focusId ? 1.5 : 1) * (1 + 0.35 * s));
      });
      if (pulseMat) (pulseMat as THREE.SpriteMaterial).opacity = 0.3 + 0.5 * s;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reducedMotion, paused]);

  const flyTo = (node: GNode) => {
    const fg = fgRef.current;
    if (!fg) return;
    userCamera.current = true;
    const { x = 0, y = 0, z = 0 } = node;
    const distance = 90 + mapNodeRadius(node as GNode & MapNode) * 14;
    const h = Math.hypot(x, y, z);
    const ratio = 1 + distance / (h || 1);
    fg.cameraPosition(
      h < 1 ? { x, y, z: z + distance } : { x: x * ratio, y: y * ratio, z: z * ratio },
      { x, y, z },
      1200,
    );
  };

  const linkColor = useCallback(
    (l: GLink) => {
      const evidence = l.kind === "evidence";
      if (!focusId) return evidence ? `rgba(${EVIDENCE_LINK_COLOR},0.5)` : "rgba(242,242,239,0.09)";
      const on = idOf(l.source) === focusId || idOf(l.target) === focusId;
      if (!on) return "rgba(242,242,239,0.02)";
      return evidence ? `rgba(${EVIDENCE_LINK_COLOR},0.9)` : "rgba(242,242,239,0.5)";
    },
    [focusId],
  );

  const sourceHidden = (kind: MapNode["kind"]) => !showCorpus && (kind === "corpus" || kind === "capture");

  return (
    <ForceGraph3D<GNode, GLink>
      ref={fgRef}
      width={width}
      height={height}
      graphData={graphData}
      backgroundColor="rgba(0,0,0,0)"
      showNavInfo={false}
      controlType="orbit"
      nodeThreeObject={buildNode}
      nodeLabel={() => ""}
      nodeVisibility={(n) => !sourceHidden((n as GNode & MapNode).kind)}
      linkVisibility={(l) => !sourceHidden(l.sourceKind)}
      linkColor={linkColor}
      linkWidth={0}
      linkOpacity={1}
      warmupTicks={compact ? 120 : 60}
      cooldownTime={compact ? 4000 : 8000}
      enablePointerInteraction={!compact}
      // Off on purpose: 3d-force-graph's drag-end fakes a pointerup that crashes
      // OrbitControls, and node drag fights orbiting on touch screens.
      enableNodeDrag={false}
      showPointerCursor={!compact}
      onNodeHover={(n) => setHoverId(n ? String(n.id) : null)}
      onNodeClick={(n) => {
        onSelect?.(String(n.id));
        flyTo(n);
      }}
      onBackgroundClick={() => onSelect?.(null)}
      onEngineTick={() => {
        if (performance.now() - lastFit.current > 700) autoFit(compact ? 300 : 500);
      }}
      onEngineStop={() => autoFit(600)}
    />
  );
}

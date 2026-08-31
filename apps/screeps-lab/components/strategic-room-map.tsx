"use client";

import {
  type KeyboardEvent,
  type PointerEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import { Badge } from "@/components/ui/badge";
import type { Point, Snapshot } from "@/lib/control-plane";
import type { RoomDevelopmentSummary } from "@/lib/room-development";
import {
  buildStrategicRoomMapModel,
  humanizeStructureType,
  markersAt,
  ROOM_SIZE,
  type StrategicStructureMarker,
  terrainAt,
} from "@/lib/strategic-room-map";

type StrategicRoomMapProps = {
  snapshot: Snapshot | null;
  development: RoomDevelopmentSummary;
  layout?: "stacked" | "operator";
};

type LayerVisibility = {
  terrain: boolean;
  blueprint: boolean;
  built: boolean;
  sites: boolean;
  defense: boolean;
  diagnostic: boolean;
};

type GlyphMarker = Pick<StrategicStructureMarker, "x" | "y" | "structureType">;

const structureColor = (structureType: string): string => {
  switch (structureType) {
    case "spawn":
      return "#f2c75c";
    case "extension":
      return "#57c79d";
    case "tower":
      return "#e09a4d";
    case "storage":
    case "terminal":
    case "factory":
      return "#5bb8df";
    case "link":
      return "#45cad5";
    case "lab":
      return "#b684e1";
    case "observer":
    case "powerSpawn":
    case "nuker":
    case "extractor":
      return "#ef7891";
    case "container":
      return "#a88b5d";
    case "road":
      return "#607686";
    case "rampart":
    case "constructedWall":
      return "#df6753";
    default:
      return "#91a0ae";
  }
};

const rampartStroke = (marker: StrategicStructureMarker): string => {
  switch (marker.rampartCondition?.state) {
    case "critical":
      return "#ff5e5e";
    case "strengthening":
      return "#f0b44c";
    case "at-target":
      return "#53d89e";
    default:
      return "#d8e2e8";
  }
};

function StructureGlyph({
  marker,
  fill,
  stroke,
  opacity = 1,
  dashed = false,
}: {
  marker: GlyphMarker;
  fill: string;
  stroke: string;
  opacity?: number;
  dashed?: boolean;
}) {
  const common = {
    fill,
    stroke,
    strokeWidth: 0.1,
    strokeDasharray: dashed ? "0.22 0.14" : undefined,
    opacity,
    vectorEffect: "non-scaling-stroke" as const,
  };
  const x = marker.x;
  const y = marker.y;
  switch (marker.structureType) {
    case "road":
      return <circle {...common} cx={x + 0.5} cy={y + 0.5} r={0.15} />;
    case "extension":
      return <circle {...common} cx={x + 0.5} cy={y + 0.5} r={0.3} />;
    case "spawn":
      return (
        <path
          {...common}
          d={`M${x + 0.5} ${y + 0.08}L${x + 0.88} ${y + 0.3}V${y + 0.7}L${x + 0.5} ${y + 0.92}L${x + 0.12} ${y + 0.7}V${y + 0.3}Z`}
        />
      );
    case "tower":
      return (
        <g {...common}>
          <circle cx={x + 0.5} cy={y + 0.56} r={0.29} />
          <path d={`M${x + 0.5} ${y + 0.46}V${y + 0.13}H${x + 0.76}`} />
        </g>
      );
    case "container":
      return (
        <rect
          {...common}
          x={x + 0.15}
          y={y + 0.25}
          width={0.7}
          height={0.5}
          rx={0.08}
        />
      );
    case "storage":
      return (
        <g {...common}>
          <rect
            x={x + 0.12}
            y={y + 0.12}
            width={0.76}
            height={0.76}
            rx={0.08}
          />
          <path
            d={`M${x + 0.3} ${y + 0.36}H${x + 0.7}M${x + 0.3} ${y + 0.58}H${x + 0.7}`}
          />
        </g>
      );
    case "terminal":
    case "link":
      return (
        <path
          {...common}
          d={`M${x + 0.5} ${y + 0.08}L${x + 0.92} ${y + 0.5}L${x + 0.5} ${y + 0.92}L${x + 0.08} ${y + 0.5}Z`}
        />
      );
    case "lab":
      return (
        <g {...common}>
          <circle cx={x + 0.5} cy={y + 0.58} r={0.3} />
          <path d={`M${x + 0.38} ${y + 0.12}H${x + 0.62}V${y + 0.35}`} />
        </g>
      );
    case "factory":
    case "extractor":
      return (
        <path
          {...common}
          d={`M${x + 0.27} ${y + 0.1}H${x + 0.73}L${x + 0.93} ${y + 0.5}L${x + 0.73} ${y + 0.9}H${x + 0.27}L${x + 0.07} ${y + 0.5}Z`}
        />
      );
    case "observer":
      return (
        <g {...common}>
          <path
            d={`M${x + 0.08} ${y + 0.5}Q${x + 0.5} ${y + 0.12} ${x + 0.92} ${y + 0.5}Q${x + 0.5} ${y + 0.88} ${x + 0.08} ${y + 0.5}Z`}
          />
          <circle cx={x + 0.5} cy={y + 0.5} r={0.13} />
        </g>
      );
    case "powerSpawn":
      return (
        <g {...common}>
          <circle cx={x + 0.5} cy={y + 0.5} r={0.39} />
          <path
            d={`M${x + 0.56} ${y + 0.16}L${x + 0.32} ${y + 0.54}H${x + 0.52}L${x + 0.44} ${y + 0.84}L${x + 0.7} ${y + 0.43}H${x + 0.5}Z`}
          />
        </g>
      );
    case "nuker":
      return (
        <path
          {...common}
          d={`M${x + 0.5} ${y + 0.06}L${x + 0.9} ${y + 0.86}L${x + 0.5} ${y + 0.7}L${x + 0.1} ${y + 0.86}Z`}
        />
      );
    case "rampart":
      return (
        <path
          {...common}
          d={`M${x + 0.5} ${y + 0.07}L${x + 0.88} ${y + 0.2}V${y + 0.52}Q${x + 0.88} ${y + 0.78} ${x + 0.5} ${y + 0.94}Q${x + 0.12} ${y + 0.78} ${x + 0.12} ${y + 0.52}V${y + 0.2}Z`}
        />
      );
    case "constructedWall":
      return (
        <g {...common}>
          <rect x={x + 0.1} y={y + 0.1} width={0.8} height={0.8} rx={0.05} />
          <path
            d={`M${x + 0.2} ${y + 0.2}L${x + 0.8} ${y + 0.8}M${x + 0.8} ${y + 0.2}L${x + 0.2} ${y + 0.8}`}
          />
        </g>
      );
    default:
      return (
        <rect
          {...common}
          x={x + 0.16}
          y={y + 0.16}
          width={0.68}
          height={0.68}
          rx={0.1}
        />
      );
  }
}

const squarePath = (points: Iterable<Point>, inset = 0, size = 1): string =>
  [...points]
    .map(
      (point) =>
        `M${point.x + inset} ${point.y + inset}h${size}v${size}h-${size}z`,
    )
    .join("");

const markerSummary = (marker: StrategicStructureMarker): string => {
  const states: string[] = [];
  if (marker.planned) states.push("planned");
  if (marker.built) states.push(marker.offPlan ? "built off-plan" : "built");
  if (marker.constructionSite) {
    states.push(marker.offPlan ? "off-plan site" : "construction site");
  }
  if (marker.ownership === "foreign") states.push("foreign");
  if (marker.ownership === "neutral") states.push("neutral");
  if (marker.ownership === "unverified") states.push("ownership unverified");
  if (marker.blockerReasons.length > 0) states.push("blocked");
  return `${humanizeStructureType(marker.structureType)} · ${states.join(" · ")}`;
};

const compactNumber = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

const formatCompact = (value: number): string => compactNumber.format(value);

export function StrategicRoomMap({
  snapshot,
  development,
  layout = "stacked",
}: StrategicRoomMapProps) {
  const model = useMemo(
    () => buildStrategicRoomMapModel(snapshot, development),
    [snapshot, development],
  );
  const [layers, setLayers] = useState<LayerVisibility>({
    terrain: true,
    blueprint: model.blueprint.active,
    built: true,
    sites: true,
    defense: model.blueprint.active,
    diagnostic: false,
  });
  const [zoom, setZoom] = useState(1);
  const [selectedPoint, setSelectedPoint] = useState<Point | null>(null);
  const [hoverPoint, setHoverPoint] = useState<Point | null>(null);
  const mapInteractionRef = useRef<HTMLButtonElement>(null);
  const rawId = useId();
  const patternId = `strategic-map-${rawId.replaceAll(":", "")}`;

  useEffect(() => {
    setLayers((current) => ({
      ...current,
      blueprint: model.blueprint.active,
      defense: model.blueprint.active,
      diagnostic: false,
    }));
  }, [model.blueprint.active]);

  const defaultPoint =
    model.missingQueue[0] ??
    model.naturals.find((item) => item.kind === "controller") ??
    model.structures.find((item) => item.built) ??
    null;
  const focusedPoint = selectedPoint ?? defaultPoint;
  const detailPoint = hoverPoint ?? focusedPoint;
  const evidence = detailPoint ? markersAt(model, detailPoint) : null;
  const terrain = detailPoint
    ? terrainAt(model.terrain, detailPoint)
    : "unknown";
  const terrainPaths = useMemo(
    () => ({
      walls: squarePath(model.terrain?.walls ?? []),
      swamps: squarePath(model.terrain?.swamps ?? []),
      exits: squarePath(model.terrain?.exits ?? [], 0.12, 0.76),
    }),
    [model.terrain],
  );
  const diagnosticEvidence =
    detailPoint && layers.diagnostic
      ? model.diagnosticStructures.filter(
          (item) => item.x === detailPoint.x && item.y === detailPoint.y,
        )
      : [];
  const selectedEvidence = focusedPoint ? markersAt(model, focusedPoint) : null;
  const selectedDiagnosticEvidence =
    focusedPoint && layers.diagnostic
      ? model.diagnosticStructures.filter(
          (item) => item.x === focusedPoint.x && item.y === focusedPoint.y,
        )
      : [];
  const selectionAnnouncement = focusedPoint
    ? [
        `Selected tile ${focusedPoint.x}, ${focusedPoint.y}.`,
        `${terrainAt(model.terrain, focusedPoint)} terrain.`,
        ...((selectedEvidence?.naturals.length ?? 0) > 0 ||
        (selectedEvidence?.anchors.length ?? 0) > 0 ||
        (selectedEvidence?.structures.length ?? 0) > 0 ||
        selectedDiagnosticEvidence.length > 0
          ? [
              [
                ...(selectedEvidence?.naturals.map((item) => item.kind) ?? []),
                ...(selectedEvidence?.anchors.map(
                  (item) => `planned ${item.kind}`,
                ) ?? []),
                ...(selectedEvidence?.structures.map(markerSummary) ?? []),
                ...selectedDiagnosticEvidence.map(
                  (item) =>
                    `retained diagnostic ${humanizeStructureType(item.structureType)}`,
                ),
              ].join(". "),
            ]
          : ["No object evidence at this coordinate."]),
      ].join(" ")
    : "No tile selected.";

  const fullMapOrigin = -3;
  const fullMapSize = 56;
  const viewSize = fullMapSize / zoom;
  const viewCenter = focusedPoint
    ? { x: focusedPoint.x + 0.5, y: focusedPoint.y + 0.5 }
    : { x: 25, y: 25 };
  const clampViewOrigin = (center: number) =>
    Math.min(
      fullMapOrigin + fullMapSize - viewSize,
      Math.max(fullMapOrigin, center - viewSize / 2),
    );
  const viewBox = `${clampViewOrigin(viewCenter.x)} ${clampViewOrigin(
    viewCenter.y,
  )} ${viewSize} ${viewSize}`;

  const pointFromPointer = (
    event: PointerEvent<SVGSVGElement>,
  ): Point | null => {
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return null;
    const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
    const x = Math.floor(local.x);
    const y = Math.floor(local.y);
    return x >= 0 && x < ROOM_SIZE && y >= 0 && y < ROOM_SIZE ? { x, y } : null;
  };

  const moveSelection = (event: KeyboardEvent<HTMLButtonElement>) => {
    const point = focusedPoint ?? { x: 25, y: 25 };
    let next: Point | null = null;
    if (event.key === "ArrowLeft")
      next = { x: Math.max(0, point.x - 1), y: point.y };
    if (event.key === "ArrowRight")
      next = { x: Math.min(49, point.x + 1), y: point.y };
    if (event.key === "ArrowUp")
      next = { x: point.x, y: Math.max(0, point.y - 1) };
    if (event.key === "ArrowDown")
      next = { x: point.x, y: Math.min(49, point.y + 1) };
    if (event.key === "Home") next = { x: 0, y: 0 };
    if (event.key === "End") next = { x: 49, y: 49 };
    if (!next) return;
    event.preventDefault();
    setSelectedPoint(next);
  };

  const setLayer = (layer: keyof LayerVisibility) => {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
  };

  const layerControls: Array<{
    id: keyof LayerVisibility;
    label: string;
    color: string;
    disabled: boolean;
  }> = [
    {
      id: "terrain",
      label: "Terrain",
      color: "#5d8272",
      disabled: model.terrain === null,
    },
    {
      id: "blueprint",
      label: "Blueprint",
      color: "#55c9d4",
      disabled: !model.blueprint.active,
    },
    { id: "built", label: "Built", color: "#f3f8fb", disabled: false },
    { id: "sites", label: "Sites", color: "#f2a365", disabled: false },
    {
      id: "defense",
      label: "Defense",
      color: "#df6753",
      disabled: !model.blueprint.active,
    },
    {
      id: "diagnostic",
      label: "Retained diag",
      color: "#efbc5d",
      disabled: model.blueprint.active || !model.retainedPlanPresent,
    },
  ];

  const visibleMarkers = useMemo(
    () =>
      model.structures.filter((marker) => {
        if (marker.defense) {
          return (
            (layers.defense && marker.planned) ||
            (layers.built && marker.built) ||
            (layers.sites && marker.constructionSite)
          );
        }
        return (
          (layers.blueprint && marker.planned) ||
          (layers.built && marker.built) ||
          (layers.sites && marker.constructionSite)
        );
      }),
    [
      layers.blueprint,
      layers.built,
      layers.defense,
      layers.sites,
      model.structures,
    ],
  );

  const accessibleCounts = `${model.counts.planned} runtime-authorized planned structures, ${model.counts.built} built structures, ${model.counts.constructionSites} construction sites, ${model.counts.offPlan} off-plan objects, and ${model.counts.blocked} verified blockers`;

  return (
    <section
      className="min-w-0 max-w-full"
      aria-label="Strategic room map"
      data-map-layout={layout}
    >
      <div
        className={`mb-3 rounded-xl border px-3 py-3 ${
          model.blueprint.active
            ? "border-emerald-400/20 bg-emerald-400/[0.045]"
            : "border-amber-400/25 bg-amber-400/[0.055]"
        }`}
      >
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              aria-hidden="true"
              className={`size-2 shrink-0 rounded-full ${
                model.blueprint.active
                  ? "bg-emerald-400 shadow-[0_0_12px_rgb(52_211_153/0.65)]"
                  : "bg-amber-400"
              }`}
            />
            <span className="min-w-0 text-xs font-medium text-foreground/85">
              {model.blueprint.active
                ? "Runtime projection current · active blueprint"
                : "Blueprint withheld · retained plan is diagnostic only"}
            </span>
          </div>
          <Badge
            variant="outline"
            className="max-w-full font-mono text-[0.7rem] text-muted-foreground"
          >
            {model.blueprint.status}
          </Badge>
        </div>
        {!model.blueprint.active ? (
          <p className="mt-2 break-words text-xs leading-5 text-amber-100/65">
            {model.blueprint.reason} Built structures, construction sites, and
            terrain remain independently visible.
          </p>
        ) : null}
      </div>

      <fieldset className="mb-3 grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <legend className="sr-only">Map layers</legend>
        {layerControls.map((control) => (
          <button
            key={control.id}
            type="button"
            aria-pressed={layers[control.id]}
            disabled={control.disabled}
            title={control.disabled ? model.blueprint.reason : undefined}
            onClick={() => setLayer(control.id)}
            className={`flex min-h-11 min-w-0 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-9 sm:py-1.5 ${
              layers[control.id]
                ? "border-white/15 bg-white/[0.07] text-foreground"
                : "border-white/7 bg-black/10 text-muted-foreground"
            }`}
          >
            <span className="min-w-0 truncate">{control.label}</span>
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-[3px]"
              style={{
                backgroundColor: layers[control.id]
                  ? control.color
                  : "transparent",
                border: `1px solid ${control.color}`,
              }}
            />
          </button>
        ))}
      </fieldset>

      <div
        className={`grid min-w-0 gap-4 ${
          layout === "operator"
            ? "xl:grid-cols-[minmax(0,1.55fr)_minmax(22rem,0.75fr)] xl:items-start"
            : ""
        }`}
      >
        <div className="min-w-0">
          <div className="mb-2 flex min-w-0 flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span className="min-w-0">
              {model.counts.built} built · {model.counts.constructionSites}{" "}
              sites ·{" "}
              {model.blueprint.active
                ? `${model.counts.planned} planned`
                : "plan withheld"}
              {model.blueprint.active && development.defense.plannedCount > 0
                ? ` · perimeter ${development.defense.builtCount}/${development.defense.plannedCount} built, ${development.defense.atTargetCount ?? "?"} at target`
                : ""}
            </span>
            <fieldset className="flex shrink-0 items-center gap-1.5 sm:gap-1">
              <legend className="sr-only">Map zoom</legend>
              <span className="mr-1 font-mono text-[0.7rem]" aria-live="polite">
                {zoom.toFixed(zoom % 1 === 0 ? 0 : 1)}×
              </span>
              <button
                type="button"
                aria-label="Zoom out"
                disabled={zoom === 1}
                onClick={() => setZoom((current) => Math.max(1, current - 0.5))}
                className="size-11 rounded-md border border-white/10 bg-black/15 text-base text-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-35 sm:size-8 sm:text-sm"
              >
                −
              </button>
              <button
                type="button"
                aria-label="Reset zoom to full room"
                disabled={zoom === 1}
                onClick={() => setZoom(1)}
                className="h-11 rounded-md border border-white/10 bg-black/15 px-3 font-mono text-[0.7rem] text-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-35 sm:h-8 sm:px-2"
              >
                Reset
              </button>
              <button
                type="button"
                aria-label="Zoom in on selected tile"
                disabled={zoom === 3}
                onClick={() => setZoom((current) => Math.min(3, current + 0.5))}
                className="size-11 rounded-md border border-white/10 bg-black/15 text-base text-foreground/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-35 sm:size-8 sm:text-sm"
              >
                +
              </button>
            </fieldset>
          </div>

          <span
            id={`${patternId}-selection`}
            className="sr-only"
            aria-live="polite"
            aria-atomic="true"
          >
            {selectionAnnouncement}
          </span>
          <button
            type="button"
            ref={mapInteractionRef}
            className="relative block w-full min-w-0 max-w-full cursor-crosshair appearance-none overflow-hidden rounded-xl border border-white/8 bg-[#071017] p-0 text-left shadow-[inset_0_0_42px_rgb(0_0_0/0.38)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70"
            aria-roledescription="interactive room map"
            aria-label={`${model.roomName ?? "Unknown room"} strategic operator map${focusedPoint ? `, selected tile ${focusedPoint.x}, ${focusedPoint.y}` : ""}`}
            aria-describedby={`${patternId}-description ${patternId}-selection`}
            onKeyDown={moveSelection}
          >
            <svg
              className="block aspect-square h-auto w-full max-w-full touch-none select-none"
              viewBox={viewBox}
              role="img"
              aria-label={`${model.roomName ?? "Unknown room"} 50 by 50 room grid`}
              aria-describedby={`${patternId}-description`}
              onPointerMove={(event) => {
                const next = pointFromPointer(event);
                setHoverPoint((current) =>
                  current?.x === next?.x && current?.y === next?.y
                    ? current
                    : next,
                );
              }}
              onPointerLeave={() => setHoverPoint(null)}
              onPointerDown={(event) => {
                const point = pointFromPointer(event);
                if (point) {
                  setSelectedPoint(point);
                  mapInteractionRef.current?.focus({ preventScroll: true });
                }
              }}
            >
              <desc id={`${patternId}-description`}>
                {`Interactive 50 by 50 room map with arrow-key navigation. ${accessibleCounts}.`}
              </desc>
              <defs>
                <pattern
                  id={`${patternId}-grid`}
                  width="1"
                  height="1"
                  patternUnits="userSpaceOnUse"
                >
                  <path
                    d="M1 0H0V1"
                    fill="none"
                    stroke="rgb(255 255 255 / 5%)"
                    strokeWidth="0.045"
                  />
                </pattern>
                <pattern
                  id={`${patternId}-swamp`}
                  width="1"
                  height="1"
                  patternUnits="userSpaceOnUse"
                >
                  <rect width="1" height="1" fill="#17302d" />
                  <path
                    d="M0.15 0.75L0.75 0.15M0.55 1L1 0.55"
                    stroke="#2e5449"
                    strokeWidth="0.08"
                  />
                </pattern>
              </defs>

              <rect x="0" y="0" width="50" height="50" fill="#0a141c" />
              {layers.terrain && model.terrain ? (
                <g aria-label="Terrain">
                  <path
                    d={terrainPaths.swamps}
                    fill={`url(#${patternId}-swamp)`}
                  />
                  <path
                    d={terrainPaths.walls}
                    fill="#202932"
                    stroke="#2b3742"
                    strokeWidth="0.04"
                  />
                  <path d={terrainPaths.exits} fill="#4fd1c5" opacity="0.34" />
                </g>
              ) : null}

              <rect
                x="0"
                y="0"
                width="50"
                height="50"
                fill={`url(#${patternId}-grid)`}
                pointerEvents="none"
              />

              {layers.diagnostic
                ? model.diagnosticStructures.map((marker) => (
                    <StructureGlyph
                      key={`diagnostic:${marker.key}`}
                      marker={marker}
                      fill="rgb(239 188 93 / 0.08)"
                      stroke="#efbc5d"
                      opacity={0.6}
                      dashed
                    />
                  ))
                : null}

              {layers.diagnostic
                ? model.diagnosticAnchors.map((anchor) => (
                    <g key={`diagnostic:${anchor.key}`} opacity={0.6}>
                      <circle
                        cx={anchor.x + 0.5}
                        cy={anchor.y + 0.5}
                        r={0.4}
                        fill="none"
                        stroke="#efbc5d"
                        strokeWidth={0.08}
                        strokeDasharray="0.13 0.1"
                      />
                      <path
                        d={`M${anchor.x + 0.22} ${anchor.y + 0.5}H${anchor.x + 0.78}M${anchor.x + 0.5} ${anchor.y + 0.22}V${anchor.y + 0.78}`}
                        stroke="#efbc5d"
                        strokeWidth={0.07}
                      />
                    </g>
                  ))
                : null}

              {visibleMarkers.map((marker) => {
                const color = structureColor(marker.structureType);
                const showPlanned =
                  marker.planned &&
                  (marker.defense ? layers.defense : layers.blueprint);
                return (
                  <g key={marker.key} aria-label={markerSummary(marker)}>
                    {showPlanned ? (
                      <StructureGlyph
                        marker={marker}
                        fill={color}
                        stroke={color}
                        opacity={marker.built ? 0.26 : 0.68}
                      />
                    ) : null}
                    {layers.built && marker.built ? (
                      <StructureGlyph
                        marker={marker}
                        fill={color}
                        stroke={
                          marker.structureType === "rampart"
                            ? rampartStroke(marker)
                            : marker.offPlan
                              ? "#ff718d"
                              : "#f2f7fa"
                        }
                        opacity={1}
                      />
                    ) : null}
                    {layers.sites && marker.constructionSite ? (
                      <StructureGlyph
                        marker={marker}
                        fill="rgb(242 163 101 / 0.12)"
                        stroke="#f2a365"
                        dashed
                      />
                    ) : null}
                    {marker.offPlan &&
                    ((layers.built && marker.built) ||
                      (layers.sites && marker.constructionSite)) ? (
                      <circle
                        cx={marker.x + 0.5}
                        cy={marker.y + 0.5}
                        r={0.46}
                        fill="none"
                        stroke="#ff718d"
                        strokeWidth={0.09}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    {marker.ownership === "foreign" &&
                    ((layers.built && marker.built) ||
                      (layers.sites && marker.constructionSite)) ? (
                      <rect
                        x={marker.x + 0.03}
                        y={marker.y + 0.03}
                        width={0.94}
                        height={0.94}
                        rx={0.14}
                        fill="none"
                        stroke="#d59cff"
                        strokeWidth={0.08}
                        strokeDasharray="0.12 0.1"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    {marker.ownership === "neutral" &&
                    ((layers.built && marker.built) ||
                      (layers.sites && marker.constructionSite)) ? (
                      <rect
                        x={marker.x + 0.08}
                        y={marker.y + 0.08}
                        width={0.84}
                        height={0.84}
                        rx={0.12}
                        fill="none"
                        stroke="#8aa6b5"
                        strokeWidth={0.07}
                        strokeDasharray="0.08 0.09"
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    {model.blueprint.active &&
                    marker.blockerReasons.length > 0 &&
                    (marker.defense ? layers.defense : layers.blueprint) ? (
                      <path
                        d={`M${marker.x + 0.12} ${marker.y + 0.12}L${marker.x + 0.88} ${marker.y + 0.88}M${marker.x + 0.88} ${marker.y + 0.12}L${marker.x + 0.12} ${marker.y + 0.88}`}
                        fill="none"
                        stroke="#ff5252"
                        strokeWidth={0.15}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                  </g>
                );
              })}

              {model.anchors.map((anchor) =>
                layers.blueprint ? (
                  <g key={anchor.key}>
                    <circle
                      cx={anchor.x + 0.5}
                      cy={anchor.y + 0.5}
                      r={0.4}
                      fill="none"
                      stroke={anchor.kind === "hub" ? "#67b7e3" : "#62d9ce"}
                      strokeWidth={0.09}
                      strokeDasharray="0.14 0.1"
                    />
                    <path
                      d={`M${anchor.x + 0.5} ${anchor.y + 0.22}V${anchor.y + 0.78}M${anchor.x + 0.22} ${anchor.y + 0.5}H${anchor.x + 0.78}`}
                      stroke={anchor.kind === "hub" ? "#67b7e3" : "#62d9ce"}
                      strokeWidth={0.07}
                    />
                  </g>
                ) : null,
              )}

              {model.naturals.map((natural) => {
                if (natural.kind === "source") {
                  return (
                    <g key={natural.key}>
                      <circle
                        cx={natural.x + 0.5}
                        cy={natural.y + 0.5}
                        r={0.36}
                        fill="#f1ce63"
                        stroke="#fff0a6"
                        strokeWidth={0.07}
                      />
                      <circle
                        cx={natural.x + 0.5}
                        cy={natural.y + 0.5}
                        r={0.13}
                        fill="#513f14"
                      />
                    </g>
                  );
                }
                if (natural.kind === "controller") {
                  return (
                    <path
                      key={natural.key}
                      d={`M${natural.x + 0.5} ${natural.y + 0.05}L${natural.x + 0.95} ${natural.y + 0.5}L${natural.x + 0.5} ${natural.y + 0.95}L${natural.x + 0.05} ${natural.y + 0.5}Z`}
                      fill="#886ec4"
                      stroke="#d4c5ff"
                      strokeWidth={0.07}
                    />
                  );
                }
                return (
                  <path
                    key={natural.key}
                    d={`M${natural.x + 0.26} ${natural.y + 0.1}H${natural.x + 0.74}L${natural.x + 0.94} ${natural.y + 0.5}L${natural.x + 0.74} ${natural.y + 0.9}H${natural.x + 0.26}L${natural.x + 0.06} ${natural.y + 0.5}Z`}
                    fill="#5cc7c0"
                    stroke="#b0fff9"
                    strokeWidth={0.06}
                  />
                );
              })}

              {focusedPoint ? (
                <g
                  pointerEvents="none"
                  aria-label={`Selected tile ${focusedPoint.x}, ${focusedPoint.y}`}
                >
                  <rect
                    x={focusedPoint.x + 0.04}
                    y={focusedPoint.y + 0.04}
                    width={0.92}
                    height={0.92}
                    rx={0.08}
                    fill="none"
                    stroke="#68e3f0"
                    strokeWidth={0.13}
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d={`M${focusedPoint.x + 0.5} ${focusedPoint.y - 0.18}V${focusedPoint.y + 0.08}M${focusedPoint.x + 0.5} ${focusedPoint.y + 0.92}V${focusedPoint.y + 1.18}M${focusedPoint.x - 0.18} ${focusedPoint.y + 0.5}H${focusedPoint.x + 0.08}M${focusedPoint.x + 0.92} ${focusedPoint.y + 0.5}H${focusedPoint.x + 1.18}`}
                    stroke="#68e3f0"
                    strokeWidth={0.1}
                    vectorEffect="non-scaling-stroke"
                  />
                </g>
              ) : null}

              {[0, 10, 20, 30, 40, 49].map((coordinate) => (
                <g key={`axis-${coordinate}`}>
                  <text
                    x={coordinate + 0.5}
                    y="-1"
                    textAnchor="middle"
                    fontSize="1.75"
                    className="sm:[font-size:1px]"
                    fill="#9aa8b3"
                  >
                    {coordinate}
                  </text>
                  <text
                    x="-1"
                    y={coordinate + 0.72}
                    textAnchor="end"
                    fontSize="1.75"
                    className="sm:[font-size:1px]"
                    fill="#9aa8b3"
                  >
                    {coordinate}
                  </text>
                </g>
              ))}
              <rect
                x="0"
                y="0"
                width="50"
                height="50"
                fill="none"
                stroke="rgb(255 255 255 / 18%)"
                strokeWidth="0.08"
              />
            </svg>

            {layers.diagnostic ? (
              <span className="pointer-events-none absolute left-2 top-2 rounded-md border border-amber-300/25 bg-[#070d12]/82 px-2.5 py-1.5 font-mono text-[0.69rem] font-semibold tracking-[0.08em] text-amber-200 shadow-lg">
                RETAINED PLAN · DIAGNOSTIC ONLY
              </span>
            ) : null}

            {detailPoint ? (
              <span
                role="tooltip"
                className="pointer-events-none absolute bottom-2 left-2 max-w-[calc(100%-1rem)] rounded-lg border border-white/12 bg-[#071017]/90 px-2.5 py-1.5 text-xs leading-4 shadow-xl backdrop-blur-sm"
              >
                <span className="font-mono text-cyan-200">
                  {detailPoint.x},{detailPoint.y}
                </span>
                <span className="mx-1.5 text-white/25">·</span>
                <span className="capitalize text-muted-foreground">
                  {terrain}
                </span>
                {evidence &&
                (evidence.structures.length > 0 ||
                  evidence.naturals.length > 0 ||
                  evidence.anchors.length > 0 ||
                  diagnosticEvidence.length > 0) ? (
                  <span className="ml-1.5 text-foreground/75">
                    {[
                      ...evidence.naturals.map((item) => item.kind),
                      ...evidence.anchors.map((item) => item.kind),
                      ...evidence.structures.map((item) =>
                        humanizeStructureType(item.structureType),
                      ),
                      ...diagnosticEvidence.map(
                        (item) =>
                          `diagnostic ${humanizeStructureType(item.structureType)}`,
                      ),
                    ].join(" · ")}
                  </span>
                ) : (
                  <span className="ml-1.5 text-muted-foreground">
                    No objects
                  </span>
                )}
              </span>
            ) : null}
          </button>

          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            Select a tile or use arrow keys while the map is focused. Axes are
            room coordinates; aqua edge cells are walkable exits.
          </p>
        </div>

        <div
          className={`grid min-w-0 gap-3 ${
            layout === "operator"
              ? "mt-4 xl:mt-0 xl:content-start xl:grid-cols-1"
              : "mt-4 lg:grid-cols-[minmax(0,0.86fr)_minmax(0,1.14fr)]"
          }`}
        >
          <section
            className="min-w-0 rounded-xl border border-white/8 bg-black/10 p-3"
            aria-label="Selected tile details"
          >
            <div className="flex min-w-0 items-center justify-between gap-2">
              <h3 className="text-[0.66rem] font-medium uppercase tracking-[0.15em] text-primary">
                Tile intelligence
              </h3>
              <Badge
                variant="outline"
                className="shrink-0 font-mono text-[0.62rem] text-muted-foreground"
              >
                {focusedPoint ? `${focusedPoint.x},${focusedPoint.y}` : "—"}
              </Badge>
            </div>
            {!focusedPoint || !evidence ? (
              <p className="mt-3 text-xs leading-5 text-muted-foreground">
                Select any tile to inspect terrain and operational evidence.
              </p>
            ) : (
              <div className="mt-3 grid gap-2 text-xs">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-white/7 bg-white/[0.025] px-2.5 py-2">
                  <span className="text-muted-foreground">Terrain</span>
                  <span className="capitalize text-foreground/80">
                    {terrain}
                  </span>
                </div>
                {evidence.naturals.map((natural) => (
                  <div
                    key={natural.key}
                    className="rounded-lg border border-white/7 bg-white/[0.025] px-2.5 py-2 capitalize text-foreground/80"
                  >
                    Live {natural.kind}
                  </div>
                ))}
                {evidence.anchors.map((anchor) => (
                  <div
                    key={anchor.key}
                    className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.035] px-2.5 py-2 capitalize text-cyan-100/80"
                  >
                    Planned {anchor.kind.replace("-", " ")}
                  </div>
                ))}
                {evidence.structures.map((structure) => (
                  <div
                    key={structure.key}
                    className={`min-w-0 rounded-lg border px-2.5 py-2 ${
                      structure.blockerReasons.length > 0
                        ? "border-red-400/25 bg-red-400/[0.045]"
                        : structure.offPlan
                          ? "border-pink-400/20 bg-pink-400/[0.04]"
                          : "border-white/7 bg-white/[0.025]"
                    }`}
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
                      <span className="font-medium text-foreground/85">
                        {humanizeStructureType(structure.structureType)}
                      </span>
                      <span className="text-[0.62rem] text-muted-foreground">
                        {markerSummary(structure)}
                      </span>
                    </div>
                    {structure.hits !== null ? (
                      <p className="mt-1 text-[0.66rem] text-muted-foreground">
                        {formatCompact(structure.hits)} hits
                        {structure.hitsMax !== null
                          ? ` / ${formatCompact(structure.hitsMax)} maximum`
                          : ""}
                      </p>
                    ) : null}
                    {structure.rampartCondition?.targetHits ? (
                      <p className="mt-1 text-[0.66rem] text-muted-foreground">
                        {Math.round(
                          (structure.rampartCondition.ratio ?? 0) * 100,
                        )}
                        % of runtime target ·{" "}
                        {formatCompact(structure.rampartCondition.targetHits)}{" "}
                        hits
                      </p>
                    ) : null}
                    {structure.siteProgress !== null ? (
                      <p className="mt-1 text-[0.66rem] text-muted-foreground">
                        Site {formatCompact(structure.siteProgress)}
                        {structure.siteProgressTotal
                          ? ` / ${formatCompact(structure.siteProgressTotal)}`
                          : ""}
                      </p>
                    ) : null}
                    {structure.blockerReasons.map((reason) => (
                      <p
                        key={reason}
                        className="mt-1 break-words text-[0.66rem] leading-4 text-red-200/80"
                      >
                        {reason}
                      </p>
                    ))}
                  </div>
                ))}
                {diagnosticEvidence.map((structure) => (
                  <div
                    key={`diagnostic:${structure.key}`}
                    className="min-w-0 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] px-2.5 py-2"
                  >
                    <div className="font-medium text-amber-200/85">
                      Retained diagnostic{" "}
                      {humanizeStructureType(structure.structureType)}
                    </div>
                    <p className="mt-1 break-words text-[0.66rem] leading-4 text-amber-100/55">
                      UNUSABLE · DIAGNOSTIC ONLY · {model.blueprint.reason}
                    </p>
                  </div>
                ))}
                {evidence.structures.length === 0 &&
                evidence.naturals.length === 0 &&
                evidence.anchors.length === 0 &&
                diagnosticEvidence.length === 0 ? (
                  <p className="text-xs leading-5 text-muted-foreground">
                    No object evidence at this coordinate.
                  </p>
                ) : null}
              </div>
            )}
          </section>

          <section
            className="min-w-0 rounded-xl border border-white/8 bg-black/10 p-3"
            aria-label="Missing critical structure queue"
          >
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h3 className="text-[0.66rem] font-medium uppercase tracking-[0.15em] text-primary">
                  Critical build queue
                </h3>
                <p className="mt-1 text-[0.66rem] leading-4 text-muted-foreground">
                  {model.blueprint.active
                    ? `${model.missingQueue.length} shown of ${development.missingStructureCount} runtime-ranked gaps`
                    : "Withheld until runtime projection usability is current"}
                </p>
              </div>
              <Badge
                variant="outline"
                className="shrink-0 font-mono text-[0.62rem] text-muted-foreground"
              >
                {model.blueprint.active
                  ? development.missingStructureCount
                  : "—"}
              </Badge>
            </div>
            {!model.blueprint.active ? (
              <div className="mt-3 rounded-lg border border-dashed border-amber-400/20 bg-amber-400/[0.035] p-3 text-xs leading-5 text-amber-100/65">
                Stale or invalid retained coordinates are never presented as an
                actionable construction queue.
              </div>
            ) : model.missingQueue.length === 0 ? (
              <div className="mt-3 rounded-lg border border-dashed border-emerald-400/20 bg-emerald-400/[0.03] p-3 text-xs leading-5 text-emerald-100/65">
                No missing structure appears in the runtime critical queue.
              </div>
            ) : (
              <div className="mt-3 grid min-w-0 gap-2">
                {model.missingQueue.map((requirement, index) => {
                  const selected =
                    focusedPoint?.x === requirement.x &&
                    focusedPoint.y === requirement.y;
                  return (
                    <button
                      key={requirement.id}
                      type="button"
                      aria-pressed={selected}
                      data-map-focus={`${requirement.x}:${requirement.y}`}
                      onClick={() => {
                        setSelectedPoint({
                          x: requirement.x,
                          y: requirement.y,
                        });
                        setLayers((current) => ({
                          ...current,
                          blueprint: true,
                          defense:
                            current.defense ||
                            ["rampart", "constructedWall"].includes(
                              requirement.structureType,
                            ),
                        }));
                        mapInteractionRef.current?.scrollIntoView({
                          behavior: "auto",
                          block: "nearest",
                        });
                      }}
                      className={`grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 ${
                        selected
                          ? "border-cyan-300/35 bg-cyan-300/[0.075]"
                          : requirement.blockers.length > 0
                            ? "border-red-400/20 bg-red-400/[0.035] hover:bg-red-400/[0.06]"
                            : "border-white/7 bg-white/[0.025] hover:bg-white/[0.05]"
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-medium text-foreground/85">
                          {index + 1}.{" "}
                          {humanizeStructureType(requirement.structureType)}
                        </span>
                        <span className="mt-0.5 block truncate text-[0.63rem] text-muted-foreground">
                          {requirement.underConstruction
                            ? "Site active"
                            : requirement.blockers.length > 0
                              ? "Verified blocker"
                              : `RCL${requirement.minRcl} · ${requirement.stageId.replaceAll("-", " ")}`}
                        </span>
                      </span>
                      <span className="font-mono text-[0.66rem] text-cyan-100/75">
                        {requirement.x},{requirement.y}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>

      <div className="mt-4 flex min-w-0 flex-wrap gap-x-4 gap-y-2 text-[0.7rem] text-muted-foreground">
        <span className="sr-only">Map legend:</span>
        {[
          ["#55c9d4", "Planned glyph"],
          ["#f2f7fa", "Built outline"],
          ["#f2a365", "Dashed site"],
          ["#ff718d", "Off-plan ring"],
          ["#d59cff", "Foreign dotted frame"],
          ["#8aa6b5", "Neutral dotted frame"],
          ["#efbc5d", "Unusable diagnostic"],
          ["#ff5252", "Blocker cross"],
          ["#53d89e", "Rampart at target"],
        ].map(([color, label]) => (
          <span key={label} className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: color }}
            />
            {label}
          </span>
        ))}
      </div>
    </section>
  );
}

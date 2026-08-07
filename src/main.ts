import * as THREE from "three";
import "./style.css";
import { MAPS, mapById } from "./core/maps";
import { BUILD_ORDER, UNITS } from "./core/units";
import { buildBoard, worldX, worldZ } from "./render/board";
import { buildUnitModel } from "./render/unitModels";
import { createStage, frameBoard } from "./render/scene";
import { Controller } from "./ui/controller";
import type { PlayerId, UnitId } from "./core/types";

const app = document.getElementById("app")!;
const canvas = document.getElementById("screen") as HTMLCanvasElement;
const params = new URLSearchParams(location.search);

// Shadows are the single most expensive thing on screen; the URL exposes the
// dial so the quality/performance trade-off can be measured, not guessed.
const stage = createStage(canvas, {
  shadowMapSize: Number(params.get("shadow") ?? 1024),
  antialias: params.get("aa") !== "0",
});
const view = params.get("view") ?? "play";

function fitToWindow(): void {
  stage.resize(window.innerWidth, window.innerHeight);
}
fitToWindow();

let controller: Controller | null = null;

switch (view) {
  case "units":
    showUnitParade();
    break;
  case "board":
    showStaticBoard(params.get("map") ?? MAPS[0].id);
    break;
  default:
    controller = new Controller(
      stage,
      app,
      mapById(params.get("map") ?? MAPS[0].id),
      Number(params.get("speed") ?? 1),
    );
    break;
}

if (import.meta.env.DEV && controller !== null) {
  // Handle for tools/playtest.mjs; never present in a production build.
  (window as unknown as { __aw: unknown }).__aw = controller.debug();
}

window.addEventListener("resize", () => {
  fitToWindow();
  if (controller === null) stage.render();
});

// One clock for everything: animations, the cursor bob, and the AI's pacing
// all advance from this single delta.
let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  controller?.update(dt);
  stage.render();
  requestAnimationFrame(frame);
}

if (controller !== null) requestAnimationFrame(frame);
else stage.render();

/** Static board with a spread of units, for judging terrain and lighting. */
function showStaticBoard(mapId: string): void {
  const map = mapById(mapId).build();
  const board = buildBoard(map);
  stage.scene.add(board.group);

  const placements: Array<[UnitId, PlayerId, number, number]> = [
    ["infantry", 1, 9, 2],
    ["mech", 1, 12, 3],
    ["tank", 1, 8, 4],
    ["recon", 1, 14, 3],
    ["artillery", 1, 11, 2],
    ["apc", 1, 6, 2],
    ["mdtank", 1, 10, 5],
    ["rockets", 1, 13, 2],
    ["antiair", 1, 5, 3],

    ["infantry", 0, 10, 12],
    ["mech", 0, 7, 11],
    ["tank", 0, 11, 10],
    ["recon", 0, 5, 11],
    ["artillery", 0, 8, 12],
    ["apc", 0, 13, 12],
    ["mdtank", 0, 9, 9],
    ["rockets", 0, 6, 12],
    ["antiair", 0, 14, 11],
  ];

  for (const [type, owner, x, y] of placements) {
    const model = buildUnitModel(type, owner);
    model.position.set(worldX(map, x), 0, worldZ(map, y));
    model.rotation.y = owner === 0 ? Math.PI : 0;
    stage.scene.add(model);
  }

  frameBoard(stage, map.width, map.height, Number(params.get("zoom") ?? 1));
}

/**
 * Close-up 3x3 parade of every unit in both liveries. This is the view used to
 * judge the models themselves, away from terrain and lighting distractions.
 */
function showUnitParade(): void {
  const cols = 3;
  const cellX = 1.9;
  const cellZ = 1.7;
  const pairGap = 0.62;

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.MeshStandardMaterial({ color: 0x9fc47b, roughness: 0.9 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  stage.scene.add(ground);

  const rows = Math.ceil(BUILD_ORDER.length / cols);
  BUILD_ORDER.forEach((type, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const cx = (col - (cols - 1) / 2) * cellX;
    const cz = (row - (rows - 1) / 2) * cellZ;

    for (const owner of [0, 1] as PlayerId[]) {
      const model = buildUnitModel(type, owner);
      model.position.set(cx + (owner === 0 ? -pairGap / 2 : pairGap / 2), 0, cz);
      // Turned to face the camera at an angle, so the front and one flank
      // are both visible — the two faces that carry the silhouette.
      model.rotation.y = Math.PI - 0.55;
      stage.scene.add(model);
    }
  });

  const span = Math.max(cols * cellX, rows * cellZ) * 0.8 + 1.5;
  const shadow = stage.key.shadow.camera;
  shadow.left = -span;
  shadow.right = span;
  shadow.top = span;
  shadow.bottom = -span;
  shadow.updateProjectionMatrix();

  stage.scene.fog = null;
  frameBoard(stage, cols * cellX + 0.4, rows * cellZ + 0.4, 0.88);

  console.info(BUILD_ORDER.map((id) => `${UNITS[id].name}(${id})`).join(" · "));
}

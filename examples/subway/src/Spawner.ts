import { Behaviour, destroy, findObjectsOfType, instantiate } from '@scenoco-three/core';
import { Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { Game, getGame } from './Game';
import { Scroll } from './Scroll';
import { facadeTexture, glowTexture } from './textures';
import { Building, CoinPickup as CoinPrefab, HighBarrier, LowBarrier, Row, Segment, Train } from './scenes/prefabs';

const LANE = 2.4;
const SEGMENT = 20;
const TRAINS = ['#e4572e', '#2e86ab', '#f2b134', '#6a994e', '#8d5fd3'];
const FACADES = ['#c9a79a', '#9aa7c9', '#b9b0d6', '#d6a28f', '#8fb3b8', '#c7b08a'];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;

/** Lays track and scenery ahead of the runner, and rows of trains, barriers and coins once the run starts. */
export class Spawner extends Behaviour {
  spawnDistance = 95;
  private game: Game | null = null;
  private lastSegment: Object3D | null = null;
  private lastRow: Object3D | null = null;
  private nextGap = 0;
  private rowsMade = 0;

  start() {
    this.game = getGame();
    if (this.game) this.listen(this.game.onStart, () => this.clearRows());
  }

  update() {
    const g = this.game;
    if (!g) return;
    while (!this.lastSegment || this.lastSegment.position.z > -140 + SEGMENT) {
      const z = this.lastSegment ? this.lastSegment.position.z - SEGMENT : 30;
      this.lastSegment = this.makeSegment(z);
    }
    if (g.phase !== 'playing') return;
    if (!this.lastRow || this.lastRow.position.z - this.nextGap > -this.spawnDistance) {
      const z = this.lastRow ? this.lastRow.position.z - this.nextGap : -60;
      this.lastRow = this.makeRow(z);
      this.nextGap = 15 + g.speed * 0.75 + rand(0, 9);
    }
  }

  private clearRows() {
    for (const s of findObjectsOfType(Scroll)) if (s.node.name === 'row') destroy(s.node);
    this.lastRow = null;
    this.rowsMade = 0;
  }

  private makeSegment(z: number) {
    const seg = instantiate(Segment, { position: [0, 0, z] });
    for (const side of [-1, 1]) {
      for (const zl of [-5, 5]) {
        const w = rand(6, 10);
        const h = rand(14, 40);
        const d = rand(7, 9);
        const b = instantiate(Building, { parent: seg, position: [side * (15 + w / 2 + rand(0, 3)), h / 2, zl] }) as Mesh;
        b.scale.set(w, h, d);
        const mat = b.material as MeshStandardMaterial;
        mat.color.set(pick(FACADES));
        mat.map = facadeTexture.clone();
        mat.emissiveMap = glowTexture.clone();
        for (const t of [mat.map, mat.emissiveMap]) {
          t.repeat.set(Math.max(1, Math.round(((w + d) / 2) / 5)), Math.max(1, Math.round(h / 8)));
          t.offset.set(Math.random(), Math.random());
          t.needsUpdate = true;
        }
      }
    }
    return seg;
  }

  private makeRow(z: number) {
    const row = instantiate(Row, { position: [0, 0, z] });
    const free = Math.floor(Math.random() * 3) - 1;
    this.rowsMade++;
    for (const lane of [-1, 0, 1]) {
      const x = lane * LANE;
      if (lane === free) {
        const r = Math.random();
        if (r < 0.55) this.coinLine(row, x, -7.5, 6, 3, 0.9);
        else if (r < 0.8) {
          instantiate(LowBarrier, { parent: row, position: [x, 0, 0] });
          for (let i = 0; i < 5; i++) {
            const y = 1.0 + 1.3 * Math.sin(((i + 0.5) / 5) * Math.PI);
            instantiate(CoinPrefab, { parent: row, position: [x, y, -4.5 + i * 2.25] });
          }
        }
        continue;
      }
      if (Math.random() < 0.22) continue;
      const r = Math.random();
      if (r < 0.42) {
        const t = instantiate(Train, { parent: row, position: [x, 0, 0] });
        const body = t.getObjectByName('body') as Mesh;
        (body.material as MeshStandardMaterial).color.set(pick(TRAINS));
      } else if (r < 0.72) instantiate(LowBarrier, { parent: row, position: [x, 0, 0] });
      else instantiate(HighBarrier, { parent: row, position: [x, 0, 0] });
    }
    return row;
  }

  private coinLine(row: Object3D, x: number, z0: number, n: number, step: number, y: number) {
    for (let i = 0; i < n; i++) instantiate(CoinPrefab, { parent: row, position: [x, y, z0 + i * step] });
  }
}

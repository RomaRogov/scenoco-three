import { Behaviour, Input, KeyCode, SceneManager, WaitForSeconds, findObjectOfType, findObjectsOfType } from '@scenoco-three/core';
import { ArcadeCar } from './ArcadeCar.js';
import { CarDriver } from './CarDriver.js';
import { ChaseCamera } from './ChaseCamera.js';
import { TrackPosition } from './TrackPosition.js';

/**
 * The race: a countdown, then `laps` laps; the standings by how far round each car is; the HUD —
 * the page's own HTML — and a banner at the finish whose button (`data-button="Again"`, R, or a pad's
 * Start or A) loads the next track. It shows the touch controls only while no gamepad is there. It also points the chase camera at the player's car.
 */
export class RaceControl extends Behaviour {
  laps = 3;
  /** The tracks, in order, as `SceneManager.load` takes them — this race's own among them. */
  tracks: (() => unknown)[] = [];
  /** Which of `tracks` this is. */
  track = 0;

  /** Cars may drive: after the countdown, until the player finishes. */
  racing = false;
  private finished = false;
  private player: CarDriver | null = null;
  private readonly hud = {
    count: element('count'),
    lap: element('lap'),
    place: element('place'),
    speed: element('speed'),
    assist: element('assist'),
    banner: element('banner'),
    result: element('result'),
  };

  override start(): void {
    // The page outlives the scene: a race loaded again starts with the last one's banner up.
    this.hud.banner.hidden = true;
    this.startCoroutine(this.countdown());
  }

  /**
   * The player's car, found again whenever the one held is gone — a race loaded again starts while
   * the last one's cars are still being taken down — and the chase camera pointed at it.
   */
  private findPlayer(): CarDriver | null {
    if (this.player && !this.player.isDestroyed) return this.player;
    this.player = findObjectsOfType(CarDriver).find((d) => d.human) ?? null;
    const camera = findObjectOfType(ChaseCamera);
    if (camera && this.player) camera.target = this.player.node;
    return this.player;
  }

  private *countdown() {
    for (const word of ['3', '2', '1']) {
      this.show(word);
      yield new WaitForSeconds(0.8);
    }
    this.show('GO');
    this.racing = true;
    console.info('phase: racing');
    yield new WaitForSeconds(0.8);
    this.show('');
  }

  override update(): void {
    // With a gamepad there, the touch controls go, even on a touch screen, and the hint shows the pad's.
    document.body.classList.toggle('gamepad', Input.getJoystickNames().length > 0);
    const next = this.tracks[(this.track + 1) % Math.max(1, this.tracks.length)];
    const again = Input.getButtonDown('Again') || Input.getKeyDown(KeyCode.R) || Input.getKeyDown(KeyCode.JoystickButton9) || Input.getKeyDown(KeyCode.JoystickButton0);
    if (this.finished && again && next) SceneManager.load(next);
    const player = this.findPlayer();
    if (!player) return;
    const mine = player.node.getComponent(TrackPosition);
    const car = player.node.getComponent(ArcadeCar);
    // In the frame a race is loaded again, the last one's cars are taken down around it.
    if (!mine || !car) return;
    const order = findObjectsOfType(TrackPosition).sort((a, b) => b.progress - a.progress);
    const place = order.indexOf(mine) + 1;

    this.hud.lap.textContent = `${Math.min(mine.laps + 1, this.laps)}/${this.laps}`;
    this.hud.place.textContent = `${place}/${order.length}`;
    this.hud.speed.textContent = String(Math.round(Math.abs(car.speed) * 3.6));
    this.hud.assist.classList.toggle('off', !player.assisting);

    if (!this.finished && mine.laps >= this.laps) {
      this.finished = true;
      this.racing = false;
      this.hud.result.textContent = place === 1 ? 'YOU WIN' : `${ordinal(place)} PLACE`;
      this.hud.banner.hidden = false;
      console.info(`phase: finished ${place}/${order.length}`);
    }
  }

  private show(word: string): void {
    this.hud.count.textContent = word;
    this.hud.count.classList.remove('pop');
    void this.hud.count.offsetWidth; // a reflow, so the animation plays again
    if (word) this.hud.count.classList.add('pop');
  }
}

function ordinal(n: number): string {
  return `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html has no #${id} — the HUD is the page's own HTML.`);
  return found;
}

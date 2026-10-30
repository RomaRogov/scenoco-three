import { Behaviour, Input, KeyCode, SceneManager, WaitForSeconds, findObjectOfType, findObjectsOfType, type Yieldable } from '@scenoco-three/core';
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
  private hud!: Record<'ui' | 'count' | 'lap' | 'place' | 'speed' | 'assist' | 'assistState' | 'banner' | 'result', HTMLElement>;

  override awake(): void {
    this.hud = {
      ui: element('ui'),
      count: element('count'),
      lap: element('lap'),
      place: element('place'),
      speed: element('speed'),
      assist: element('assist'),
      assistState: element('assist-state'),
      banner: element('banner'),
      result: element('result'),
    };
    // Touch controls for a touch screen: decided here, as UI Toolkit has no media queries.
    this.hud.ui.classList.toggle('touch', matchMedia('(pointer: coarse)').matches);
  }

  override start(): void {
    // The page outlives the scene: a race loaded again starts with the last one's banner up.
    this.hud.banner.classList.remove('shown');
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

  private *countdown(): Generator<Yieldable> {
    for (const word of ['3', '2', '1']) {
      yield* this.show(word);
      yield new WaitForSeconds(0.6);
    }
    this.racing = true;
    console.info('phase: racing');
    yield* this.show('GO');
  }

  override update(): void {
    // With a gamepad there, the touch controls go, even on a touch screen, and the hint shows the pad's.
    this.hud.ui.classList.toggle('gamepad', Input.getJoystickNames().length > 0);
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

    write(this.hud.lap, `${Math.min(mine.laps + 1, this.laps)}/${this.laps}`);
    write(this.hud.place, `${place}/${order.length}`);
    write(this.hud.speed, String(Math.round(Math.abs(car.speed) * 3.6)));
    this.hud.assist.classList.toggle('off', !player.assisting);
    write(this.hud.assistState, player.assisting ? 'ON' : 'OFF');

    if (!this.finished && mine.laps >= this.laps) {
      this.finished = true;
      this.racing = false;
      this.hud.result.textContent = place === 1 ? 'YOU WIN' : `${ordinal(place)} PLACE`;
      this.hud.banner.classList.add('shown');
      console.info(`phase: finished ${place}/${order.length}`);
    }
  }

  /** One word of the countdown: in at once, large; settling in a fifth of a second; then fading away. */
  private *show(word: string): Generator<Yieldable> {
    const count = this.hud.count;
    count.textContent = word;
    count.classList.remove('shown');
    count.classList.add('enter');
    yield null; // a frame, so the page has drawn it large before it settles
    count.classList.remove('enter');
    count.classList.add('shown');
    yield new WaitForSeconds(0.2);
    count.classList.remove('shown');
  }
}

/**
 * Text into the HUD only when it changed: every write has the browser lay the page out again before
 * the next size anything reads — on a tablet, a write a frame was the largest piece of script.
 */
function write(element: HTMLElement, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

function ordinal(n: number): string {
  return `${n}${n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH'}`;
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (!found) throw new Error(`index.html has no #${id} — the HUD is the page's own HTML.`);
  return found;
}

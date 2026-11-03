import { Tween } from '@scenoco-three/core';

/**
 * The page's motion: the CSS moves an element between its classes (transitions), and these say which
 * class when — what a UI Toolkit port does with the same USS. Real time throughout: the game's own
 * clock runs at 2× and 3×, and stops when paused.
 */

export const $ = (id: string) => document.getElementById(id)!;

/** A copy of a `<template>`'s element — UI Toolkit's `VisualTreeAsset.Instantiate`. */
export function clone(id: string): HTMLElement {
  return ($(id) as HTMLTemplateElement).content.firstElementChild!.cloneNode(true) as HTMLElement;
}

const after = (seconds: number, fn: () => void) => Tween.delayedCall(seconds, fn).setUpdate(true);

/** Into place from where `from` holds it: placed there at once, then — a frame later — moved in. */
export function arrive(elements: HTMLElement | HTMLElement[], from = 'enter'): void {
  const all = Array.isArray(elements) ? elements : [elements];
  for (const el of all) el.classList.add(from);
  after(0, () => all.forEach((el) => el.classList.remove(from)));
}

/** On for `seconds`, then off: the CSS moves it there and back. */
export function flick(el: HTMLElement, name: string, seconds: number): void {
  el.classList.add(name);
  after(seconds, () => el.classList.remove(name));
}

/** On and off every `seconds`, until the tween is killed. */
export function loop(el: HTMLElement, name: string, seconds: number): Tween {
  return Tween.sequence().appendCallback(() => el.classList.toggle(name)).appendInterval(seconds).setLoops(-1).setUpdate(true);
}

/** Left, right, left, right, still: a refusal. */
export function shake(el: HTMLElement): void {
  const moves = Tween.sequence().setUpdate(true);
  for (const side of ['shake-l', 'shake-r', 'shake-l', 'shake-r']) {
    moves.appendCallback(() => el.classList.add(side)).appendInterval(0.1).appendCallback(() => el.classList.remove(side));
  }
}

/** A light swept across a button every 2.6 seconds. */
export function sweep(shine: HTMLElement): Tween {
  return Tween.sequence().appendCallback(() => arrive(shine, 'start')).appendInterval(2.6).setLoops(-1).setUpdate(true);
}

/** A full-screen panel shown: the wash fades in, the panel rises into it. */
export function appear(id: string): void {
  const overlay = $(id);
  overlay.classList.remove('hidden');
  arrive([overlay, ...overlay.querySelectorAll<HTMLElement>(':scope > .panel')]);
}

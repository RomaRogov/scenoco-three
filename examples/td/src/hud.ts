import { WaitForSecondsRealtime, type Yieldable } from '@scenoco-three/core';

/**
 * The page's motion, as coroutines a behaviour starts: the CSS moves an element between its classes
 * (transitions), and these say which class when — what a UI Toolkit port does with the same USS. Real
 * time throughout: the game's own clock runs at 2× and 3×, and stops when paused.
 */

export const $ = (id: string) => document.getElementById(id)!;

/** A copy of a `<template>`'s element — UI Toolkit's `VisualTreeAsset.Instantiate`. */
export function clone(id: string): HTMLElement {
  return ($(id) as HTMLTemplateElement).content.firstElementChild!.cloneNode(true) as HTMLElement;
}

/** Into place from where `from` holds it: placed there at once, then — a frame later — moved in. */
export function* arrive(elements: HTMLElement | HTMLElement[], from = 'enter'): Generator<Yieldable> {
  const all = Array.isArray(elements) ? elements : [elements];
  for (const el of all) el.classList.add(from);
  yield null;
  for (const el of all) el.classList.remove(from);
}

/** On for `seconds`, then off: the CSS moves it there and back. */
export function* flick(el: HTMLElement, name: string, seconds: number): Generator<Yieldable> {
  el.classList.add(name);
  yield new WaitForSecondsRealtime(seconds);
  el.classList.remove(name);
}

/** On and off every `seconds`, until the coroutine is stopped. */
export function* loop(el: HTMLElement, name: string, seconds: number): Generator<Yieldable> {
  for (;;) {
    el.classList.toggle(name);
    yield new WaitForSecondsRealtime(seconds);
  }
}

/** Left, right, left, right, still: a refusal. */
export function* shake(el: HTMLElement): Generator<Yieldable> {
  for (const side of ['shake-l', 'shake-r', 'shake-l', 'shake-r']) {
    el.classList.add(side);
    yield new WaitForSecondsRealtime(0.1);
    el.classList.remove(side);
  }
}

/** A light swept across a button every 2.6 seconds. */
export function* sweep(shine: HTMLElement): Generator<Yieldable> {
  for (;;) {
    shine.classList.add('start');
    yield null;
    shine.classList.remove('start');
    yield new WaitForSecondsRealtime(2.6);
  }
}

/** A full-screen panel shown: the wash fades in, the panel rises into it. */
export function* appear(id: string): Generator<Yieldable> {
  const overlay = $(id);
  overlay.classList.remove('hidden');
  const panels = [...overlay.querySelectorAll<HTMLElement>(':scope > .panel')];
  yield* arrive([overlay, ...panels]);
}

import { ColorManagement } from 'three';

/*
 * The Unity project lit in gamma space (Player Settings, Color Space: Gamma): colours and textures
 * are summed as stored, which is what made the egg glow nearly white. three.js lights in linear
 * space; with its colour management off, and nothing encoded on the way out, it sums them as Unity
 * did. Imported first, before any material reads a colour.
 */
ColorManagement.enabled = false;

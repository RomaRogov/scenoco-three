import { Behaviour, Input, KeyCode, PlayerPrefs, QualitySettings } from '@scenoco-three/core';

/**
 * The quality button, as a Unity settings screen sets `QualitySettings.SetQualityLevel`: Q or a tap
 * steps through Low, Medium and High — the resolution drawn, the shadows and the post-processing —
 * and the choice is kept in PlayerPrefs for the next visit.
 */
export class QualityMenu extends Behaviour {
  /** The page element showing the level's name. */
  label = 'quality-state';

  override start() {
    this.apply(PlayerPrefs.getInt('quality', QualitySettings.getQualityLevel()));
  }

  override update() {
    if (Input.getKeyDown(KeyCode.Q) || Input.getButtonDown('Quality')) {
      this.apply((QualitySettings.getQualityLevel() + 1) % QualitySettings.names.length);
    }
  }

  private apply(level: number) {
    QualitySettings.setQualityLevel(level);
    PlayerPrefs.setInt('quality', level);
    const shown = document.getElementById(this.label);
    if (shown) shown.textContent = QualitySettings.names[level]!.toUpperCase();
  }
}

/** @jsxImportSource react */
/** The editor's panel: its parts, drawn again as the game moves. */
import { useEffect, useState } from 'react';
import type { Object3D } from 'three';
import type { Model } from '../model/Model.js';
import { Code, Failed } from './Inspector.js';
import { SettingsPopup } from './Settings.js';
import { ScenePicker, StageBar, Toolbar } from './Toolbar.js';
import { Tree } from './Tree.js';

/** Live values move while the game runs: the interface reads them again this often. */
const TICK_MS = 120;

export function App({ model }: { model: Model }): React.JSX.Element {
  const { host } = model;
  const [tick, setTick] = useState(0);
  const [settings, setSettings] = useState(false);
  const [selected, setSelected] = useState<Object3D | null>(host.selected);
  useEffect(() => {
    const bump = () => setTick((t) => t + 1);
    model.changed = bump;
    host.on('select', (node) => {
      setSelected(node);
      bump();
    });
    host.on('moved', (node, before) => void model.moved(node, before));
    const timer = setInterval(bump, TICK_MS);
    return () => clearInterval(timer);
  }, [model, host]);

  return (
    <div className="se-panel">
      <Toolbar model={model} settings={settings} toggleSettings={() => setSettings(!settings)} />
      <ScenePicker model={model} />
      {settings && <SettingsPopup model={model} close={() => setSettings(false)} />}
      {model.stage && <StageBar model={model} />}
      {model.status.text && <div className={model.status.error ? 'se-status se-error' : 'se-status'}>{model.status.text}</div>}
      <Failed again={selected} where="the list">
        <Tree model={model} selected={selected} />
      </Failed>
      <Failed again={selected} where="this node's code">
        <Code model={model} selected={selected} tick={tick} />
      </Failed>
    </div>
  );
}

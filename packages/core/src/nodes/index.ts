// Built-in node tags. Importing this module registers every built-in into the
// NodeRegistry (each file self-registers via a define* call). Add a new built-in
// by dropping a file in the right folder and importing it here.

// ---- Object3D family: structural --------------------------------------------
import './object3d/Scene.js';
import './object3d/Object3D.js';
import './object3d/Group.js';
import './object3d/Bone.js';
import './object3d/LOD.js';

// ---- Object3D family: renderables -------------------------------------------
import './object3d/Mesh.js';
import './object3d/InstancedMesh.js';
import './object3d/SkinnedMesh.js';
import './object3d/BatchedMesh.js';
import './object3d/Line.js';
import './object3d/LineLoop.js';
import './object3d/LineSegments.js';
import './object3d/Points.js';
import './object3d/Sprite.js';

// ---- Object3D family: lights ------------------------------------------------
import './object3d/AmbientLight.js';
import './object3d/DirectionalLight.js';
import './object3d/HemisphereLight.js';
import './object3d/PointLight.js';
import './object3d/RectAreaLight.js';
import './object3d/SpotLight.js';

// ---- Object3D family: cameras -----------------------------------------------
import './object3d/PerspectiveCamera.js';
import './object3d/OrthographicCamera.js';
import './object3d/ArrayCamera.js';

// ---- Geometries -------------------------------------------------------------
import './geometry/BoxGeometry.js';
import './geometry/SphereGeometry.js';
import './geometry/CylinderGeometry.js';
import './geometry/PlaneGeometry.js';
import './geometry/TorusGeometry.js';

// ---- Materials --------------------------------------------------------------
import './material/MeshStandardMaterial.js';
import './material/MeshBasicMaterial.js';
import './material/LineBasicMaterial.js';
import './material/PointsMaterial.js';
import './material/SpriteMaterial.js';

// ---- Scene settings (config children of <Scene>) ----------------------------
import './setting/Fog.js';
import './setting/FogExp2.js';
import './setting/Background.js';

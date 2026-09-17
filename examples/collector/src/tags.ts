// The packages this project's *documents* name, which its TypeScript does not.
//
// A package is read through a real import — depending on one in package.json is not enough on its
// own. `collision` and `ui` are already imported by the components that use them; particles is
// only ever written in XML, so this is where it is said.
import '@scenoco-three/particles';

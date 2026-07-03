// Lets `tsc` accept a component importing a binary asset (the bundler/esbuild
// supply the real URL string at build time). See CORE-IMPROVEMENTS #5.
declare module '*.png' {
  const url: string;
  export default url;
}

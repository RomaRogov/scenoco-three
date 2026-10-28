/** `launch-editor` ships no types: its one function, as `open.ts` calls it. */
declare module 'launch-editor' {
  export default function launchEditor(file: string, onError?: (fileName: string, message: string | null) => void): void;
}

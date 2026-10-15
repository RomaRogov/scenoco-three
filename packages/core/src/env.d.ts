// What a bundler tells the page: Vite sets `import.meta.env.DEV` while serving in development.
interface ImportMeta {
  readonly env?: { readonly DEV?: boolean };
}

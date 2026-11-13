/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/react" />

/** Injected at build time by vite.config.ts. */
declare const __BUILD_TIME__: string;
declare const __COMMIT_SHA__: string;
/** ISO time of the last commit, or '' when git was not available. */
declare const __COMMIT_TIME__: string;

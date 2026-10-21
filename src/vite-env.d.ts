/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Release Pulse service, e.g. http://localhost:8787. Unset
   *  means Pulse is not deployed here and the page says so. */
  readonly VITE_PULSE_URL?: string;
}

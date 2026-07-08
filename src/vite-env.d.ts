/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOCKET_URL: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_LOCAL_SERVER: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOCKET_URL: string;
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_LOCAL_SERVER: string;
  readonly VITE_R2_PUBLIC_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

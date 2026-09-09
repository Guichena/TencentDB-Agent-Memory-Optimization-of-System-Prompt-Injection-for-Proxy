process.env.TDAI_LLM_BASE_URL ||= process.env.TDAI_CODEX_UPSTREAM_URL;
process.env.TDAI_LLM_API_KEY ||= process.env.TDAI_CODEX_PROVIDER_API_KEY;
process.env.TDAI_LLM_MODEL ||= process.env.TDAI_CODEX_MODEL;
process.env.TDAI_GATEWAY_CONFIG ||= new URL(
  "../implementations/final/MemoryCore/tdai-gateway.standalone.yaml",
  import.meta.url,
).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");
process.env.TDAI_GATEWAY_HOST ||= "127.0.0.1";
process.env.TDAI_GATEWAY_PORT ||= "8420";
process.env.TDAI_DATA_DIR ||= new URL("../.runtime/core", import.meta.url).pathname.replace(/^\/(?:([A-Za-z]:))/, "$1");

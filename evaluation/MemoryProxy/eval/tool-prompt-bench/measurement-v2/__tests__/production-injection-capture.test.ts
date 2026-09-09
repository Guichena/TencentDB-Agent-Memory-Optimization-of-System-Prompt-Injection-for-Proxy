import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { buildCodexInjectionBlock } from "../../../../../../implementations/final/MemoryProxy/src/common/codex-injection.js";
import {
  renderAvailableSkillsPromptArtifact,
} from "../../../../../../implementations/final/MemoryProxy/src/injection/injectors/skill-injector.js";
import {
  renderSkillToolsPromptArtifact,
} from "../../../../../../implementations/final/MemoryProxy/src/injection/injectors/skill-tools-injector.js";
import {
  renderTdaiProfileMemoryBlock,
} from "../../../../../../implementations/final/MemoryProxy/src/injection/injectors/tdai-profile-memory-injector.js";
import {
  freezeProviderPromptSourceEvidence,
  sealProductionPromptSourceManifest,
  type ProductionPromptSourceInput,
  validateProductionPromptSourceManifest,
  wrapProductionPromptSourceManifestForCodex,
} from "../../../../../../implementations/final/MemoryProxy/src/injection/production-source.js";
import { buildCapabilitySignature } from "../../../../../../implementations/final/MemoryProxy/src/injection/tool-prompt/runtime-contract.js";
import { OpenAIAdapter } from "../../../../../../implementations/final/MemoryProxy/src/injection/adapters/openai.js";
import { InjectionPipeline } from "../../../../../../implementations/final/MemoryProxy/src/injection/pipeline.js";
import { HookRegistryImpl } from "../../../../../../implementations/final/MemoryProxy/src/injection/registry.js";
import {
  captureProductionInjectionV2,
  finalizeProductionInjectionCaptureV2,
} from "../production-injection-capture.js";

const INJECTION = [
  "<tdai_injections>",
  "<session_context>session-a</session_context>",
  "<skill_tools>search and view</skill_tools>",
  "<available_skills>- typescript-tests</available_skills>",
  "<knowledge_tools>list then call</knowledge_tools>",
  "<tdai_memory_tools>search memory</tdai_memory_tools>",
  "<tdai_profile_memory>profile facts</tdai_profile_memory>",
  "<memory-tools-guide>when to search</memory-tools-guide>",
  "</tdai_injections>",
].join("\n");

const tokenizer = {
  id: "o200k_base",
  version: "test-character-v1",
  count: (text: string) => [...text].length,
};

const capabilitySignature = buildCapabilitySignature({
  memory: true,
  skill: true,
  knowledge: true,
  wiki: true,
  codeGraph: true,
  skillWrite: false,
  skillExtract: false,
});

function audit(text = INJECTION) {
  const toolFamilies: Array<"memory" | "skill" | "knowledge"> = [];
  if (/<tdai_memory_tools>|<memory-tools-guide>|<tdai_profile_memory>/u.test(text)) toolFamilies.push("memory");
  if (/<skill_tools>|<available_skills>/u.test(text)) toolFamilies.push("skill");
  if (/<knowledge_tools>/u.test(text)) toolFamilies.push("knowledge");
  return {
    wrapperCount: 1 as const,
    injectionSha256: createHash("sha256").update(text).digest("hex"),
    injectionTokenEncoding: "o200k_base" as const,
    injectionTokenCount: tokenizer.count(text),
    injectionCharacterCount: text.length,
    injectionUtf8ByteCount: Buffer.byteLength(text, "utf8"),
    hasSessionContext: text.includes("<session_context>"),
    toolFamilies,
    userPromptCount: 1 as const,
    userPromptSha256: "f".repeat(64),
  };
}

function simpleManifest(text = INJECTION) {
  return sealProductionPromptSourceManifest(text, [{
    sourceId: "fixture:provider-wrapper",
    sourceKind: "static-tool",
    injectionBlockId: "fixture",
    text,
  }]);
}

describe("captureProductionInjectionV2", () => {
  it("classifies the fixed profile-to-guide separator as static serialization glue", () => {
    const block = renderTdaiProfileMemoryBlock([{
      agentName: "通用 Agent",
      agentId: "agent-profile-01",
      isSelf: true,
      l3Content: "稳定偏好",
      l2Entries: [],
    }]);
    const sources = block.metadata?.productionPromptSources as
      | readonly ProductionPromptSourceInput[]
      | undefined;

    expect(sources?.map((source) => source.text).join("")).toBe(block.content);
    expect(sources?.find((source) => (
      source.sourceId === "memory-profile:guide-separator"
    ))).toMatchObject({
      sourceKind: "static-tool",
      text: "\n\n",
    });
  });

  it("captures executed ContextBlock sources without changing serialized provider bytes", async () => {
    const listing = renderAvailableSkillsPromptArtifact(
      "<available_skills>\n- name: vitest\n</available_skills>",
      "protocol-compact",
      capabilitySignature,
    );
    const tools = renderSkillToolsPromptArtifact({
      proxyBaseUrl: "https://pipeline.example.test",
      sessionId: "session-pipeline",
      spaceId: "space-pipeline",
      profile: "protocol-compact",
      capabilitySignature,
    });
    const registry = new HookRegistryImpl();
    registry.register({
      id: "production-source-fixture",
      point: "system.suffix",
      priority: 0,
      description: "production source fixture",
      execute: () => [
        {
          type: "text",
          content: listing.content,
          metadata: { productionPromptSources: listing.productionSources },
        },
        {
          type: "text",
          content: tools.content,
          metadata: { productionPromptSources: tools.productionSources },
        },
      ],
    });
    const pipeline = new InjectionPipeline(
      registry,
      new Map([["openai", new OpenAIAdapter()]]),
    );
    const body = {
      messages: [
        { role: "system", content: "<session_context>pipeline</session_context>" },
        { role: "user", content: "." },
      ],
      model: "gpt-test",
    };
    const metadata = {
      protocol: "openai" as const,
      traceId: "trace-production-source",
      keyId: "key-production-source",
      modelId: "gpt-test",
      stream: false,
      agentSource: "codex",
    };

    const ordinary = await pipeline.process(body, metadata);
    const captured = await pipeline.processWithProductionSources(body, metadata, {
      initialSystemSources: [{
        sourceId: "codex-session-context",
        sourceKind: "dynamic-asset",
        injectionBlockId: "session-context",
        text: "<session_context>pipeline</session_context>",
      }],
    });
    expect(captured.body).toEqual(ordinary);
    expect(captured.productionSourceManifest).not.toBeNull();
    const productionSourceManifest = captured.productionSourceManifest!;
    const system = (captured.body.messages as Array<Record<string, unknown>>)[0].content;
    expect(productionSourceManifest.sources.map((source) => source.text).join(""))
      .toBe(system);
    expect(productionSourceManifest.sources.some((source) => (
      source.sourceKind === "static-tool"
      && source.text.includes("Before replying, scan the skills below")
    ))).toBe(true);
    expect(productionSourceManifest.sources.some((source) => (
      source.sourceKind === "runtime-binding"
      && source.text === "https://pipeline.example.test/skill-bridge/v3/skill"
    ))).toBe(true);
    expect(productionSourceManifest.sources.some((source) => (
      source.sourceKind === "dynamic-asset"
      && source.text === "<session_context>pipeline</session_context>"
    ))).toBe(true);
  });

  it("uses renderer-bounded runtime slots when short and Unicode values overlap static prose", () => {
    const artifact = renderSkillToolsPromptArtifact({
      proxyBaseUrl: "https://proxy.example.test",
      sessionId: "skill",
      spaceId: "空间✨",
      profile: "protocol-compact",
      capabilitySignature,
    });
    const runtime = artifact.productionSources
      .filter((source) => source.sourceKind === "runtime-binding")
      .map((source) => source.text);
    const staticText = artifact.productionSources
      .filter((source) => source.sourceKind !== "runtime-binding")
      .map((source) => source.text)
      .join("");

    expect(runtime.filter((text) => text === "skill")).toHaveLength(1);
    expect(runtime).toContain("空间✨");
    expect(staticText).toContain("云端 skill 操作工具");
    expect(artifact.productionSources.map((source) => source.text).join(""))
      .toBe(artifact.content);
  });

  it("rebuilds and checks every UTF-8 segment instead of trusting caller offsets", () => {
    const sealed = sealProductionPromptSourceManifest("前✨skill后", [
      {
        sourceId: "unicode-prefix",
        sourceKind: "static-tool",
        injectionBlockId: "unicode-test",
        text: "前✨",
      },
      {
        sourceId: "unicode-slot",
        sourceKind: "runtime-binding",
        injectionBlockId: "unicode-test",
        text: "skill",
      },
      {
        sourceId: "unicode-suffix",
        sourceKind: "static-tool",
        injectionBlockId: "unicode-test",
        text: "后",
      },
    ]);
    const callerOwned = structuredClone(sealed);
    const validated = validateProductionPromptSourceManifest(callerOwned);

    expect(validated).not.toBe(callerOwned);
    expect(validated.sources.map((source) => [
      source.startUtf8Byte,
      source.endUtf8ByteExclusive,
      source.sourceSha256,
    ])).toEqual(sealed.sources.map((source) => [
      source.startUtf8Byte,
      source.endUtf8ByteExclusive,
      source.sourceSha256,
    ]));
    expect(validated.sources[1]?.startUtf8Byte).toBe(Buffer.byteLength("前✨", "utf8"));
    expect(Object.isFrozen(validated.sources[1])).toBe(true);
  });

  it("uses real PromptUnit provenance when blocks are reordered and runtime endpoints are embedded", () => {
    const listing = [
      "<available_skills>",
      "- name: typescript-tests",
      "  description: Run focused TypeScript tests",
      "</available_skills>",
    ].join("\n");
    const listingArtifact = renderAvailableSkillsPromptArtifact(
      listing,
      "protocol-compact",
      capabilitySignature,
    );
    const toolsArtifact = renderSkillToolsPromptArtifact({
      proxyBaseUrl: "https://proxy.example.test",
      allowLlmWrite: false,
      sessionId: "session-source-01",
      spaceId: "space-source-01",
      profile: "protocol-compact",
      capabilitySignature,
    });

    // Deliberately put the listing before the tool block. Production provenance,
    // not a hard-coded XML order, is authoritative for the candidate bytes.
    const inner = `${listingArtifact.content}\n${toolsArtifact.content}`;
    const innerManifest = sealProductionPromptSourceManifest(inner, [
      ...listingArtifact.productionSources,
      {
        sourceId: "pipeline:separator:listing-to-tools",
        sourceKind: "static-tool",
        injectionBlockId: "pipeline-separator",
        text: "\n",
      },
      ...toolsArtifact.productionSources,
    ]);
    const providerVisibleInjection = buildCodexInjectionBlock({ raw: inner }).text;
    const providerManifest = wrapProductionPromptSourceManifestForCodex(
      providerVisibleInjection,
      innerManifest,
    );
    const providerSourceEvidence = freezeProviderPromptSourceEvidence({
      correlationId: "provider-source-01",
      rawBodySha256: "a".repeat(64),
      sourceManifest: providerManifest,
    });

    const observed = captureProductionInjectionV2({
      runId: "run-production-source-01",
      variantId: "V2",
      providerVisibleInjection,
      providerAudit: audit(providerVisibleInjection),
      productionSourceManifest: providerManifest,
      tokenizer,
    });

    expect(observed.segments.map((segment) => segment.text).join(""))
      .toBe(providerVisibleInjection);
    expect(observed.tokenLedger.classification.formalCompilerClosure.status).toBe("blocked");
    expect(observed.segments.some((segment) => (
      segment.kind === "static-tool"
      && segment.text.includes("Before replying, scan the skills below")
    ))).toBe(true);
    expect(observed.segments.some((segment) => (
      segment.kind === "dynamic-asset" && segment.text === listing
    ))).toBe(true);
    expect(observed.segments.some((segment) => (
      segment.kind === "runtime-binding"
      && segment.text === "https://proxy.example.test/skill-bridge/v3/skill"
    ))).toBe(true);
    expect(providerManifest.sources.filter((source) => (
      source.injectionBlockId === "tdai-injections-wrapper"
    )).every((source) => source.sourceKind === "static-tool")).toBe(true);
    expect(innerManifest.sources.find((source) => (
      source.injectionBlockId === "pipeline-separator"
    ))?.sourceKind).toBe("static-tool");

    const finalized = finalizeProductionInjectionCaptureV2({
      capture: observed,
      providerSourceEvidence,
      tokenizer,
    });
    expect(finalized.tokenLedger.classification.formalCompilerClosure).toEqual({
      status: "ready",
      blocker: null,
      owner: "Integration",
    });
  });

  it("keeps a byte-complete capture blocked until independent provider evidence finalizes it", () => {
    const productionSourceManifest = simpleManifest();
    const result = captureProductionInjectionV2({
      runId: "run-observed-01",
      variantId: "V0-C",
      providerVisibleInjection: INJECTION,
      providerAudit: audit(),
      productionSourceManifest,
      tokenizer,
    });

    expect(result.manifest).toMatchObject({
      schemaVersion: "task1.production-injection-capture.v2",
      productionSourceManifestSha256: productionSourceManifest.canonicalSha256,
      providerInjectionSha256: audit().injectionSha256,
    });
    expect(result.tokenLedger.classification.formalCompilerClosure).toEqual({
      status: "blocked",
      blocker: "SELF_BUILT_SOURCE_ATTESTATION_NOT_FORMAL",
      owner: "Integration",
    });
  });

  it.each([
    ["provider SHA", { injectionSha256: "0".repeat(64) }],
    ["provider token count", { injectionTokenCount: audit().injectionTokenCount + 1 }],
  ])("rejects a reconstructed ledger that disagrees with the %s", (_label, override) => {
    expect(() => captureProductionInjectionV2({
      runId: "run-tampered-audit",
      variantId: "V1",
      providerVisibleInjection: INJECTION,
      providerAudit: { ...audit(), ...override },
      productionSourceManifest: simpleManifest(),
      tokenizer,
    })).toThrowError(expect.objectContaining({ code: "PROVIDER_AUDIT_MISMATCH" }));
  });

  it("rejects a source manifest whose text/hash was changed after the pipeline sealed it", () => {
    const manifest = simpleManifest();
    const tampered = {
      ...manifest,
      sources: manifest.sources.map((source, index) => (
        index === 0 ? { ...source, text: source.text.replace("session-a", "session-b") } : source
      )),
    };
    expect(() => captureProductionInjectionV2({
      runId: "run-tampered-source",
      variantId: "V2",
      providerVisibleInjection: INJECTION,
      providerAudit: audit(),
      productionSourceManifest: tampered,
      tokenizer,
    })).toThrowError(expect.objectContaining({ code: "PRODUCTION_SOURCE_MISMATCH" }));
  });

  it("rejects a provider-source evidence object bound to a different request", () => {
    const manifest = simpleManifest();
    const observed = captureProductionInjectionV2({
      runId: "run-provider-binding",
      variantId: "V3",
      providerVisibleInjection: INJECTION,
      providerAudit: audit(),
      productionSourceManifest: manifest,
      tokenizer,
    });
    const evidence = freezeProviderPromptSourceEvidence({
      correlationId: "request-one",
      rawBodySha256: "b".repeat(64),
      sourceManifest: manifest,
    });
    expect(() => finalizeProductionInjectionCaptureV2({
      capture: observed,
      providerSourceEvidence: { ...evidence, bindingSha256: "0".repeat(64) },
      tokenizer,
    })).toThrowError(expect.objectContaining({ code: "PRODUCTION_SOURCE_MISMATCH" }));
  });

  it("rejects malformed outer wrappers without guessing their internal XML layout", () => {
    const malformed = INJECTION.replace("<tdai_injections>\n", "");
    expect(() => captureProductionInjectionV2({
      runId: "run-invalid-wrapper",
      variantId: "V2",
      providerVisibleInjection: malformed,
      providerAudit: audit(malformed),
      productionSourceManifest: simpleManifest(malformed),
      tokenizer,
    })).toThrowError(expect.objectContaining({ code: "WRAPPER_INVALID" }));
  });
});

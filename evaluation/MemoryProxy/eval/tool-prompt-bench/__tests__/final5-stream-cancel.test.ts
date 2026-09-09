import { expect, it } from "vitest";
import { createHttpCapture, type CaptureEvent } from "../final5-http-capture.js";

it("keeps overlapping requests in the same session associated with their own responses", async () => {
  const events: CaptureEvent[] = [];
  const capture = createHttpCapture(event => events.push(event), async (_input, init) => {
    const body = JSON.parse(init!.body as string);
    await new Promise(resolve => setTimeout(resolve, body.label === "title" ? 20 : 1));
    return new Response(JSON.stringify({ label: body.label }));
  });
  const run = async (label: string) => {
    const body = JSON.stringify({ model: "test", label });
    const context = {
      req: { path: "/v1/messages", method: "POST", header: () => "same-session",
        raw: new Request("http://localhost/v1/messages", { method: "POST", body }) },
      res: new Response(),
    };
    await capture.middleware(context, async () => {
      context.res = await capture.fetch("http://provider/v1/messages", { method: "POST", body });
    });
    expect(await context.res.json()).toEqual({ label });
  };
  await Promise.all([run("title"), run("main")]);
  const starts = events.filter(event => event.type === "provider.start");
  expect(starts).toHaveLength(2);
  expect(new Set(starts.map(event => event.parentId)).size).toBe(2);
  for (const start of starts) {
    const end = events.find(event => event.type === "provider.end" && event.id === start.id)!;
    const input = events.find(event => event.type === "input.start" && event.id === start.parentId)!;
    expect(JSON.parse(end.rawBody!).label).toBe((start.body as any).label);
    expect((input.body as any).label).toBe((start.body as any).label);
  }
});

it("records client cancellation and the terminal bytes already delivered", async () => {
  const events: CaptureEvent[] = [];
  const terminal = 'data: {"type":"response.completed"}\n\n';
  const capture = createHttpCapture(event => events.push(event), fetch);
  const context = {
    req: { path: "/v1/responses", method: "POST", header: () => "session",
      raw: new Request("http://localhost/v1/responses", { method: "POST", body: "{}" }) },
    res: new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode(terminal)); },
    })),
  };
  await capture.middleware(context, async () => {});
  const reader = context.res.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toBe(terminal);
  await reader.cancel();
  const ends = events.filter(event => event.type === "input.end");
  expect(ends).toHaveLength(1);
  expect(ends[0].streamOutcome).toBe("cancelled");
  expect(ends[0].rawBody).toBe(terminal);
});

import { request } from "@playwright/test";

// HTTP teardown also works on Windows, where killing a child process may skip
// its signal handlers. The fixture acknowledges only after its schema is dropped.
export default async function teardown() {
  const api = await request.newContext();
  try {
    const response = await api.post("http://127.0.0.1:4301/api/__fixture/shutdown", {
      headers: { "X-Scribble-Fixture": process.env.SCRIBBLE_FIXTURE_TOKEN! }, timeout: 10_000,
    });
    if (!response.ok()) throw new Error(`Isolated fixture cleanup failed (${response.status()})`);
    // Wait until shutdown has completed before Playwright terminates processes.
    for (let attempt = 0; attempt < 100; attempt++) {
      try { await api.get("http://127.0.0.1:4301/health", { timeout: 500 }); }
      catch { return; }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Isolated fixture did not finish dropping its schema");
  } finally { await api.dispose(); }
}

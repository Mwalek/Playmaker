import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import { existsSync } from "fs";

/**
 * Initialize Playwright agents if they don't exist.
 */
function ensureAgents(): void {
  if (!existsSync(".claude/agents/playwright-test-planner.md")) {
    console.log("Initializing Playwright agents...");
    execSync("npx playwright init-agents --loop=claude", { stdio: "inherit" });
  }
}

/**
 * Mock GitHub summary provider.
 * In the future, this will use GitHub MCP to get actual PR changes.
 */
function getChangeSummary(): string {
  return "A search bar has been added to the homepage that allows users to search for products.";
}

async function createTestPlan(): Promise<void> {
  ensureAgents();

  const changeSummary = getChangeSummary();

  console.log(`Change summary: ${changeSummary}`);
  console.log("Creating test plan...\n");

  const q = query({
    prompt: `Use the playwright-test-planner agent to create a test plan.

**What changed:** ${changeSummary}`,
    options: {
      maxTurns: 50,
      cwd: process.cwd(),
      model: "sonnet",
    },
  });

  for await (const message of q) {
    if (message.type === "assistant" && message.message) {
      const textContent = message.message.content.find(
        (c: any) => c.type === "text"
      );
      if (textContent && "text" in textContent) {
        console.log(textContent.text);
      }
    }
  }

  console.log("\nTest plan created in specs/ directory");
}

createTestPlan().catch(console.error);

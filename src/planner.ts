import { query } from "@anthropic-ai/claude-agent-sdk";

/**
 * Mock GitHub summary provider.
 * In the future, this will use GitHub MCP to get actual PR changes.
 */
function getChangeSummary(): string {
  return "A search bar has been added to the homepage that allows users to search for products.";
}

async function createTestPlan(targetUrl: string): Promise<void> {
  const changeSummary = getChangeSummary();

  console.log(`Target URL: ${targetUrl}`);
  console.log(`Change summary: ${changeSummary}`);
  console.log("Creating test plan...\n");

  const q = query({
    prompt: `Use the playwright-test-planner agent to create a test plan.

**What changed:** ${changeSummary}

**Target URL:** ${targetUrl}`,
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

// CLI
const targetUrl = process.argv[2];
if (!targetUrl) {
  console.error("Usage: npm run plan <target-url>");
  console.error("Example: npm run plan https://example.com");
  process.exit(1);
}

createTestPlan(targetUrl).catch(console.error);

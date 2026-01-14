import { query } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "fs";
import * as path from "path";

const PLANNER_SYSTEM = fs.readFileSync(
  path.join(process.cwd(), ".claude/agents/playwright-test-planner.md"),
  "utf-8"
);

// Extract just the system prompt (after the frontmatter)
const systemPrompt = PLANNER_SYSTEM.split("---").slice(2).join("---").trim();

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
    prompt: `Create a test plan for the following change:

**What changed:** ${changeSummary}

**Target URL:** ${targetUrl}

Follow the planner instructions to:
1. Use planner_setup_page to set up the browser with the target URL
2. Navigate to the application and locate the changed feature
3. Design test scenarios specifically for the change described above
4. Save the plan using planner_save_plan`,
    options: {
      maxTurns: 50,
      cwd: process.cwd(),
      model: "sonnet",
      systemPrompt,
      allowedTools: [
        "Glob",
        "Grep",
        "Read",
        "LS",
        "Write",
        "mcp__playwright-test__browser_click",
        "mcp__playwright-test__browser_close",
        "mcp__playwright-test__browser_console_messages",
        "mcp__playwright-test__browser_drag",
        "mcp__playwright-test__browser_evaluate",
        "mcp__playwright-test__browser_file_upload",
        "mcp__playwright-test__browser_handle_dialog",
        "mcp__playwright-test__browser_hover",
        "mcp__playwright-test__browser_navigate",
        "mcp__playwright-test__browser_navigate_back",
        "mcp__playwright-test__browser_network_requests",
        "mcp__playwright-test__browser_press_key",
        "mcp__playwright-test__browser_select_option",
        "mcp__playwright-test__browser_snapshot",
        "mcp__playwright-test__browser_take_screenshot",
        "mcp__playwright-test__browser_type",
        "mcp__playwright-test__browser_wait_for",
        "mcp__playwright-test__planner_setup_page",
        "mcp__playwright-test__planner_save_plan",
      ],
      mcpServers: {
        "playwright-test": {
          command: "npx",
          args: ["playwright", "run-test-mcp-server"],
        },
      },
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

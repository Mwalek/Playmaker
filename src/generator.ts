import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";

/**
 * Initialize Playwright agents if they don't exist.
 */
function ensureAgents(): void {
  const generatorExists = existsSync(".claude/agents/playwright-test-generator.md");
  const plannerExists = existsSync(".claude/agents/playwright-test-planner.md");

  if (!generatorExists || !plannerExists) {
    console.log("Initializing Playwright agents...");
    execSync("npx playwright init-agents --loop=claude", { stdio: "inherit" });
  }

  // Verify generator agent exists after initialization
  if (!existsSync(".claude/agents/playwright-test-generator.md")) {
    console.error("ERROR: playwright-test-generator agent not found!");
    console.error("Make sure Playwright is installed and init-agents completed successfully.");
    process.exit(1);
  }

  console.log("✓ playwright-test-generator agent ready");
}

/**
 * Find and read the test plan from specs/ directory.
 */
function getTestPlan(): string | null {
  if (!existsSync("specs")) {
    console.log("specs/ directory not found. Run planner first.");
    return null;
  }

  const files = readdirSync("specs").filter((f) => f.endsWith(".md") && f !== "README.md");

  if (files.length === 0) {
    console.log("No test plan found in specs/ directory. Run planner first.");
    return null;
  }

  // Read the first (and should be only) test plan file
  const planFile = `specs/${files[0]}`;
  console.log(`Reading test plan: ${planFile}`);
  return readFileSync(planFile, "utf-8");
}

async function generateTest(): Promise<void> {
  const testPlan = getTestPlan();

  if (!testPlan) {
    console.log("No test plan available. Run planner first.");
    process.exit(0);
  }

  ensureAgents();

  console.log("Test plan loaded");
  console.log("\nGenerating test for highest priority case...\n");

  // Track total cost
  let totalCost = 0;

  const q = query({
    prompt: `IMPORTANT: You MUST use the playwright-test-generator agent (NOT the planner agent).

Call the Task tool with subagent_type="playwright-test-generator" to generate EXACTLY ONE test.

**Test Plan:**
${testPlan}

CRITICAL INSTRUCTIONS for the generator agent:
1. Generate ONLY ONE test for the HIGHEST PRIORITY test case in the plan
2. Do NOT generate multiple tests
3. Do NOT generate tests for other test cases
4. Do NOT create a new test plan - the plan already exists above
5. Save the generated test file to tests/ directory using the Write tool
6. Follow the test plan's structure and expectations exactly

Generate the single most important test and stop.`,
    options: {
      maxTurns: 50,
      cwd: process.cwd(),
      model: "haiku",
      maxBudgetUsd: parseFloat(process.env.PLAYMAKER_MAX_BUDGET || "1.0"),
      allowedTools: [
        "Task",
        "Bash",
        "Glob",
        "Grep",
        "Read",
        "Edit",
        "MultiEdit",
        "Write",
        "WebFetch",
        "WebSearch",
        "TodoWrite",
      ],
    },
  });

  for await (const message of q) {
    // Track costs from system messages
    if (message.type === "system" && "cost" in message && typeof message.cost === "number") {
      totalCost += message.cost;
    }

    // Handle budget exceeded error
    if (message.type === "error" && "error" in message &&
        typeof message.error === "object" && message.error !== null &&
        "type" in message.error && message.error.type === "budget_exceeded") {
      console.error("\n⚠️  Budget limit exceeded");
      break;
    }

    // Log agent invocations to verify correct agent is used
    if (message.type === "assistant" && message.message) {
      for (const block of message.message.content || []) {
        if ((block as any).type === "tool_use" && (block as any).name === "Task") {
          const subagentType = (block as any).input?.subagent_type;
          console.log(`\n→ Invoking agent: ${subagentType}`);
          if (subagentType === "playwright-test-planner") {
            console.error("⚠️  WARNING: Using planner agent instead of generator!");
          }
        }
      }

      const textContent = message.message.content.find(
        (c: unknown) => (c as { type: string }).type === "text"
      );
      if (textContent && "text" in (textContent as { text?: string })) {
        console.log((textContent as { text: string }).text);
      }
    }
  }

  console.log("\nTest generated in tests/ directory");
  console.log(`💰 Total cost: $${totalCost.toFixed(4)}`);
}

generateTest().catch(console.error);

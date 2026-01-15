import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import { existsSync, readdirSync, readFileSync } from "fs";

interface PRInfo {
  number: number;
  title: string;
  body: string | null;
  files: Array<{ filename: string; status: string; additions: number; deletions: number }>;
  diff: string;
}

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
 * Get PR information from GitHub Actions event payload.
 * No API calls needed - GitHub provides full PR data in the event file.
 */
function getPRInfo(): PRInfo | null {
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventPath) {
    console.log("GITHUB_EVENT_PATH not found.");
    return null;
  }

  const event = JSON.parse(readFileSync(eventPath, "utf-8"));
  const pr = event.pull_request;

  if (!pr) {
    console.log("No pull_request in event payload.");
    return null;
  }

  console.log(`Reading PR #${pr.number}: ${pr.title}`);

  // Get diff using git (base and head SHAs are in the event)
  let diff = "";
  try {
    const baseSha = pr.base.sha;
    const headSha = pr.head.sha;
    diff = execSync(`git diff ${baseSha}...${headSha}`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  } catch (error) {
    console.log("Could not get diff via git, continuing without it.");
  }

  // Get changed files from git
  let files: PRInfo["files"] = [];
  try {
    const baseSha = pr.base.sha;
    const headSha = pr.head.sha;
    const numstat = execSync(`git diff --numstat ${baseSha}...${headSha}`, { encoding: "utf-8" });
    files = numstat
      .trim()
      .split("\n")
      .filter((line) => line)
      .map((line) => {
        const [additions, deletions, filename] = line.split("\t");
        return {
          filename,
          status: "modified",
          additions: parseInt(additions) || 0,
          deletions: parseInt(deletions) || 0,
        };
      });
  } catch (error) {
    console.log("Could not get file stats via git, continuing without them.");
  }

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    files,
    diff: diff.slice(0, 50000), // Limit diff size
  };
}

/**
 * Format PR info into a summary for the planner.
 */
function formatPRSummary(prInfo: PRInfo): string {
  const filesSummary = prInfo.files
    .map((f) => `- ${f.filename} (${f.status}: +${f.additions}/-${f.deletions})`)
    .join("\n");

  return `## Pull Request #${prInfo.number}: ${prInfo.title}

### Description
${prInfo.body || "No description provided."}

### Files Changed
${filesSummary}

### Diff
\`\`\`diff
${prInfo.diff}
\`\`\``;
}

/**
 * Get change summary from GitHub PR.
 * Returns null if not running in a PR context.
 */
function getChangeSummary(): string | null {
  // Allow mock data only if explicitly enabled for testing
  if (process.env.PLAYMAKER_MOCK) {
    console.log("Using mock data (PLAYMAKER_MOCK=true)");
    return "A search bar has been added to the homepage that allows users to search for products.";
  }

  const prInfo = getPRInfo();
  return prInfo ? formatPRSummary(prInfo) : null;
}

async function createTestPlan(): Promise<void> {
  const changeSummary = getChangeSummary();

  if (!changeSummary) {
    console.log("No PR data available. Playmaker only runs on pull_request events.");
    console.log("To test locally, set PLAYMAKER_MOCK=true");
    process.exit(0);
  }

  ensureAgents();

  console.log("Change summary:");
  console.log(changeSummary.slice(0, 500) + (changeSummary.length > 500 ? "..." : ""));
  console.log("\nCreating test plan...\n");

  // Track total cost with message ID deduplication
  let totalCost = 0;
  const processedMessageIds = new Set<string>();

  const q = query({
    prompt: `Use the playwright-test-planner agent to create a test plan and SAVE it to specs/ directory.

**What changed:**
${changeSummary}

IMPORTANT: The plan must be saved to a markdown file in the specs/ directory using the Write tool.`,
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
    // Track costs from assistant messages with deduplication
    // Per docs: assistant messages contain usage data, and messages with same ID share identical usage
    if (message.type === "assistant" && message.message) {
      const assistantMsg = message.message as any;
      const messageId = assistantMsg.id;
      const usage = assistantMsg.usage;

      if (messageId && usage && !processedMessageIds.has(messageId)) {
        processedMessageIds.add(messageId);

        // Calculate cost from usage tokens
        const inputCost = (usage.input_tokens || 0) * 0.00003;
        const outputCost = (usage.output_tokens || 0) * 0.00015;
        const cacheReadCost = (usage.cache_read_input_tokens || 0) * 0.0000075;
        const stepCost = inputCost + outputCost + cacheReadCost;

        totalCost += stepCost;

        console.log(`[DEBUG] Message ${messageId}: input=${usage.input_tokens}, output=${usage.output_tokens}, cost=$${stepCost.toFixed(4)}`);
      }

      // Display text content
      const textContent = assistantMsg.content.find(
        (c: unknown) => (c as { type: string }).type === "text"
      );
      if (textContent && "text" in (textContent as { text?: string })) {
        console.log((textContent as { text: string }).text);
      }
    }

    // Handle budget exceeded error
    if (message.type === "error" && "error" in message &&
        typeof message.error === "object" && message.error !== null &&
        "type" in message.error && message.error.type === "budget_exceeded") {
      console.error("\n⚠️  Budget limit exceeded");
      break;
    }
  }

  console.log("\nTest plan created in specs/ directory");
  console.log(`\n💰 Total cost: $${totalCost.toFixed(4)} (${processedMessageIds.size} steps)`);
}

createTestPlan().catch(console.error);

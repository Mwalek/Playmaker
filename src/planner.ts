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
    console.log("GITHUB_EVENT_PATH not found. Using mock data.");
    return null;
  }

  const event = JSON.parse(readFileSync(eventPath, "utf-8"));
  const pr = event.pull_request;

  if (!pr) {
    console.log("No pull_request in event payload. Using mock data.");
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
 * Get change summary - from GitHub PR or mock data.
 */
function getChangeSummary(): string {
  const prInfo = getPRInfo();

  if (prInfo) {
    return formatPRSummary(prInfo);
  }

  // Fallback mock data for local testing
  return "A search bar has been added to the homepage that allows users to search for products.";
}

async function createTestPlan(): Promise<void> {
  ensureAgents();

  const changeSummary = getChangeSummary();

  console.log("Change summary:");
  console.log(changeSummary.slice(0, 500) + (changeSummary.length > 500 ? "..." : ""));
  console.log("\nCreating test plan...\n");

  const q = query({
    prompt: `Use the playwright-test-planner agent to create a test plan and SAVE it to specs/ directory.

**What changed:**
${changeSummary}

IMPORTANT: The plan must be saved to a markdown file in the specs/ directory using the Write tool.`,
    options: {
      maxTurns: 50,
      cwd: process.cwd(),
      model: "sonnet",
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
    if (message.type === "assistant" && message.message) {
      const textContent = message.message.content.find(
        (c: unknown) => (c as { type: string }).type === "text"
      );
      if (textContent && "text" in (textContent as { text?: string })) {
        console.log((textContent as { text: string }).text);
      }
    }
  }

  // Debug: List what's actually in specs/ directory
  console.log("\n--- DEBUG: Checking specs/ directory ---");
  console.log(`Current working directory: ${process.cwd()}`);

  if (existsSync("specs")) {
    const files = readdirSync("specs");
    console.log(`Files in specs/: ${files.join(", ") || "(empty)"}`);
  } else {
    console.log("specs/ directory does not exist!");
  }

  console.log("\nTest plan created in specs/ directory");
}

createTestPlan().catch(console.error);

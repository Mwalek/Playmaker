import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import { trackQuery } from "./utils/query-tracker";

interface PRInfo {
  number: number;
  title: string;
  body: string | null;
  files: Array<{ filename: string; status: string; additions: number; deletions: number }>;
  diff: string;
}

interface DocsBotResponse {
  answer: string;
  sources: Array<{ title: string; url: string }>;
}

/**
 * Validate required DocsBot environment variables.
 */
function validateDocsBotEnv(): { apiKey: string; teamId: string; botId: string } | null {
  const apiKey = process.env.DOCSBOT_API_KEY;
  const teamId = process.env.DOCSBOT_TEAM_ID;
  const botId = process.env.DOCSBOT_BOT_ID;

  if (!apiKey || !teamId || !botId) {
    console.error("Missing required DocsBot environment variables:");
    if (!apiKey) console.error("  - DOCSBOT_API_KEY");
    if (!teamId) console.error("  - DOCSBOT_TEAM_ID");
    if (!botId) console.error("  - DOCSBOT_BOT_ID");
    return null;
  }

  return { apiKey, teamId, botId };
}

/**
 * Get PR information from GitHub Actions event payload.
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

  // Get diff using git
  let diff = "";
  try {
    const baseSha = pr.base.sha;
    const headSha = pr.head.sha;
    diff = execSync(`git diff ${baseSha}...${headSha}`, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 });
  } catch {
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
  } catch {
    console.log("Could not get file stats via git, continuing without them.");
  }

  return {
    number: pr.number,
    title: pr.title,
    body: pr.body,
    files,
    diff: diff.slice(0, 50000),
  };
}

/**
 * Format PR info into a summary.
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
 */
function getChangeSummary(): string | null {
  if (process.env.PLAYMAKER_MOCK) {
    console.log("Using mock data (PLAYMAKER_MOCK=true)");
    return "A new payment processing feature has been added that handles Stripe webhooks and updates user subscriptions.";
  }

  const prInfo = getPRInfo();
  return prInfo ? formatPRSummary(prInfo) : null;
}

/**
 * Query DocsBot API with a summary of the changes.
 */
async function queryDocsBot(
  summary: string,
  config: { apiKey: string; teamId: string; botId: string }
): Promise<DocsBotResponse> {
  const question = `What documentation exists for these features or areas of the codebase?

${summary}

Please identify:
1. Any existing documentation that covers these features
2. Related documentation that might need updates
3. Documentation gaps for these areas`;

  const response = await fetch(
    `https://api.docsbot.ai/teams/${config.teamId}/bots/${config.botId}/chat`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ question }),
    }
  );

  if (!response.ok) {
    throw new Error(`DocsBot API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return {
    answer: data.answer || "No response from DocsBot.",
    sources: data.sources || [],
  };
}

/**
 * Main function to check documentation needs.
 */
async function checkDocs(): Promise<void> {
  // Validate DocsBot environment
  const docsBotConfig = validateDocsBotEnv();
  if (!docsBotConfig) {
    process.exit(1);
  }

  // Get PR change summary
  const changeSummary = getChangeSummary();

  if (!changeSummary) {
    console.log("No PR data available. docs-check only runs on pull_request events.");
    console.log("To test locally, set PLAYMAKER_MOCK=true");
    process.exit(0);
  }

  console.log("Change summary:");
  console.log(changeSummary.slice(0, 500) + (changeSummary.length > 500 ? "..." : ""));
  console.log("\nQuerying DocsBot for existing documentation...\n");

  // Query DocsBot
  let docsBotResponse: DocsBotResponse;
  try {
    docsBotResponse = await queryDocsBot(changeSummary, docsBotConfig);
    console.log("DocsBot response received.");
  } catch (error) {
    console.error(`DocsBot API error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  // Format sources for the prompt
  const sourcesFormatted = docsBotResponse.sources.length > 0
    ? docsBotResponse.sources.map((s) => `- [${s.title}](${s.url})`).join("\n")
    : "No specific documentation sources found.";

  console.log("\nAnalyzing documentation needs with Claude...\n");

  // Query Claude with embedded prompt
  const q = query({
    prompt: `You are a documentation analyst. Compare the PR changes against existing documentation and determine if documentation updates are needed.

**PR Changes:**
${changeSummary}

**Existing Documentation (from DocsBot):**
${docsBotResponse.answer}

**Documentation Sources:**
${sourcesFormatted}

Analyze the changes and create a report. Your report MUST include:
1. **Documentation Status**: Whether docs exist for the features changed in this PR
2. **Update Assessment**: Whether existing docs need updates based on the changes
3. **Recommendations**: Specific recommendations for documentation (can be "no changes needed" if appropriate)

IMPORTANT: Save your report to docs-report.md using the Write tool. The report should be well-formatted markdown.`,
    options: {
      maxTurns: 20,
      cwd: process.cwd(),
      model: "haiku",
      maxBudgetUsd: parseFloat(process.env.PLAYMAKER_MAX_BUDGET || "1.0"),
      allowedTools: [
        "Read",
        "Write",
        "Glob",
        "Grep",
      ],
    },
  });

  const { totalCost, stepCount } = await trackQuery(q, {
    onAssistantMessage: (message) => {
      const textContent = message.message.content.find(
        (c: unknown) => (c as { type: string }).type === "text"
      );
      if (textContent && "text" in (textContent as { text?: string })) {
        console.log((textContent as { text: string }).text);
      }
    },
  });

  // Verify report was created
  if (existsSync("docs-report.md")) {
    console.log("\n✓ Documentation report created: docs-report.md");
  } else {
    console.error("\n⚠️  No docs-report.md found");
    console.log(`\n💰 Total cost: $${totalCost.toFixed(4)} (${stepCount} steps)`);
    process.exit(1);
  }

  console.log(`\n💰 Total cost: $${totalCost.toFixed(4)} (${stepCount} steps)`);
}

checkDocs().catch((error) => {
  console.error(error);
  process.exit(1);
});

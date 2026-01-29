import Anthropic from "@anthropic-ai/sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
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

interface FilteredChanges {
  hasRelevantChanges: boolean;
  summary: string;
  reason: string;
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
 * Use Claude to filter PR changes and identify documentation-relevant items.
 * Leverages bot summaries (like CodeRabbit) to avoid re-parsing diffs.
 */
async function filterRelevantChanges(prInfo: PRInfo): Promise<FilteredChanges> {
  // Use direct Anthropic SDK for simple one-shot prompt (no tools needed)
  const client = new Anthropic();

  const prompt = `Analyze this PR and identify ONLY the changes that might need documentation updates.

**PR Title:** ${prInfo.title}

**PR Description (may contain bot summaries):**
${prInfo.body || "No description"}

**Files Changed:**
${prInfo.files.map(f => `- ${f.filename}`).join("\n")}

**Rules - IGNORE these (infrastructure/internal):**
- CI/CD workflow changes (.github/workflows/*)
- Dependency updates (package.json, composer.json, etc.)
- Test file changes (tests/*, *_test.*, *.spec.*)
- Configuration files (.gitignore, .env.example, etc.)
- Build/tooling changes
- Internal refactoring with no user-facing impact

**Rules - INCLUDE these (documentation-relevant):**
- UI text/label changes that users see
- New features users interact with
- API changes (new endpoints, changed parameters)
- Behavior changes users would notice
- Removed features or deprecations

Respond ONLY with JSON (no markdown, no explanation):
{"hasRelevantChanges": true/false, "summary": "Brief description of documentation-relevant changes only", "reason": "Why these changes do/don't need documentation review"}`;

  const response = await client.messages.create({
    model: "claude-3-5-haiku-latest",
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const responseText = response.content[0].type === "text" ? response.content[0].text : "";

  try {
    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as FilteredChanges;
    }
  } catch {
    console.log("Could not parse filter response, assuming relevant");
  }

  // Default to treating as relevant if parsing fails
  return {
    hasRelevantChanges: true,
    summary: prInfo.body || prInfo.title,
    reason: "Could not determine relevance, defaulting to check",
  };
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

  // Get PR info
  let prInfo: PRInfo | null = null;
  if (process.env.PLAYMAKER_MOCK) {
    console.log("Using mock data (PLAYMAKER_MOCK=true)");
    prInfo = {
      number: 123,
      title: "Update button label",
      body: `## Summary by CodeRabbit
* Updated button label from "Use a Form Preset" to "Start With a Template"
* Added new CI workflow for docs checking`,
      files: [
        { filename: "includes/admin/metaboxes/views/data-source.php", status: "modified", additions: 1, deletions: 1 },
        { filename: ".github/workflows/docs-check.yml", status: "added", additions: 30, deletions: 0 },
      ],
      diff: "",
    };
  } else {
    prInfo = getPRInfo();
  }

  if (!prInfo) {
    console.log("No PR data available. docs-check only runs on pull_request events.");
    console.log("To test locally, set PLAYMAKER_MOCK=true");
    process.exit(0);
  }

  const reportPath = `${process.cwd()}/docs-report.md`;

  // Step 1: Filter relevant changes using Claude
  console.log("Analyzing PR for documentation-relevant changes...\n");
  const filtered = await filterRelevantChanges(prInfo);

  console.log(`Relevant changes: ${filtered.hasRelevantChanges ? "Yes" : "No"}`);
  console.log(`Reason: ${filtered.reason}\n`);

  // If no relevant changes, create simple report and exit
  if (!filtered.hasRelevantChanges) {
    const report = `# Documentation Check Report

**PR #${prInfo.number}:** ${prInfo.title}

## Result: No Documentation Updates Needed

${filtered.reason}

### Changes in this PR (all infrastructure/internal):
${prInfo.files.map(f => `- ${f.filename}`).join("\n")}

---
*Generated by Playmaker docs-check*
`;
    writeFileSync(reportPath, report);
    console.log("✓ No documentation-relevant changes found");
    console.log(`✓ Report saved to: ${reportPath}`);
    process.exit(0);
  }

  // Step 2: Query DocsBot with filtered summary
  console.log("Filtered summary for DocsBot:");
  console.log(filtered.summary);
  console.log("\nQuerying DocsBot for existing documentation...\n");

  let docsBotResponse: DocsBotResponse;
  try {
    docsBotResponse = await queryDocsBot(filtered.summary, docsBotConfig);
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
  console.log(`Report will be saved to: ${reportPath}\n`);

  // Step 3: Final analysis with Claude Agent
  const q = query({
    prompt: `You are a documentation analyst. Compare the PR changes against existing documentation and determine if documentation updates are needed.

**PR #${prInfo.number}:** ${prInfo.title}

**Documentation-Relevant Changes:**
${filtered.summary}

**Existing Documentation (from DocsBot):**
${docsBotResponse.answer}

**Documentation Sources:**
${sourcesFormatted}

Analyze the changes and create a report. Your report MUST include:
1. **Documentation Status**: Whether docs exist for the features changed in this PR
2. **Update Assessment**: Whether existing docs need updates based on the changes
3. **Recommendations**: Specific recommendations for documentation (can be "no changes needed" if appropriate)

CRITICAL: You MUST save your report using the Write tool to this exact absolute path: ${reportPath}
The report should be well-formatted markdown.`,
    options: {
      maxTurns: 20,
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
  if (existsSync(reportPath)) {
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

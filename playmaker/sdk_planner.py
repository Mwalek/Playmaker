"""MVP: Create test plan using Claude Agent SDK + Playwright MCP."""

import asyncio
import sys
from pathlib import Path

from claude_agent_sdk import query, ClaudeAgentOptions


async def create_test_plan(url: str, output_file: str = None) -> str:
    """Create a test plan for a given URL using Playwright to browse it."""

    output_instruction = ""
    if output_file:
        output_instruction = f"Save the test plan to {output_file}"

    result = ""

    async for message in query(
        prompt=f"""Go to {url} and create a simple Playwright test plan.

1. Use Playwright to navigate to the URL
2. Take a snapshot to see what's on the page
3. Create a markdown test plan with 2-3 test scenarios
4. Include ready-to-use Playwright test code for each scenario

{output_instruction}

Output the test plan in markdown format.""",
        options=ClaudeAgentOptions(
            allowed_tools=["Read", "Write", "Glob"],
            mcp_servers={
                "playwright": {
                    "command": "npx",
                    "args": ["@anthropic-ai/playwright-mcp@latest"]
                }
            }
        )
    ):
        if hasattr(message, "result"):
            result = message.result

    return result


async def main():
    # Simple CLI: playmaker-plan <url> [output_file]
    if len(sys.argv) < 2:
        print("Usage: python -m playmaker.sdk_planner <url> [output_file]")
        print("Example: python -m playmaker.sdk_planner https://example.com specs/plan.md")
        sys.exit(1)

    url = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    print(f"🎯 Creating test plan for: {url}")
    if output_file:
        print(f"📄 Output: {output_file}")

    plan = await create_test_plan(url, output_file)
    print("\n" + plan)


if __name__ == "__main__":
    asyncio.run(main())

"""Create Playwright test plans using Claude Agent SDK + Playwright MCP."""

from claude_agent_sdk import query, ClaudeAgentOptions


async def create_test_plan(url: str, output_file: str = None) -> str:
    """Create a test plan for a given URL using Playwright to browse it.

    Args:
        url: The URL to create a test plan for
        output_file: Optional path to save the test plan

    Returns:
        Markdown test plan with Playwright test code
    """
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

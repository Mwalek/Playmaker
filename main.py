#!/usr/bin/env python3
"""Playmaker - Playwright test agent orchestrator with Judge."""

import argparse
import asyncio
import subprocess
import sys
from pathlib import Path

from playmaker import JudgeAgent, PlaymakerOrchestrator


def cmd_plan(args):
    """Run Playwright planner agent."""
    print(f"🎯 Planning: {args.request}")
    result = subprocess.run(
        ["npx", "playwright", "planner", "--request", args.request],
        cwd=args.dir,
    )
    sys.exit(result.returncode)


def cmd_generate(args):
    """Run Playwright generator agent."""
    print("⚙️ Generating tests...")
    result = subprocess.run(
        ["npx", "playwright", "generator"],
        cwd=args.dir,
    )
    sys.exit(result.returncode)


def cmd_heal(args):
    """Run Playwright healer agent."""
    print("🩹 Healing tests...")
    result = subprocess.run(
        ["npx", "playwright", "healer"],
        cwd=args.dir,
    )
    sys.exit(result.returncode)


async def cmd_judge(args):
    """Judge existing tests."""
    if args.file:
        judge = JudgeAgent()
        verdict = await judge.evaluate_file(Path(args.file))
        print(f"Score: {verdict.score}/100")
        print(f"Passed: {verdict.passed}")
        if verdict.issues:
            print("Issues:")
            for issue in verdict.issues:
                print(f"  - {issue}")
        if verdict.suggestions:
            print("Suggestions:")
            for suggestion in verdict.suggestions:
                print(f"  - {suggestion}")
    else:
        orchestrator = PlaymakerOrchestrator(project_dir=args.dir)
        await orchestrator.judge_existing_tests()


async def cmd_workflow(args):
    """Run full workflow."""
    orchestrator = PlaymakerOrchestrator(
        project_dir=args.dir,
        judge_threshold=args.threshold,
    )

    if args.full:
        results = await orchestrator.workflow_full(args.request)
    else:
        results = await orchestrator.workflow_plan_generate_judge(args.request)

    print("\n📋 Workflow Summary:")
    for result in results:
        status = "✅" if result.success else "❌"
        print(f"  {status} {result.stage}")


def main():
    parser = argparse.ArgumentParser(
        description="Playmaker - Playwright test agent orchestrator with Judge"
    )
    parser.add_argument("--dir", "-d", default=".", help="Project directory")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Plan command
    plan_parser = subparsers.add_parser("plan", help="Create test plan from description")
    plan_parser.add_argument("request", help="Test description (e.g., 'Homepage contains a URL')")
    plan_parser.set_defaults(func=lambda args: cmd_plan(args))

    # Generate command
    gen_parser = subparsers.add_parser("generate", help="Generate tests from plan")
    gen_parser.set_defaults(func=lambda args: cmd_generate(args))

    # Heal command
    heal_parser = subparsers.add_parser("heal", help="Heal failing tests")
    heal_parser.set_defaults(func=lambda args: cmd_heal(args))

    # Judge command
    judge_parser = subparsers.add_parser("judge", help="Judge test quality with AI")
    judge_parser.add_argument("--file", "-f", help="Single test file to judge")
    judge_parser.set_defaults(func=lambda args: asyncio.run(cmd_judge(args)))

    # Workflow command
    workflow_parser = subparsers.add_parser("workflow", help="Run full agent workflow")
    workflow_parser.add_argument("request", help="Test request/description")
    workflow_parser.add_argument("--full", action="store_true", help="Include healer")
    workflow_parser.add_argument("--threshold", type=int, default=70, help="Judge pass threshold")
    workflow_parser.set_defaults(func=lambda args: asyncio.run(cmd_workflow(args)))

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()

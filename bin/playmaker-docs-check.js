#!/usr/bin/env node
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const docsCheckerPath = join(__dirname, "..", "src", "docs-checker.ts");

spawn("npx", ["tsx", docsCheckerPath], { stdio: "inherit" }).on("exit", process.exit);

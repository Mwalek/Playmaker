#!/usr/bin/env node
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const plannerPath = join(__dirname, "..", "src", "planner.ts");

spawn("npx", ["tsx", plannerPath], { stdio: "inherit" }).on("exit", process.exit);

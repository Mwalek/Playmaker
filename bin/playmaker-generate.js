#!/usr/bin/env node
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const generatorPath = join(__dirname, "..", "src", "generator.ts");

spawn("npx", ["tsx", generatorPath], { stdio: "inherit" }).on("exit", process.exit);

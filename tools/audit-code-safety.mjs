import { readFile } from "node:fs/promises";

const bundle = await readFile("main.js", "utf8");
const forbidden = [
  {
    label: "dynamic script element creation",
    pattern: /create(?:Element|El)\s*\(\s*["'`]script["'`]\s*\)/u
  },
  {
    label: "dynamic script element creation through a tag variable",
    pattern: /create(?:Element|El)\s*\(\s*[A-Za-z_$][\w$]*\s*\)[\s\S]{0,160}\.src\s*=/u
  }
];
const failures = forbidden
  .filter(({ pattern }) => pattern.test(bundle))
  .map(({ label }) => label);

if (failures.length > 0) {
  throw new Error(
    `Code safety audit failed:\n${failures.join("\n")}`
  );
}

console.log("Code safety audit passed: no dynamic script element creation.");

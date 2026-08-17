import { readFile, writeFile } from "node:fs/promises";

const path = "artifacts/adventure-zone/src/components/activities/activity-timeline.tsx";
const before = await readFile(path, "utf8");
let after = before;

const importBefore = 'import { BUSINESS_TIME_ZONE } from "@/lib/business-date";\n';
const importAfter = 'import { BUSINESS_TIME_ZONE } from "@/lib/business-date";\nimport { actHtmlToPlainText } from "@/features/activities/act-html-text";\n';
if (!after.includes(importAfter)) {
  if (!after.includes(importBefore)) throw new Error("business date import not found");
  after = after.replace(importBefore, importAfter);
}

const bodyBefore = `                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">\n                  {activity.body}\n                </p>`;
const bodyAfter = `                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">\n                  {activity.importedFromAct ? actHtmlToPlainText(activity.body) : activity.body}\n                </p>`;
if (!after.includes(bodyAfter)) {
  if (!after.includes(bodyBefore)) throw new Error("activity body renderer not found");
  after = after.replace(bodyBefore, bodyAfter);
}

if (after !== before) {
  await writeFile(path, after);
  console.log("Updated ACT history body renderer");
} else {
  console.log("No changes needed");
}

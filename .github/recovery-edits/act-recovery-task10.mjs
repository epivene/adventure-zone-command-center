import { readFile, writeFile } from "node:fs/promises";

async function edit(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after === before) {
    console.log(`No change: ${path}`);
    return;
  }
  await writeFile(path, after);
  console.log(`Updated: ${path}`);
}

function replaceRequired(text, before, after, label) {
  if (text.includes(after)) return text;
  if (!text.includes(before)) throw new Error(`Missing ${label}`);
  return text.replace(before, after);
}

await edit("artifacts/adventure-zone/src/pages/ActRecoveryPage.tsx", (text) =>
  replaceRequired(
    text,
    '>Needs review</span>',
    '>Review required</span>',
    "unique review badge",
  ),
);

await edit("artifacts/adventure-zone/src/App.tsx", (text) => {
  text = replaceRequired(
    text,
    'import ActMigrationPage from "@/pages/ActMigrationPage";\n',
    'import ActMigrationPage from "@/pages/ActMigrationPage";\nimport ActRecoveryPage from "@/pages/ActRecoveryPage";\n',
    "ACT Recovery page import",
  );
  text = replaceRequired(
    text,
    '              <Route path="/settings/act-migration" component={ActMigrationPage} />\n              <Route path="/settings" component={SettingsStub} />',
    '              <Route path="/settings/act-migration" component={ActMigrationPage} />\n              <Route path="/settings/act-recovery" component={ActRecoveryPage} />\n              <Route path="/settings" component={SettingsStub} />',
    "ACT Recovery route",
  );
  return text;
});

await edit("artifacts/adventure-zone/src/pages/ActMigrationPage.tsx", (text) => {
  text = replaceRequired(
    text,
    'import { useCallback, useEffect, useRef, useState } from "react";\n',
    'import { useCallback, useEffect, useRef, useState } from "react";\nimport { Link } from "wouter";\n',
    "wouter Link import",
  );
  text = replaceRequired(
    text,
    '      <p className="mt-2 text-slate-600">\n        Automatic review uses the saved archive, followed by a separate safe\n        import. Uncertain data stays preserved in the archive.\n      </p>\n\n      <StageProgress active={stage} />',
    '      <p className="mt-2 text-slate-600">\n        Automatic review uses the saved archive, followed by a separate safe\n        import. Uncertain data stays preserved in the archive.\n      </p>\n      <Link\n        className="button-secondary mt-4 inline-flex min-h-11 items-center justify-center"\n        href="/settings/act-recovery"\n      >\n        Recover archived ACT data\n      </Link>\n\n      <StageProgress active={stage} />',
    "ACT Recovery migration link",
  );
  return text;
});

import { parseActCsv } from "@/features/import/act-csv";
import { previewActImport } from "@/features/import/act-matcher";
import { requireOwner } from "@/lib/auth/require-owner";

const maxCsvBytes = 5 * 1024 * 1024;

export async function POST(request: Request) {
  await requireOwner();

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return Response.json(
      { error: "Choose an Act! CSV file to preview." },
      { status: 400 },
    );
  }
  if (file.size > maxCsvBytes) {
    return Response.json(
      { error: "The CSV file must be 5 MB or smaller." },
      { status: 413 },
    );
  }
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return Response.json(
      { error: "Choose a file with a .csv extension." },
      { status: 400 },
    );
  }

  try {
    const records = parseActCsv(await file.text());
    if (records.length === 0) {
      return Response.json(
        { error: "The CSV does not contain any contact rows." },
        { status: 400 },
      );
    }
    const preview = await previewActImport(records, {
      sourceFileName: file.name,
    });
    return Response.json(preview);
  } catch (error) {
    if (error instanceof Error) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json(
      { error: "The CSV could not be previewed." },
      { status: 400 },
    );
  }
}

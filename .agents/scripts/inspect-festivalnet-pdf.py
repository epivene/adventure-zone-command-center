"""Render an uploaded FestivalNet PDF and inspect its embedded hyperlinks."""

import argparse
import json
from pathlib import Path

import fitz


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, default=Path(".agents/outputs/festivalnet-sample"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with fitz.open(args.pdf) as document:
        print(f"Pages: {document.page_count}")
        for index, page in enumerate(document):
            output = args.output / f"page-{index + 1}.png"
            page.get_pixmap(matrix=fitz.Matrix(2, 2)).save(str(output))
            print(f"Rendered: {output}")
            links = [
                {"uri": link["uri"], "label": page.get_textbox(link["from"]).strip()}
                for link in page.get_links()
                if link.get("uri")
            ]
            print(json.dumps({"page": index + 1, "links": links}, indent=2))


if __name__ == "__main__":
    main()

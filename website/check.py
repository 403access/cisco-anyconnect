#!/usr/bin/env python3
"""Sanity checks for the static site.

Validates, with no third-party dependencies:

  * HTML tag balance (catches unclosed / mismatched elements)
  * duplicate `id`s
  * every local `href` / `src` points at a file that exists
  * `aria-controls` and `data-copy` point at real ids
  * highlighted code blocks contain nothing but `tk-*` spans

Usage:
    python3 check.py
"""

from __future__ import annotations

import html.parser
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(ROOT, "index.html")

VOID = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}
EXTERNAL = ("http://", "https://", "mailto:", "tel:", "#", "data:")


class Checker(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=False)
        self.stack: list[tuple[str, tuple[int, int]]] = []
        self.errors: list[str] = []
        self.ids: set[str] = set()
        self.references: list[str] = []
        self.controls: list[str] = []
        self.copy_targets: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)

        if "id" in attributes:
            if attributes["id"] in self.ids:
                self.errors.append(f"duplicate id: {attributes['id']}")
            self.ids.add(attributes["id"])

        if "aria-controls" in attributes:
            self.controls.append(attributes["aria-controls"])
        if "data-copy" in attributes:
            self.copy_targets.append(attributes["data-copy"])

        for key in ("href", "src"):
            if key in attributes:
                self.references.append(attributes[key])

        if tag not in VOID:
            self.stack.append((tag, self.getpos()))

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID and self.stack:
            self.stack.pop()

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        if not self.stack:
            self.errors.append(f"stray </{tag}> at line {self.getpos()[0]}")
            return
        opened, position = self.stack.pop()
        if opened != tag:
            self.errors.append(
                f"mismatched </{tag}> at line {self.getpos()[0]} "
                f"(expected </{opened}>, opened at line {position[0]})"
            )


def main() -> int:
    with open(INDEX, encoding="utf-8") as handle:
        source = handle.read()

    checker = Checker()
    checker.feed(source)

    problems = list(checker.errors)

    if checker.stack:
        problems.append(f"unclosed tags: {[tag for tag, _ in checker.stack]}")

    for reference in checker.references:
        if reference.startswith(EXTERNAL):
            continue
        target = reference.split("#", 1)[0]
        if target and not os.path.exists(os.path.join(ROOT, target)):
            problems.append(f"missing local file: {reference}")

    for target in checker.controls + checker.copy_targets:
        if target not in checker.ids:
            problems.append(f"dangling reference to id: {target}")

    for block in re.findall(r'<code id="code-[^"]*">(.*?)</code>', source, re.S):
        for tag in re.findall(r"</?([a-zA-Z][\w-]*)", block):
            if tag != "span":
                problems.append(f"unexpected <{tag}> inside a highlighted code block")

    print(
        f"checked {len(checker.ids)} ids, {len(checker.references)} references, "
        f"{len(checker.copy_targets)} copy targets"
    )

    if problems:
        print("\nproblems:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print("structure, references and ids all valid")
    return 0


if __name__ == "__main__":
    sys.exit(main())

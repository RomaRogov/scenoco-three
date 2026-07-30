#!/usr/bin/env bash
# Validate SceNoCo XML documents against the XSDs `scenoco export` generates.
#
#   scripts/check-xml.sh              # every scene/prefab/particle/material doc
#   scripts/check-xml.sh a.scene.xml  # just these files
#
# The schema is taken from each file's own `xsi:noNamespaceSchemaLocation`,
# resolved relative to the file — the same hint lemminx honours in the editor.
# Never hard-code a schema path here: a per-project schema is generated from that
# project's components and tag packages, so the repo has more than one.
set -uo pipefail

files=("$@")
if [ ${#files[@]} -eq 0 ]; then
  while IFS= read -r f; do files+=("$f"); done < <(
    git ls-files '*.scene.xml' '*.prefab.xml' '*.particle.xml' '*.material.xml'
  )
fi

fail=0
for f in "${files[@]}"; do
  [ -f "$f" ] || continue

  loc="$(sed -n 's/.*noNamespaceSchemaLocation="\([^"]*\)".*/\1/p' "$f" | head -1)"
  if [ -z "$loc" ]; then
    echo "SKIP $f (no xsi:noNamespaceSchemaLocation)" >&2
    continue
  fi

  xsd="$(cd "$(dirname "$f")" && cd "$(dirname "$loc")" 2>/dev/null && pwd)/$(basename "$loc")"
  if [ ! -f "$xsd" ]; then
    echo "FAIL $f — schema not found: $loc (run \`npm run export\` in that project)" >&2
    fail=1
    continue
  fi

  if ! err="$(xmllint --noout --schema "$xsd" "$f" 2>&1)"; then
    printf '%s\n' "$err" | grep -v ' validates$' >&2
    fail=1
  fi
done

[ $fail -eq 0 ] && echo "✓ XML valid (${#files[@]} file(s))"
exit $fail

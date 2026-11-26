#!/usr/bin/env bash
set -euo pipefail

action=$1
binary=$2
symbols=$3

build_id() {
  readelf -nW "$1" | sed -n 's/.*Build ID: //p'
}

if [ "$action" = split ]; then
  objcopy --only-keep-debug "$binary" "$symbols"
  # The debug-only ELF has no contents for its original interpreter section.
  symbol_sections=$(readelf -SW "$symbols" 2>/dev/null)
  if ! grep -Eq '[[:space:]]\.symtab[[:space:]]' <<< "$symbol_sections"; then
    echo "$symbols: expected the shell's symbol table" >&2
    exit 1
  fi
  strip --strip-all "$binary"
  objcopy --add-gnu-debuglink="$symbols" "$binary"
elif [ "$action" != verify ]; then
  echo "expected split or verify, got $action" >&2
  exit 1
fi

sections=$(readelf -SW "$binary")
id=$(build_id "$binary")
if grep -Eq '[[:space:]]\.(symtab|strtab)[[:space:]]' <<< "$sections" ||
   [ -z "$id" ] || [ "$id" != "$(build_id "$symbols" 2>/dev/null)" ] ||
   ! readelf --string-dump=.gnu_debuglink "$binary" | grep -Fq "${symbols##*/}"; then
  echo "$binary: expected a stripped ELF with a debug link and the build ID of $symbols" >&2
  exit 1
fi
echo "$binary: stripped, debug companion ${symbols##*/}, build ID $id"

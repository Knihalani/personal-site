#!/bin/sh
# Build publishable pages: concept source + contact-gate fragment appended.
cd "$(dirname "$0")"
for f in "$@"; do
  b=$(basename "$f")
  cat "$b" contact-gate/contact-gate.html > "dist/$b"
  grep -ciE 'gmail|risingfounder\.net"|kaiav\.nihalani@|kaiav@' "dist/$b" | sed "s/^/$b email-hits: /"
  grep -c 'data-contact-gate' "dist/$b" | sed "s/^/$b gate-mounts: /"
done

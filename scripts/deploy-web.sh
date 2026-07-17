#!/bin/sh
set -eu

host=${1:-}
origin=${2:-https://link.watermelonbackup.com}
if [ -z "$host" ]; then
  echo "Usage: $0 <ssh-host> [public-origin]" >&2
  exit 64
fi

stamp=$(date -u +%Y%m%d%H%M%S)
release="/opt/watermelon-link/web-releases/$stamp"

npm run build
expected_asset=$(sed -n 's/.*src="\([^"]*\/assets\/index-[^"]*\.js\)".*/\1/p' dist/web/index.html | head -n 1)
if [ -z "$expected_asset" ]; then
  echo "Built index.html does not reference a fingerprinted JavaScript asset" >&2
  exit 1
fi

ssh "$host" "mkdir -p '$release'"
scp -q -r dist/web/. "$host:$release/"
previous=$(ssh "$host" 'readlink -f /opt/watermelon-link/web-current 2>/dev/null || true')
ssh "$host" sh -s -- "$release" "$previous" <<'REMOTE'
set -eu
release=$1
previous=$2
root=/opt/watermelon-link
case "$release" in
  "$root"/web-releases/*) ;;
  *) exit 1 ;;
esac
observed=$(readlink -f "$root/web-current" 2>/dev/null || true)
test "$observed" = "$previous"
test -f "$release/index.html"
test -f "$release/.well-known/apple-app-site-association"
find "$release/assets" -maxdepth 1 -type f -name 'index-*.js' | grep -q .
if [ -n "$previous" ]; then
  case "$previous" in
    "$root"/web-releases/*) ;;
    *) exit 1 ;;
  esac
  test -d "$previous/assets"
  for old_asset in "$previous"/assets/index-*.js "$previous"/assets/index-*.css; do
    test -f "$old_asset" || continue
    destination="$release/assets/$(basename "$old_asset")"
    test -e "$destination" || cp -p "$old_asset" "$destination"
  done
fi
next="$root/web-current.next.$(basename "$release")"
rm -f "$next"
ln -s "$release" "$next"
mv -Tf "$next" "$root/web-current"
REMOTE

activated=true
rollback() {
  status=$?
  trap - EXIT HUP INT TERM
  if [ "$activated" = true ]; then
    ssh "$host" sh -s -- "$release" "$previous" <<'REMOTE' || true
set -eu
release=$1
previous=$2
root=/opt/watermelon-link
current=$(readlink -f "$root/web-current" 2>/dev/null || true)
if [ "$current" = "$release" ]; then
  if [ -n "$previous" ]; then
    case "$previous" in
      "$root"/web-releases/*) ;;
      *) exit 1 ;;
    esac
    test -f "$previous/index.html"
    next="$root/web-current.rollback.$(basename "$release")"
    rm -f "$next"
    ln -s "$previous" "$next"
    mv -Tf "$next" "$root/web-current"
  else
    rm -f "$root/web-current"
  fi
fi
REMOTE
  fi
  exit "$status"
}
trap rollback EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

deployed=false
attempt=0
while [ "$attempt" -lt 15 ]; do
  html=$(curl -fsS -H 'Cache-Control: no-cache' "$origin/" || true)
  case "$html" in
    *"$expected_asset"*) deployed=true; break ;;
  esac
  attempt=$((attempt + 1))
  sleep 1
done
if [ "$deployed" != true ]; then
  echo "Public site did not expose $expected_asset" >&2
  exit 1
fi

node scripts/smoke.mjs "$origin"
activated=false
trap - EXIT HUP INT TERM
echo "Published web release $stamp without restarting the signaling service"

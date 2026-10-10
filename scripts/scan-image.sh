#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == --help || $# -ne 1 ]]; then
  echo 'Usage: bash scripts/scan-image.sh <docker-image-archive.tar>'
  echo 'Linux x86_64: checks a pinned official Trivy download, then fails on HIGH/CRITICAL image vulnerabilities.'
  exit 0
fi
[[ -f "$1" ]] || { echo 'Image archive missing.' >&2; exit 2; }
mkdir -p .build
scanner_dir="$(mktemp -d .build/trivy.XXXXXX)"
trap 'rm -rf "$scanner_dir"' EXIT
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/aquasecurity/trivy/releases/download/v0.75.0/trivy_0.75.0_Linux-64bit.tar.gz \
  --output "$scanner_dir/trivy.tar.gz"
printf '%s  %s\n' c6e65abddb348e25f10549df887045629cf28cc72453cd1c63acb717316b3f3f "$scanner_dir/trivy.tar.gz" | sha256sum --check
tar -xzf "$scanner_dir/trivy.tar.gz" -C "$scanner_dir" trivy
"$scanner_dir/trivy" image --quiet --input "$1" --cache-dir .build/trivy-cache --scanners vuln \
  --severity HIGH,CRITICAL --exit-code 1 --format json --output .build/image-security.json --timeout 10m
echo 'Image security gate passed; full HIGH/CRITICAL report: .build/image-security.json'

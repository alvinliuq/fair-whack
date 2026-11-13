#!/usr/bin/env bash
# Find (or create) the "fair-whack" D1 database and print its id.
set -euo pipefail
id=$(npx --no-install wrangler d1 list --json 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const a=JSON.parse(s);const d=a.find(x=>x.name==="fair-whack");if(d)console.log(d.uuid||d.id)}catch{}})')
if [ -z "${id}" ]; then
  npx --no-install wrangler d1 create fair-whack >&2
  id=$(npx --no-install wrangler d1 list --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const d=JSON.parse(s).find(x=>x.name==="fair-whack");console.log(d.uuid||d.id)})')
fi
echo "${id}"

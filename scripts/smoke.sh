#!/usr/bin/env bash
# End-to-end check of the permission boundary and the two required demos.
# Usage: BASE=http://localhost:3737 ./scripts/smoke.sh
set -uo pipefail
BASE="${BASE:-http://localhost:3737}"
pass=0; fail=0
check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ok   $1"; pass=$((pass+1));
  else echo "  FAIL $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}

echo "== visible memory counts (active, by scope) =="
for u in u_ryan u_sean u_daniel u_mitchell; do
  printf "  %-12s " "$u"
  curl -s "$BASE/api/state?userId=$u" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);
      const a=s.memories.filter(m=>m.status==="active");
      const by=k=>a.filter(m=>m.scope===k).length;
      console.log(`personal=${by("personal")} team=${by("team")} org=${by("org")} | keys: ${a.map(m=>m.key).sort().join(",")}`);})'
done

echo
echo "== demo 2: the Finance pricing rule =="
for u in u_ryan u_sean u_daniel u_mitchell; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "$BASE/api/memories/mem_fin_pricing?userId=$u")
  case "$u" in
    u_ryan|u_sean) check "$u sees it" 200 "$code" ;;
    *)             check "$u blocked" 404 "$code" ;;
  esac
done

echo
echo "== ops rule is symmetric (Finance must not see Operations) =="
check "u_daniel sees ops rule"   200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/memories/mem_ops_escalation?userId=u_daniel")"
check "u_ryan blocked from ops"  404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/memories/mem_ops_escalation?userId=u_ryan")"

echo
echo "== personal memories are private =="
check "u_daniel sees own"    200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/memories/mem_daniel_bullets?userId=u_daniel")"
check "u_mitchell blocked"   404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/memories/mem_daniel_bullets?userId=u_mitchell")"

echo
echo "== org memories reach everyone =="
for u in u_ryan u_sean u_daniel u_mitchell; do
  check "$u sees org rule" 200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/memories/mem_org_dates?userId=$u")"
done

echo
echo "== pending proposals bind nobody =="
check "author sees pending"     200 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/memories/mem_pending_cc?userId=u_mitchell")"
check "colleague blocked"       404 "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/memories/mem_pending_cc?userId=u_daniel")"

echo
echo "== cross-user write is refused =="
code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/memories/mem_daniel_bullets" \
  -H 'content-type: application/json' -d '{"userId":"u_mitchell","content":"hijacked"}')
check "mitchell cannot edit daniel's rule" 404 "$code"

echo
echo "== retrieval: same question, two users =="
for u in u_sean u_mitchell; do
  sid=$(curl -s "$BASE/api/state?userId=$u" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);const l=s.sessionsByUser[process.argv[1]];console.log(l[l.length-1].id);})' "$u")
  printf "  %-12s " "$u"
  curl -s -X POST "$BASE/api/chat" -H 'content-type: application/json' \
    -d "{\"userId\":\"$u\",\"sessionId\":\"$sid\",\"content\":\"How should I price the Northwind renewal?\"}" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);
      if(r.error){console.log("ERROR "+r.error);process.exit(0);}
      const used=r.state.memories.filter(m=>r.retrieval.injected.includes(m.id));
      console.log(`injected ${r.retrieval.injected.length}/${r.retrieval.visibleCount} -> ${used.map(m=>m.key).join(", ")||"(none)"}`);})'
done

echo
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]

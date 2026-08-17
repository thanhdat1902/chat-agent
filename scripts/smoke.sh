#!/usr/bin/env bash
# End-to-end check of the permission boundary against any deployment.
#
#   BASE=https://your-app.vercel.app ./scripts/smoke.sh
#   MUTATE=1 BASE=... ./scripts/smoke.sh     # also exercises correct / ratify / delete
#
# Memory ids are discovered from the live API, never hardcoded, so this works
# against the demo seed, a blank slate you have typed rules into, or any other
# state. Assertions that need a particular kind of memory skip themselves with
# a message when that kind does not exist yet.
set -uo pipefail
BASE="${BASE:-http://localhost:3737}"
pass=0; fail=0; skip=0

check() { # name expected actual
  if [ "$2" = "$3" ]; then echo "  ok   $1"; pass=$((pass+1));
  else echo "  FAIL $1 — expected [$2] got [$3]"; fail=$((fail+1)); fi
}
skipped() { echo "  skip $1"; skip=$((skip+1)); }
code() { curl -s -o /dev/null -w "%{http_code}" "$@"; }

# find <userId> <scope> [status]  -> prints a memory id, or empty
find_memory() {
  curl -s "$BASE/api/state?userId=$1" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const s=JSON.parse(d); const [,,scope,status]=process.argv;
      const m=(s.memories||[]).find(x=>x.scope===scope && (!status||x.status===status));
      console.log(m?m.id:"");});' "" "$2" "${3:-}"
}
member_of() { # userId -> team name
  curl -s "$BASE/api/state?userId=$1" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
      const s=JSON.parse(d);console.log(s.actor.teamNames[0]||"");});'
}

echo "== who is in this deployment =="
curl -s "$BASE/api/state?userId=u_ryan" | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);
    for (const u of s.users) {
      const n=(s.sessionsByUser[u.id]||[]).length;
      console.log(`  ${u.name.padEnd(9)} ${(u.teamNames[0]||"no team").padEnd(11)} ${n} chat(s)`);
    }
    console.log(`  model: ${s.modelLabel}`);});'

echo
echo "== visible memory counts (active, by scope) =="
for u in u_ryan u_sean u_daniel u_mitchell; do
  printf "  %-12s " "$u"
  curl -s "$BASE/api/state?userId=$u" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const s=JSON.parse(d);
      const a=(s.memories||[]).filter(m=>m.status==="active");
      const by=k=>a.filter(m=>m.scope===k).length;
      console.log(`personal=${by("personal")} team=${by("team")} org=${by("org")}`
        + (a.length?` | keys: ${a.map(m=>m.key).sort().join(",")}`:" | (none yet)"));});'
done

# ---------------------------------------------------------------- team scope --
echo
echo "== a team memory reaches its team and nobody else =="
FIN=$(find_memory u_ryan team active)
if [ -z "$FIN" ]; then
  skipped "no Finance team memory exists yet — create one as Ryan or Sean"
else
  check "ryan (author's team) sees it"  200 "$(code "$BASE/api/memories/$FIN?userId=u_ryan")"
  check "sean (same team) sees it"      200 "$(code "$BASE/api/memories/$FIN?userId=u_sean")"
  check "daniel (other team) blocked"   404 "$(code "$BASE/api/memories/$FIN?userId=u_daniel")"
  check "mitchell (other team) blocked" 404 "$(code "$BASE/api/memories/$FIN?userId=u_mitchell")"
fi

OPS=$(find_memory u_daniel team active)
if [ -z "$OPS" ]; then
  skipped "no Operations team memory exists yet"
else
  check "daniel sees the ops memory"  200 "$(code "$BASE/api/memories/$OPS?userId=u_daniel")"
  check "ryan blocked from ops"       404 "$(code "$BASE/api/memories/$OPS?userId=u_ryan")"
fi

# ------------------------------------------------------------ personal scope --
echo
echo "== a personal memory stays with its owner =="
PERS=$(find_memory u_daniel personal active)
if [ -z "$PERS" ]; then
  skipped "no personal memory for daniel yet"
else
  check "owner sees it"                    200 "$(code "$BASE/api/memories/$PERS?userId=u_daniel")"
  check "teammate blocked"                 404 "$(code "$BASE/api/memories/$PERS?userId=u_mitchell")"
  check "other team blocked"               404 "$(code "$BASE/api/memories/$PERS?userId=u_ryan")"
  code=$(curl -s -o /dev/null -w "%{http_code}" -X PATCH "$BASE/api/memories/$PERS" \
    -H 'content-type: application/json' -d '{"userId":"u_mitchell","content":"hijacked"}')
  check "and cannot be edited by anyone else" 404 "$code"
fi

# ----------------------------------------------------------------- org scope --
echo
echo "== an org memory reaches everyone =="
ORG=$(find_memory u_ryan org active)
if [ -z "$ORG" ]; then
  skipped "no ratified org memory yet — set one and confirm it"
else
  for u in u_ryan u_sean u_daniel u_mitchell; do
    check "$u sees the org memory" 200 "$(code "$BASE/api/memories/$ORG?userId=$u")"
  done
fi

# -------------------------------------------------------------------- pending --
echo
echo "== a pending proposal binds nobody =="
for author in u_ryan u_sean u_daniel u_mitchell; do
  P=$(find_memory "$author" org pending)
  [ -z "$P" ] && P=$(find_memory "$author" team pending)
  [ -z "$P" ] && P=$(find_memory "$author" personal pending)
  if [ -n "$P" ]; then
    check "author sees own pending"  200 "$(code "$BASE/api/memories/$P?userId=$author")"
    other=$([ "$author" = "u_ryan" ] && echo u_sean || echo u_ryan)
    check "colleague blocked"        404 "$(code "$BASE/api/memories/$P?userId=$other")"
    break
  fi
done
[ -z "${P:-}" ] && skipped "no pending proposal exists — say something hedged, or an org rule"

# --------------------------------------------------------------- session acl --
echo
echo "== you can only delete your own chat =="
SID=$(curl -s -X POST "$BASE/api/sessions" -H 'content-type: application/json' \
  -d '{"userId":"u_sean"}' | node -e '
  let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).activeSessionId));')
check "another user is refused" 403 "$(code -X DELETE "$BASE/api/sessions/$SID?userId=u_mitchell")"
check "the owner succeeds"      200 "$(code -X DELETE "$BASE/api/sessions/$SID?userId=u_sean")"

# ------------------------------------------------------------------- mutate --
echo
echo "== correct / ratify / delete (mutates state) =="
if [ "${MUTATE:-0}" = "1" ]; then
  M=$(find_memory u_daniel personal active)
  if [ -z "$M" ]; then
    skipped "no personal memory for daniel to correct"
  else
    check "owner corrects it" 200 "$(curl -s -o /dev/null -w '%{http_code}' -X PATCH \
      "$BASE/api/memories/$M" -H 'content-type: application/json' \
      -d '{"userId":"u_daniel","content":"Corrected by the smoke suite."}')"
    new=$(curl -s "$BASE/api/memories/$M?userId=u_daniel" | node -e '
      let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).memory.content));')
    check "correction persisted" "Corrected by the smoke suite." "$new"
    check "owner deletes it" 200 "$(code -X DELETE "$BASE/api/memories/$M?userId=u_daniel")"
    check "and it is gone"   404 "$(code "$BASE/api/memories/$M?userId=u_daniel")"
  fi
else
  skipped "set MUTATE=1 to exercise correct / delete"
fi

# ----------------------------------------------------------------- retrieval --
echo
echo "== same question, two teams =="
for u in u_sean u_mitchell; do
  sid=$(curl -s -X POST "$BASE/api/sessions" -H 'content-type: application/json' \
    -d "{\"userId\":\"$u\"}" | node -e '
    let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).activeSessionId));')
  printf "  %-12s " "$u"
  curl -s -X POST "$BASE/api/chat" -H 'content-type: application/json' \
    -d "{\"userId\":\"$u\",\"sessionId\":\"$sid\",\"content\":\"How should I price the Northwind renewal?\"}" \
    | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d);
      if(r.error){console.log("ERROR "+r.error);return;}
      const by=Object.fromEntries(r.state.memories.map(m=>[m.id,m]));
      const used=r.retrieval.injected.map(i=>`${by[i].scope}/${by[i].key}`);
      console.log(`injected ${r.retrieval.injected.length}/${r.retrieval.visibleCount} -> ${used.join(", ")||"(none)"}`);});'
  curl -s -o /dev/null -X DELETE "$BASE/api/sessions/$sid?userId=$u"
done

echo
echo "passed=$pass failed=$fail skipped=$skip"
[ "$fail" -eq 0 ]

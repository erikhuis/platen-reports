#!/usr/bin/env bash
# Move a platen-reports issue to a lane on the "Platen Reports Kanban" board (project #2).
#
#   platen-lane.sh <issue-number> "In progress"
#
# Fails loudly. AssetWorld's equivalent returns 0 on every failure path, which meant a wrong or
# missing move looked like a success; this one does not repeat that.
set -euo pipefail

ISSUE="${1:?usage: platen-lane.sh <issue-number> <lane>}"
LANE="${2:?usage: platen-lane.sh <issue-number> <lane>}"

PROJECT_ID="PVT_kwHOABtI_c4BgQU4"
STATUS_FIELD="PVTSSF_lAHOABtI_c4BgQU4zhadV3M"

case "$LANE" in
  "Backlog")     OPT="f75ad846" ;;
  "Ready")       OPT="61e4505c" ;;
  "In progress") OPT="47fc9ee4" ;;
  "In review")   OPT="df73e18b" ;;
  "Done")        OPT="98236657" ;;
  *) echo "unknown lane '$LANE' (Backlog|Ready|In progress|In review|Done)" >&2; exit 1 ;;
esac

# Guard: this script only ever addresses platen-reports. Run from another checkout it would
# otherwise resolve the number against whatever repo it found.
REMOTE=$(git remote get-url origin)
case "$REMOTE" in
  *erikhuis/platen-reports*) ;;
  *) echo "refusing: origin is '$REMOTE', not erikhuis/platen-reports" >&2; exit 1 ;;
esac

ITEM=$(gh api graphql -f query='
  query($n: Int!) {
    repository(owner: "erikhuis", name: "platen-reports") {
      issue(number: $n) { projectItems(first: 10) { nodes { id project { id } } } }
    }
  }' -F n="$ISSUE" \
  --jq ".data.repository.issue.projectItems.nodes[] | select(.project.id==\"$PROJECT_ID\") | .id")

if [ -z "$ITEM" ]; then
  echo "issue #$ISSUE is not on the Platen Reports Kanban board — add it first" >&2
  exit 1
fi

gh api graphql -f query='
  mutation($p: ID!, $i: ID!, $f: ID!, $o: String!) {
    updateProjectV2ItemFieldValue(input: {
      projectId: $p, itemId: $i, fieldId: $f, value: { singleSelectOptionId: $o }
    }) { projectV2Item { id } }
  }' -f p="$PROJECT_ID" -f i="$ITEM" -f f="$STATUS_FIELD" -f o="$OPT" >/dev/null

echo "issue #$ISSUE -> '$LANE'"

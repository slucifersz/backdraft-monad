#!/usr/bin/env bash
# Deploy a contract to Monad testnet and verify it on all explorers.
#
#   ./script/deploy.sh src/Counter.sol:Counter
#   ./script/deploy.sh src/Token.sol:Token "constructor(string,uint256)" "My Token" 1000
#
# Reads PRIVATE_KEY / RPC_URL / CHAIN_ID from contracts/.env (never committed).
# Appends the result to contracts/deployments.json.
set -euo pipefail
cd "$(dirname "$0")/.."

TARGET="${1:?usage: deploy.sh <path/File.sol:Contract> [constructor-sig args...]}"
shift || true
set -a; . ./.env; set +a

CTOR_SIG="${1:-}"
CTOR_ARGS_HEX=""
CREATE_ARGS=()
if [ -n "$CTOR_SIG" ]; then
  shift
  CTOR_ARGS_HEX="$(cast abi-encode "$CTOR_SIG" "$@")"
  CTOR_ARGS_HEX="${CTOR_ARGS_HEX#0x}"
  CREATE_ARGS=(--constructor-args "$@")
fi

forge build -q

# The proxy/RPC occasionally drops a connection; retry the send only if no tx went out.
OUT=""
for attempt in 1 2 3; do
  if OUT="$(forge create "$TARGET" --rpc-url "$RPC_URL" --private-key "$PRIVATE_KEY" \
        --broadcast --json ${CREATE_ARGS[@]+"${CREATE_ARGS[@]}"} 2>&1)"; then
    break
  fi
  if echo "$OUT" | grep -q transactionHash; then break; fi
  echo "deploy attempt $attempt failed, retrying..." >&2
  sleep 3
done

ADDR="$(echo "$OUT" | jq -r 'select(.deployedTo) | .deployedTo' 2>/dev/null | tail -1)"
TX="$(echo "$OUT" | jq -r 'select(.transactionHash) | .transactionHash' 2>/dev/null | tail -1)"
if [ -z "$ADDR" ] || [ "$ADDR" = "null" ]; then
  echo "deploy failed:" >&2
  echo "$OUT" | tail -5 >&2
  exit 1
fi
echo "deployed $TARGET -> $ADDR (tx $TX)"

# ---- verify on all explorers via the Monad verification API ----
FILE="${TARGET%%:*}"; NAME="${TARGET##*:}"
ARTIFACT="out/$(basename "$FILE")/$NAME.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
VERIFY_ARGS=()
[ -n "$CTOR_ARGS_HEX" ] && VERIFY_ARGS=(--constructor-args "0x$CTOR_ARGS_HEX")
forge verify-contract "$ADDR" "$TARGET" --chain "$CHAIN_ID" \
  --show-standard-json-input ${VERIFY_ARGS[@]+"${VERIFY_ARGS[@]}"} > "$TMP/input.json"
jq '.metadata' "$ARTIFACT" > "$TMP/meta.json"
VER="v$(jq -r '.metadata.compiler.version' "$ARTIFACT")"
jq -n --arg a "$ADDR" --arg n "$TARGET" --arg v "$VER" --arg c "$CTOR_ARGS_HEX" \
  --argjson chain "$CHAIN_ID" --slurpfile i "$TMP/input.json" --slurpfile m "$TMP/meta.json" \
  '{chainId:$chain, contractAddress:$a, contractName:$n, compilerVersion:$v,
    standardJsonInput:$i[0], foundryMetadata:$m[0]}
   + (if $c == "" then {} else {constructorArgs:$c} end)' > "$TMP/verify.json"
VERIFY="$(curl -sS --max-time 120 -X POST https://agents.devnads.com/v1/verify \
  -H "Content-Type: application/json" -d @"$TMP/verify.json" || echo '{"success":false}')"
echo "verify: $(echo "$VERIFY" | jq -c '{success, verified, total}' 2>/dev/null || echo "$VERIFY" | cut -c1-200)"

# ---- record ----
[ -f deployments.json ] || echo '[]' > deployments.json
jq --arg n "$NAME" --arg a "$ADDR" --arg t "$TX" --arg d "$(date -u +%FT%TZ)" --argjson chain "$CHAIN_ID" \
  '. + [{name:$n, address:$a, tx:$t, chainId:$chain, deployedAt:$d}]' deployments.json > "$TMP/d.json"
cp "$TMP/d.json" deployments.json
echo "explorer: https://testnet.monadscan.com/address/$ADDR"

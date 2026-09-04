#!/usr/bin/env bash
# End-to-end smoke test against the API
set -euo pipefail
API=http://localhost:4001
pass=0; fail=0
ok()  { echo "  PASS: $1"; pass=$((pass+1)); }
bad() { echo "  FAIL: $1"; fail=$((fail+1)); }

TOKEN=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"manager","pin":"1234"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

echo "== 1. POS sale =="
ITEM=$(curl -s "$API/api/items?metalType=gold&status=available" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d); console.log(a.length?(a[0].id+':'+(a[0].availableQty||1)):'')})")
ITEM_ID=$(echo "$ITEM" | cut -d: -f1)
QTY=$(echo "$ITEM" | cut -d: -f2)
echo "  using item=$ITEM_ID qty=$QTY"
SALE=$(curl -s -X POST $API/api/invoices -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"itemId\":$ITEM_ID,\"quantity\":$QTY}],\"paymentMethod\":\"cash\",\"paidAmount\":1000000,\"locationId\":1}")
INV_NO=$(echo "$SALE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); if(j.error){console.error('SALE ERROR:',j.error);process.exit(1)} console.log(j.invoiceNo)})")
INV_ID=$(echo "$SALE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).id))")
[ -n "$INV_NO" ] && ok "sale created: $INV_NO (id=$INV_ID)" || bad "sale"

echo "== 2. Verify item now sold =="
STATUS=$(curl -s "$API/api/items/$ITEM_ID" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).status))")
[ "$STATUS" = "sold" ] && ok "item status sold" || bad "status=$STATUS"

echo "== 3. Audit trail has sale entry =="
AUDIT=$(curl -s "$API/api/items/$ITEM_ID/audit" -H "Authorization: Bearer $TOKEN")
echo "$AUDIT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('  sales entries:', j.sales.length)})"

echo "== 4. Return invoice =="
curl -s -X POST $API/api/invoices/$INV_ID/return -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"reason":"اختبار إرجاع"}' > /dev/null
STATUS2=$(curl -s "$API/api/items/$ITEM_ID" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).status))")
[ "$STATUS2" = "available" ] && ok "item back to available after return" || bad "status=$STATUS2"

echo "== 5. Add second location =="
LOC2=$(curl -s -X POST $API/api/locations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"code\":\"BR2-$RANDOM\",\"nameAr\":\"فرع المعادي\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); if(j.error){console.error('LOC ERROR:',j.error);process.exit(1)} console.log(j.id)})")
ok "location created id=$LOC2"

echo "== 6. Transfer item + receive =="
MOV=$(curl -s -X POST $API/api/movements -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"itemId\":$ITEM_ID,\"quantity\":$QTY,\"toLocationId\":$LOC2,\"reason\":\"نقل للتجربة\"}")
MOV_ID=$(echo "$MOV" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); if(j.error){console.error('MOV ERROR:',j.error);process.exit(1)} console.log(j.id)})")
ok "movement created id=$MOV_ID"
STATUS3=$(curl -s "$API/api/items/$ITEM_ID" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).status))")
[ "$STATUS3" = "in_transit" ] && ok "item in_transit" || bad "status=$STATUS3"
curl -s -X POST $API/api/movements/$MOV_ID/receive -H "Authorization: Bearer $TOKEN" > /dev/null
LOC_CHECK=$(curl -s "$API/api/items/$ITEM_ID" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log(j.status+'/'+j.currentLocationId)})")
[ "$LOC_CHECK" = "available/$LOC2" ] && ok "received at new location" || bad "loc=$LOC_CHECK"

echo "== 7. Reservation with down payment =="
RES=$(curl -s -X POST $API/api/reservations -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"itemId\":$ITEM_ID,\"quantity\":$QTY,\"customerName\":\"أحمد\",\"downPayment\":500,\"totalValue\":1500}")
RES_ID=$(echo "$RES" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); if(j.error){console.error('RES ERROR:',j.error);process.exit(1)} console.log(j.id)})")
ok "reservation created id=$RES_ID"
STATUS4=$(curl -s "$API/api/items/$ITEM_ID" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).status))")
[ "$STATUS4" = "reserved" ] && ok "item reserved" || bad "status=$STATUS4"
curl -s -X POST $API/api/reservations/$RES_ID/cancel -H "Authorization: Bearer $TOKEN" > /dev/null

echo "== 8. Stock count =="
COUNT_ID=$(curl -s -X POST $API/api/stock-counts -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"locationId":1}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); if(j.error){console.error('COUNT ERROR:',j.error);process.exit(1)} console.log(j.id)})")
ok "stock count started id=$COUNT_ID"
COUNT_DETAIL=$(curl -s "$API/api/stock-counts/$COUNT_ID" -H "Authorization: Bearer $TOKEN")
EXPECTED_ITEM=$(echo "$COUNT_DETAIL" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); const e=j.expected[0]; console.log(e?(e.id+':'+e.expectedQty):'')})")
if [ -n "$EXPECTED_ITEM" ]; then
  EXP_ID=$(echo "$EXPECTED_ITEM" | cut -d: -f1)
  EXP_QTY=$(echo "$EXPECTED_ITEM" | cut -d: -f2)
  curl -s -X POST $API/api/stock-counts/$COUNT_ID/items -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"itemId\":$EXP_ID,\"countedQty\":$EXP_QTY}" > /dev/null
fi
curl -s -X POST $API/api/stock-counts/$COUNT_ID/complete -H "Authorization: Bearer $TOKEN" > /dev/null
REPORT=$(curl -s "$API/api/stock-counts/$COUNT_ID/report" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('missing='+j.missing.length+' extra='+j.extra.length)})")
ok "count completed ($REPORT)"

echo "== 9. Shift open/close with reconciliation =="
SHIFT_ID=$(curl -s -X POST $API/api/shifts/open -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"locationId":1}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log(j.id)})")
CLOSE=$(curl -s -X POST $API/api/shifts/$SHIFT_ID/close -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"countedCash":5000,"notes":"اختبار"}')
echo "$CLOSE" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); if(j.error){console.error('CLOSE ERROR:',j.error);process.exit(1)} console.log('  expected='+j.expectedCash+' counted='+j.countedCash+' diff='+j.difference)})"
ok "shift closed"

echo "== 10. Reports =="
for r in inventory-value profitability slow-stock stock-limits discrepancies shift-reconciliation today-prices; do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API/api/reports/$r" -H "Authorization: Bearer $TOKEN")
  [ "$CODE" = "200" ] && ok "report $r" || bad "report $r (HTTP $CODE)"
done

echo "== 11. Discount cap enforcement =="
# cashier cap is 2%; try 10% without manager PIN -> should be 403
CTOKEN=$(curl -s -X POST $API/api/auth/login -H 'Content-Type: application/json' -d '{"identifier":"cashier","pin":"1234"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")
# get an available silver item
SILVER=$(curl -s "$API/api/items?metalType=silver&status=available" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d); console.log(a.length?a[0].id:'')})")
if [ -n "$SILVER" ]; then
  RESULT=$(curl -s -X POST $API/api/invoices -H "Authorization: Bearer $CTOKEN" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"itemId\":$SILVER}],\"discountPercent\":10,\"locationId\":1}")
  echo "$RESULT" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('  result:', j.error||j.invoiceNo)})"
  # same with manager PIN -> should succeed
  RESULT2=$(curl -s -X POST $API/api/invoices -H "Authorization: Bearer $CTOKEN" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"itemId\":$SILVER}],\"discountPercent\":10,\"managerPin\":\"1234\",\"locationId\":1}")
  echo "$RESULT2" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); console.log('  with manager pin:', j.error||j.invoiceNo)})"
fi

echo "== 12. Manager fixed discount (قيمة ثابتة) =="
AVAIL=$(curl -s "$API/api/items?status=available" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d); console.log(a.length?a[0].id:'')})")
if [ -n "$AVAIL" ]; then
  FIXED=$(curl -s -X POST $API/api/invoices -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
    -d "{\"items\":[{\"itemId\":$AVAIL}],\"discountType\":\"fixed\",\"discountValue\":40,\"locationId\":1}")
  echo "$FIXED" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d); if(j.error){console.error('  FIXED ERROR:',j.error);process.exit(1)} console.log('  discountAmount='+j.discountAmount+' reason='+j.discountReason); if(Number(j.discountAmount)!==40){process.exit(1)}})"
  ok "manager fixed discount applied"
fi

echo "== 13. Cashier discount toggles =="
# feature 1: disable cashier discounts entirely -> cashier gets 403
curl -s -X PUT $API/api/settings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cashier_discount_enabled":false}' > /dev/null
AVAIL2=$(curl -s "$API/api/items?status=available" -H "Authorization: Bearer $TOKEN" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const a=JSON.parse(d); console.log(a.length?a[0].id:'')})")
DISABLED_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $API/api/invoices -H "Authorization: Bearer $CTOKEN" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"itemId\":$AVAIL2}],\"discountPercent\":1,\"locationId\":1}")
[ "$DISABLED_CODE" = "403" ] && ok "cashier blocked when discounts disabled" || bad "expected 403 got $DISABLED_CODE"
# feature 2: re-enable discounts, disable cap override -> cashier over cap blocked even with manager PIN
curl -s -X PUT $API/api/settings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cashier_discount_enabled":true,"cashier_cap_override_enabled":false}' > /dev/null
BLOCKED_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST $API/api/invoices -H "Authorization: Bearer $CTOKEN" -H 'Content-Type: application/json' \
  -d "{\"items\":[{\"itemId\":$AVAIL2}],\"discountPercent\":10,\"managerPin\":\"1234\",\"locationId\":1}")
[ "$BLOCKED_CODE" = "403" ] && ok "cashier blocked above cap when override disabled" || bad "expected 403 got $BLOCKED_CODE"
# restore defaults
curl -s -X PUT $API/api/settings -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"cashier_discount_enabled":true,"cashier_cap_override_enabled":true}' > /dev/null
ok "settings restored to defaults"

echo ""
echo "======================================"
echo "PASS: $pass   FAIL: $fail"
echo "======================================"
[ $fail -eq 0 ]

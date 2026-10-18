"""API-level checks for auth, name locks, payment rules and rate limiting.
Run against `npm run dev:mock` (default http://127.0.0.1:8787):  python tests/api_test.py [base_url]
"""
import json, urllib.request, sys
B = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787'
def call(method, path, body=None, headers=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    h = {'content-type': 'application/json' if raw is None else 'text/plain'}; h.update(headers or {})
    req = urllib.request.Request(B + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read())
ok = lambda c, m: print(('PASS ' if c else 'FAIL ') + m)

import random
st, parsed = call('POST', '/api/parse', raw=b'aGVsbG8=', headers={'cf-connecting-ip': '172.16.%d.%d' % (random.randint(1, 254), random.randint(1, 254))})
bill = parsed['bill']; ok(st == 200 and 'discount_paise' in bill and 'round_off_paise' in bill, f'parse returns discount/round-off fields {st}')
st, r = call('POST', '/api/rooms', {'host_name': 'Nishant', 'host_vpa': 'nish@ybl', 'participants': ['Rohan', 'Priya'], 'actual_paid': 99999, 'bill': bill})
ok(st == 400 and 'double' in r['error'], f'#2 server rejects paid > 2x total ({st})')
st, r = call('POST', '/api/rooms', {'host_name': 'Nishant', 'host_vpa': 'nish@ybl', 'participants': ['Rohan', 'Priya'], 'actual_paid': 1100, 'bill': bill})
room, htok = r['room_id'], r['host_token']; ok(st == 201 and len(htok) >= 30, '#10 room returns host token')
H = {'x-host-token': htok}
st, g = call('GET', f'/api/rooms/{room}')
ok('host_token_hash' not in g['session'] and g['viewer'] == {'is_host': False, 'participant_id': None, 'open_mode': False}, 'anon viewer: not host, hash not leaked')
st, g = call('GET', f'/api/rooms/{room}', headers=H); ok(g['viewer']['is_host'], 'host token recognised')
P = {p['name']: p for p in g['participants']}; item = g['items'][0]['id']
# claims without identity
st, r = call('PUT', f'/api/rooms/{room}/claims', {'item_id': item, 'participant_id': P['Rohan']['id'], 'claimed': True})
ok(st == 403, f'anon cannot claim for Rohan ({st})')
st, r = call('POST', f"/api/rooms/{room}/participants/{P['Rohan']['id']}/join"); rtok = r.get('token'); ok(st == 200 and rtok, 'Rohan joins, gets token')
st, r = call('POST', f"/api/rooms/{room}/participants/{P['Rohan']['id']}/join"); ok(st == 409, f'second phone cannot take Rohan ({st}): {r.get("error")}')
st, r = call('POST', f"/api/rooms/{room}/participants/{P['Nishant']['id']}/join"); ok(st == 409, f"diner cannot take host's name ({st})")
R = {'x-participant-token': rtok}
st, r = call('PUT', f'/api/rooms/{room}/claims', {'item_id': item, 'participant_id': P['Rohan']['id'], 'claimed': True}, R); ok(st == 200 and len(r['claims']) == 1, 'Rohan claims with his token')
st, r = call('PUT', f'/api/rooms/{room}/claims', {'item_id': item, 'participant_id': P['Priya']['id'], 'claimed': True}, R); ok(st == 403, f'Rohan cannot claim as Priya ({st})')
st, r = call('PUT', f'/api/rooms/{room}/claims', {'item_id': item, 'participant_id': P['Priya']['id'], 'claimed': True}, H); ok(st == 200, 'host can claim on behalf of Priya')
st, r = call('PATCH', f"/api/rooms/{room}/participants/{P['Rohan']['id']}", {'payment_status': 'SELF_PAID'}, R); ok(st == 200, 'Rohan marks self paid')
st, r = call('PATCH', f"/api/rooms/{room}/participants/{P['Rohan']['id']}", {'payment_status': 'HOST_CONFIRMED'}, R); ok(st == 403, f'Rohan cannot self-confirm ({st})')
st, r = call('PATCH', f"/api/rooms/{room}/participants/{P['Rohan']['id']}", {'payment_status': 'HOST_CONFIRMED'}, H); ok(st == 200, 'host confirms Rohan')
st, r = call('PATCH', f"/api/rooms/{room}/participants/{P['Rohan']['id']}", {'payment_status': 'UNPAID'}, R); ok(st == 403, f'Rohan cannot undo a host confirmation ({st})')
st, g = call('GET', f'/api/rooms/{room}', headers=R); ok(g['viewer']['participant_id'] == P['Rohan']['id'], 'viewer resolves Rohan from token')
st, r = call('POST', f"/api/rooms/{room}/participants/{P['Rohan']['id']}/reset", headers=R); ok(st == 403, 'diner cannot unlock')
st, r = call('POST', f"/api/rooms/{room}/participants/{P['Rohan']['id']}/reset", headers=H); ok(st == 200 and not [p for p in r['participants'] if p['name']=='Rohan'][0]['taken'], 'host unlocks Rohan')
st, r = call('POST', f"/api/rooms/{room}/participants/{P['Rohan']['id']}/join"); ok(st == 200 and r.get('token'), 'Rohan re-joins on a new phone')
# rate limit (limit set to 4/min for this test; 1 parse used above)
import random
ip = '10.%d.%d.%d' % tuple(random.randint(1, 254) for _ in range(3))
codes = []
for _ in range(60):
    codes.append(call('POST', '/api/parse', raw=b'aGVsbG8=', headers={'cf-connecting-ip': ip})[0])
    if codes[-1] == 429: break
ok(codes[-1] == 429 and set(codes[:-1]) == {200}, f'#4 per-IP rate limit kicks in after {len(codes) - 1} scans')
st, r = call('POST', '/api/parse', raw=b'aGVsbG8=', headers={'cf-connecting-ip': ip + '9'})
ok(st == 200, 'a different IP is unaffected')
# room-creation limit (protects the D1 daily write quota)
ip2 = '10.%d.%d.%d' % tuple(random.randint(1, 254) for _ in range(3))
rc = []
for _ in range(60):
    st, r = call('POST', '/api/rooms', {'host_name': 'X', 'host_vpa': 'xx@ybl', 'participants': ['Y'], 'bill': bill}, {'cf-connecting-ip': ip2})
    rc.append(st)
    if st == 429: break
ok(rc[-1] == 429 and set(rc[:-1]) == {201}, f'room-creation rate limit kicks in after {len(rc) - 1} rooms')

